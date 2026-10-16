-- ==========================================================================
-- SkillFarm — BASE schema (step 1 of the setup).
--
-- Provenance: copied verbatim from the older `coursearc/` project copy, which
-- was the only place it lived. Every file in `supabase/migrations/` layers on
-- top of this, so a fresh Supabase project must be built in this order:
--
--   1. supabase/schema.sql                              <- this file
--   2. supabase/migrations/20260805_trust_enrollment.sql
--   3. supabase/migrations/20260807_storage_buckets.sql  (buckets; the 20260805
--      file's storage section does not reliably create them)
--   4. supabase/migrations/20260810_sectors_enrollment.sql
--   5. supabase/migrations/20260811_course_category_check.sql
--   6. any later 2026*.sql migrations, in filename order
--
-- Note that later migrations deliberately REPLACE parts of this file:
--   * `courses.category` CHECK  -> widened to the 18 sectors (20260811)
--   * `registrations.status` CHECK -> adds 'pending' / 'rejected' (20260805)
--   * `register_seat` / `free_seat` -> redefined (20260805, 20260810)
-- So the constraint lists and function bodies below are the ORIGINAL versions,
-- not the current ones. Do not treat this file as the live schema.
--
-- Also required (was applied ad hoc, kept in the older copy):
--   `profiles insert own` RLS policy — the client creates its own profile row
--   after signup because the auth.users trigger does not fire reliably here.
--   It is re-declared at the end of this file so a fresh setup gets it.
--
-- Run this entire script ONCE in Supabase: SQL Editor > "+ New query" > paste > Run
-- It creates the tables, security rules (RLS), a trigger, and the seat
-- increment function. Safe to re-run (uses IF NOT EXISTS / OR REPLACE).
-- ==========================================================================

-- ---------------------------------------------------------------
-- 1) TABLES
-- ---------------------------------------------------------------

-- PROFILES: one row per user, holds their role (student or provider)
create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text,
  phone text,
  role text not null default 'student' check (role in ('student','provider')),
  onboarding_complete boolean not null default false,
  created_at timestamptz default now()
);

-- COURSES: listed by providers
create table if not exists courses (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid references profiles(id) on delete cascade,
  title text not null,
  description text,
  category text not null check (category in ('agriculture','msme','handicrafts','small_scale','other')),
  start_date date,
  duration_weeks int,
  seats_total int not null default 0 check (seats_total >= 0),
  seats_filled int not null default 0 check (seats_filled >= 0),
  fee numeric default 0,
  address text not null,
  city text,
  state text,
  contact_phone text,
  image_url text,
  created_at timestamptz default now()
);

-- REGISTRATIONS: a student registers for a course
create table if not exists registrations (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references courses(id) on delete cascade,
  student_id uuid references profiles(id) on delete cascade,
  status text not null default 'registered' check (status in ('registered','cancelled','completed','waitlist')),
  registered_at timestamptz default now(),
  unique (course_id, student_id)   -- prevents double registration
);

-- ---------------------------------------------------------------
-- 2) ROW LEVEL SECURITY (RLS)
-- Who can read / write each table. This keeps data private per user.
-- ---------------------------------------------------------------

alter table profiles enable row level security;
alter table courses enable row level security;
alter table registrations enable row level security;

-- PROFILES: everyone (logged in) can read; you can edit only your own
drop policy if exists "profiles read all" on profiles;
create policy "profiles read all" on profiles for select using (true);

drop policy if exists "profiles update own" on profiles;
create policy "profiles update own" on profiles for update using (auth.uid() = id);

-- COURSES: everyone can read; only the owning provider can insert/update/delete
drop policy if exists "courses read all" on courses;
create policy "courses read all" on courses for select using (true);

drop policy if exists "courses insert own" on courses;
create policy "courses insert own" on courses for insert with check (auth.uid() = provider_id);

drop policy if exists "courses update own" on courses;
create policy "courses update own" on courses for update using (auth.uid() = provider_id);

drop policy if exists "courses delete own" on courses;
create policy "courses delete own" on courses for delete using (auth.uid() = provider_id);

-- REGISTRATIONS: students see/modify their own; providers see registrations for their courses
drop policy if exists "reg select owner or provider" on registrations;
create policy "reg select owner or provider" on registrations for select
  using (
    auth.uid() = student_id
    or exists (select 1 from courses c where c.id = course_id and c.provider_id = auth.uid())
  );

drop policy if exists "reg insert own" on registrations;
create policy "reg insert own" on registrations for insert with check (auth.uid() = student_id);

drop policy if exists "reg update own" on registrations;
create policy "reg update own" on registrations for update using (auth.uid() = student_id);

drop policy if exists "reg delete own" on registrations;
create policy "reg delete own" on registrations for delete using (auth.uid() = student_id);

-- ---------------------------------------------------------------
-- 3) PROFILE CREATION ON SIGNUP — handled CLIENT-SIDE, trigger removed
-- ---------------------------------------------------------------
--
-- The AFTER INSERT trigger that used to live here aborted EVERY signup with
--   HTTP 500 "Database error saving new user"
-- on this pgx-based project: GoTrue rolls back the whole auth.users insert
-- when a trigger firing on it errors. The app creates the profile row instead,
-- via ensureProfile() in app/login.tsx right after a successful signUp(),
-- which works because of the "profiles insert own" RLS policy (section 5).
-- Keep the function for reference, but make sure the trigger stays DROPPED.
-- One-off against the live DB (Supabase SQL Editor):
--   drop trigger if exists on_auth_user_created on auth.users;

create or replace function handle_new_user() returns trigger
as $$
begin
  insert into profiles (id, full_name, phone, role)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'phone',
    coalesce(new.raw_user_meta_data->>'role','student')
  )
  on conflict (id) do nothing;       -- safe if re-run
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;

-- ---------------------------------------------------------------
-- 4) ATOMIC SEAT INCREMENT (called when a student registers)
--    register_seat(course_id) -> inserts a registration row and
--    bumps seats_filled by 1, only if a seat is available.
-- ---------------------------------------------------------------

create or replace function register_seat(p_course_id uuid) returns json
as $$
declare
  v_course record;
  v_student uuid := auth.uid();
begin
  if v_student is null then
    return json_build_object('ok', false, 'error', 'not authenticated');
  end if;

  select seats_total, seats_filled into v_course
  from courses where id = p_course_id for update;   -- lock the row

  if not found then
    return json_build_object('ok', false, 'error', 'course not found');
  end if;

  if v_course.seats_filled >= v_course.seats_total then
    -- no seats left: register them on the waitlist instead
    insert into registrations (course_id, student_id, status)
    values (p_course_id, v_student, 'waitlist')
    on conflict (course_id, student_id) do nothing;

    return json_build_object('ok', false, 'error', 'full', 'status', 'waitlist');
  end if;

  insert into registrations (course_id, student_id, status)
  values (p_course_id, v_student, 'registered')
  on conflict (course_id, student_id) do nothing;

  update courses set seats_filled = seats_filled + 1
  where id = p_course_id and seats_filled < seats_total;

  return json_build_object('ok', true, 'status', 'registered');
end;
$$ language plpgsql security definer;

grant execute on function register_seat(uuid) to authenticated;

-- ---------------------------------------------------------------
-- 5) PROFILES INSERT POLICY
-- The trigger in section 3 does not fire reliably on this Supabase project
-- (signup returned "Database error saving new user" and no auth.users row was
-- written). The app therefore creates the profile row client-side right after
-- signUp() — which needs an INSERT policy that the original schema lacked.
-- Without this, the client-side upsert fails with
--   "new row violates row-level security policy".
-- ---------------------------------------------------------------

drop policy if exists "profiles insert own" on profiles;
create policy "profiles insert own" on profiles
  for insert
  with check (auth.uid() = id);
