-- ===========================================================================
-- SkillFarm — Trust & Enrollment migration (v2)
-- Run ONCE in the Supabase SQL Editor. Safe to re-run (idempotent).
--
-- This is the consolidated backend for:
--   Slice 3 — Organization Profile (org_* columns + is_active + learners
--             can read) and Trainers table.
--   Slice 4 — Enriched course fields + images.
--   Slice 5 — Enrollment approval workflow (pending -> registered/rejected),
--             attendance status, course reviews + public partner replies.
--   Slice 6 — Active/Inactive visibility (courses_visible view).
--
-- Assumes the base schema already exists in the project: tables `profiles`,
-- `courses`, `registrations`, RPCs `register_seat` + `free_seat`, and
-- (`org_*` columns / `is_active` / `courses_visible` from the earlier
-- fix-org-profile.sql migration) may or may not be present yet — this file
-- makes sure they all exist.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) Organization profile columns on `profiles` (Learning Partner profile).
--    idempotent re-declaration of the earlier fix-org-profile.sql block.
-- ---------------------------------------------------------------------------
alter table profiles
  add column if not exists org_name text,
  add column if not exists org_logo_url text,
  add column if not exists org_about text,
  add column if not exists org_year_established int,
  add column if not exists org_type text,
  add column if not exists org_registration_number text,
  add column if not exists org_website text,
  add column if not exists org_email text,
  add column if not exists org_phone text,
  add column if not exists org_address text,
  add column if not exists org_maps_url text,
  add column if not exists org_languages text,
  add column if not exists is_active boolean not null default true;

-- Any logged-in user can read profiles (learners see the org public profile).
-- The base schema.sql already grants a "profiles read all" SELECT policy; if it
-- is missing for any reason, add it now.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'profiles_select_all'
  ) then
    create policy "profiles_select_all" on public.profiles
      for select to authenticated using (true);
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- 2) Enriched `courses` fields + images array.
-- ---------------------------------------------------------------------------
alter table courses
  add column if not exists learning_outcomes text,
  add column if not exists agenda text,
  add column if not exists batch_timings text,
  add column if not exists registration_deadline date,
  add column if not exists discount numeric(10,2) not null default 0,
  add column if not exists language text,
  add column if not exists certificate_available boolean not null default false,
  add column if not exists eligibility text,
  add column if not exists images text[] not null default '{}';

-- ---------------------------------------------------------------------------
-- 3) Enrollment approval workflow + attendance on `registrations`.
--    status now also allows 'pending' (awaiting partner approval) and
--    'rejected'. attendance_status is set by the partner after delivery.
--    Existing rows keep their current status (no data backfill needed).
-- ---------------------------------------------------------------------------
alter table registrations
  add column if not exists attendance_status text not null default 'pending'
    check (attendance_status in ('pending','present','absent'));

-- Drop + recreate the status CHECK so it accepts the new values, if a check
-- constraint exists. (The base schema may not have one; this is a no-op then.)
do $$
declare
  c text;
begin
  select con.conname into c
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where rel.relname = 'registrations' and nsp.nspname = 'public'
    and con.contype = 'c';
  if c is not null then
    execute format('alter table public.registrations drop constraint %I', c);
  end if;
end$$;

-- Explicitly drop a prior same-named constraint (idempotent on rerun — the
-- previous block drops unnamed checks, but this guarantees a named one is gone
-- before we re-add it, which is what caused the 42710 "already exists" error).
alter table public.registrations
  drop constraint if exists registrations_status_check;

alter table registrations
  add constraint registrations_status_check
  check (status in ('pending','registered','waitlist','cancelled','completed','rejected'));

-- ---------------------------------------------------------------------------
-- 4) Trainers — one Learning Partner can have many trainers (name,
--    qualification, experience, expertise). Readable by any logged-in user
--    so learners can see them on the course detail org card.
-- ---------------------------------------------------------------------------
create table if not exists public.trainers (
  id           uuid primary key default gen_random_uuid(),
  provider_id  uuid not null references public.profiles(id) on delete cascade,
  name         text not null,
  qualification text,
  experience   text,
  expertise    text,
  created_at   timestamptz not null default now()
);
create index if not exists trainers_provider_id_idx on public.trainers(provider_id);

alter table public.trainers enable row level security;

drop policy if exists "trainers_select_all" on public.trainers;
create policy "trainers_select_all" on public.trainers
  for select to authenticated using (true);

drop policy if exists "trainers_insert_own" on public.trainers;
create policy "trainers_insert_own" on public.trainers
  for insert to authenticated with check (provider_id = auth.uid());

drop policy if exists "trainers_update_own" on public.trainers;
create policy "trainers_update_own" on public.trainers
  for update to authenticated using (provider_id = auth.uid())
  with check (provider_id = auth.uid());

drop policy if exists "trainers_delete_own" on public.trainers;
create policy "trainers_delete_own" on public.trainers
  for delete to authenticated using (provider_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 5) Reviews & public replies (program/course reviews only this phase).
--    A learner may leave ONE review per course, and only if they registered.
--    The Learning Partner who owns the course may post ONE public reply.
-- ---------------------------------------------------------------------------
create table if not exists public.reviews (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses(id) on delete cascade,
  learner_id uuid not null references public.profiles(id) on delete cascade,
  rating     int not null check (rating between 1 and 5),
  body       text,
  created_at timestamptz not null default now(),
  unique (course_id, learner_id)
);
create index if not exists reviews_course_id_idx on public.reviews(course_id);

alter table public.reviews enable row level security;

-- Anyone logged in can read reviews + replies (shown on course detail).
drop policy if exists "reviews_select_all" on public.reviews;
create policy "reviews_select_all" on public.reviews
  for select to authenticated using (true);

-- A learner can insert a review only if they have a registration for the
-- course (any non-cancelled status). Enforced in the RLS policy as a
-- subquery — belt-and-suspenders with the app-side check.
drop policy if exists "reviews_insert_registered" on public.reviews;
create policy "reviews_insert_registered" on public.reviews
  for insert to authenticated
  with check (
    learner_id = auth.uid()
    and exists (
      select 1 from public.registrations r
      where r.course_id = reviews.course_id
        and r.student_id = auth.uid()
        and r.status in ('pending','registered','waitlist','completed')
    )
  );

-- A learner can edit/delete their own review.
drop policy if exists "reviews_update_own" on public.reviews;
create policy "reviews_update_own" on public.reviews
  for update to authenticated using (learner_id = auth.uid())
  with check (learner_id = auth.uid());

drop policy if exists "reviews_delete_own" on public.reviews;
create policy "reviews_delete_own" on public.reviews
  for delete to authenticated using (learner_id = auth.uid());

create table if not exists public.review_replies (
  id         uuid primary key default gen_random_uuid(),
  review_id  uuid not null references public.reviews(id) on delete cascade,
  partner_id uuid not null references public.profiles(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),
  unique (review_id)  -- one public reply per review
);
alter table public.review_replies enable row level security;

drop policy if exists "replies_select_all" on public.review_replies;
create policy "replies_select_all" on public.review_replies
  for select to authenticated using (true);

-- Only the Learning Partner who owns the reviewed course may reply.
drop policy if exists "replies_insert_owner" on public.review_replies;
create policy "replies_insert_owner" on public.review_replies
  for insert to authenticated
  with check (
    partner_id = auth.uid()
    and exists (
      select 1
      from public.reviews rv
      join public.courses c on c.id = rv.course_id
      where rv.id = review_id and c.provider_id = auth.uid()
    )
  );

drop policy if exists "replies_update_owner" on public.review_replies;
create policy "replies_update_owner" on public.review_replies
  for update to authenticated using (partner_id = auth.uid())
  with check (partner_id = auth.uid());

drop policy if exists "replies_delete_owner" on public.review_replies;
create policy "replies_delete_owner" on public.review_replies
  for delete to authenticated using (partner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 6) Active/Inactive visibility — secure view of courses that hides courses
--    from inactive Learning Partners for learners (providers still see their
--    own rows). Re-declared idempotently.
-- ---------------------------------------------------------------------------
drop view if exists public.courses_visible;
create or replace view public.courses_visible as
  select c.*
  from public.courses c
  join public.profiles p on p.id = c.provider_id
  where p.is_active = true or c.provider_id = auth.uid();

grant select on public.courses_visible to authenticated;

-- ---------------------------------------------------------------------------
-- 7) Enrollment approval workflow — make `register_seat` create a 'pending'
--    registration and add `approve_registration`. `free_seat` already exists
--    from the base schema; we redefine both to be safe and consistent.
--    register_seat: SECURITY DEFINER so the locked row + insert + seat bump
--    happen atomically. Returns { ok, status, seats_left }.
-- ---------------------------------------------------------------------------
create or replace function public.register_seat(p_course_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course        public.courses%rowtype;
  v_existing      public.registrations%rowtype;
  v_status        text;
  v_seats_left     int;
  v_waitlist_count int;
begin
  select * into v_course from public.courses where id = p_course_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Course not found.');
  end if;

  -- Already registered by this learner?
  select * into v_existing from public.registrations
    where course_id = p_course_id and student_id = auth.uid() for update;
  if found then
    return json_build_object(
      'ok', true,
      'status', v_existing.status,
      'error', 'You already have a registration for this course.'
    );
  end if;

  v_seats_left := v_course.seats_total - v_course.seats_filled;

  if v_seats_left > 0 then
    v_status := 'pending';   -- awaits partner approval
    update public.courses
      set seats_filled = seats_filled
      where id = p_course_id; -- no seat bump until approved
  else
    v_status := 'waitlist';
  end if;

  insert into public.registrations (course_id, student_id, status, attendance_status)
    values (p_course_id, auth.uid(), v_status, 'pending');

  select greatest(0, seats_total - seats_filled) into v_seats_left
    from public.courses where id = p_course_id;

  return json_build_object(
    'ok', true,
    'status', v_status,
    'seats_left', v_seats_left
  );
end;
$$;

-- approve_registration: promote a pending (or waitlist) registration to
-- 'registered', bumping seats_filled only when a real seat is taken.
create or replace function public.approve_registration(p_reg_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg      public.registrations%rowtype;
  v_course   public.courses%rowtype;
  v_seats_left int;
begin
  select * into v_reg from public.registrations where id = p_reg_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Registration not found.');
  end if;

  -- Only the course's Learning Partner may approve.
  select * into v_course
    from public.courses c
    where c.id = v_reg.course_id and c.provider_id = auth.uid()
    for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Not authorized.');
  end if;

  if v_reg.status not in ('pending','waitlist') then
    return json_build_object('ok', false, 'error', 'Only pending or waitlist registrations can be approved.');
  end if;

  v_seats_left := v_course.seats_total - v_course.seats_filled;

  if v_seats_left > 0 then
    update public.registrations set status = 'registered' where id = p_reg_id;
    update public.courses set seats_filled = seats_filled + 1 where id = v_course.id;
    return json_build_object('ok', true, 'status', 'registered', 'seats_left', v_seats_left - 1);
  else
    -- Full: keep on waitlist.
    update public.registrations set status = 'waitlist' where id = p_reg_id;
    return json_build_object('ok', true, 'status', 'waitlist', 'seats_left', 0);
  end if;
end;
$$;

-- reject_registration: mark a pending/waitlist request as rejected (no seat
-- change, since pending never bumped seats).
create or replace function public.reject_registration(p_reg_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg public.registrations%rowtype;
begin
  select * into v_reg from public.registrations where id = p_reg_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Registration not found.');
  end if;

  if not exists (
    select 1 from public.courses c
    where c.id = v_reg.course_id and c.provider_id = auth.uid()
  ) then
    return json_build_object('ok', false, 'error', 'Not authorized.');
  end if;

  if v_reg.status not in ('pending','waitlist','registered') then
    return json_build_object('ok', false, 'error', 'Nothing to reject.');
  end if;

  -- If it was 'registered', release the seat back.
  if v_reg.status = 'registered' then
    update public.courses set seats_filled = greatest(0, seats_filled - 1)
      where id = v_reg.course_id;
  end if;

  update public.registrations set status = 'rejected' where id = p_reg_id;
  return json_build_object('ok', true, 'status', 'rejected');
end;
$$;

-- free_seat: cancel a learner's registration. Decrements seats_filled only if
-- the registration was 'registered' (seat actually held).
create or replace function public.free_seat(p_course_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg public.registrations%rowtype;
begin
  select * into v_reg from public.registrations
    where course_id = p_course_id and student_id = auth.uid();
  if not found then
    return json_build_object('ok', false, 'error', 'No registration found.');
  end if;

  if v_reg.status = 'registered' then
    update public.courses set seats_filled = greatest(0, seats_filled - 1)
      where id = p_course_id;
  end if;

  update public.registrations set status = 'cancelled' where id = v_reg.id;
  return json_build_object('ok', true, 'status', 'cancelled');
end;
$$;

-- Attendance is set directly on the row by the partner via RLS (provider owns
-- the course); no RPC strictly required, but a helper makes it atomic + safe.
create or replace function public.set_attendance(p_reg_id uuid, p_status text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg public.registrations%rowtype;
begin
  if p_status not in ('pending','present','absent') then
    return json_build_object('ok', false, 'error', 'Invalid attendance status.');
  end if;
  select * into v_reg from public.registrations where id = p_reg_id;
  if not found then
    return json_build_object('ok', false, 'error', 'Registration not found.');
  end if;
  if not exists (
    select 1 from public.courses c
    where c.id = v_reg.course_id and c.provider_id = auth.uid()
  ) then
    return json_build_object('ok', false, 'error', 'Not authorized.');
  end if;
  update public.registrations set attendance_status = p_status where id = p_reg_id;
  return json_build_object('ok', true, 'attendance_status', p_status);
end;
$$;

grant execute on function public.register_seat(uuid) to authenticated;
grant execute on function public.approve_registration(uuid) to authenticated;
grant execute on function public.reject_registration(uuid) to authenticated;
grant execute on function public.free_seat(uuid) to authenticated;
grant execute on function public.set_attendance(uuid,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8) Storage buckets for images (org logos + course images). Public read,
--    authenticated upload to a user-namespaced path.
--    (If buckets already exist, these are no-ops.)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('org-logos', 'org-logos', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('course-images', 'course-images', true)
on conflict (id) do nothing;

-- org-logos: authenticated can upload under their own uid prefix; public read.
drop policy if exists "org_logos_read_all" on storage.objects;
create policy "org_logos_read_all" on storage.objects
  for select to public using (bucket_id = 'org-logos');

drop policy if exists "org_logos_insert_own" on storage.objects;
create policy "org_logos_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'org-logos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "org_logos_update_own" on storage.objects;
create policy "org_logos_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'org-logos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'org-logos' and (storage.foldername(name))[1] = auth.uid()::text);

-- course-images: same pattern.
drop policy if exists "course_images_read_all" on storage.objects;
create policy "course_images_read_all" on storage.objects
  for select to public using (bucket_id = 'course-images');

drop policy if exists "course_images_insert_own" on storage.objects;
create policy "course_images_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'course-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "course_images_update_own" on storage.objects;
create policy "course_images_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'course-images' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'course-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- 9) Confirm migration
-- ---------------------------------------------------------------------------
do $$
declare
  org_count int;
  course_new int;
begin
  select count(*) into org_count from information_schema.columns
    where table_name = 'profiles' and column_name like 'org_%';
  select count(*) into course_new from information_schema.columns
    where table_name = 'courses' and column_name in
      ('learning_outcomes','agenda','batch_timings','registration_deadline',
       'discount','language','certificate_available','eligibility','images');
  raise notice '>>> org columns: % | new course columns: %', org_count, course_new;
end$$;

select '>>> migration complete' as info,
  (select count(*) from information_schema.tables where table_schema='public'
    and table_name in ('trainers','reviews','review_replies')) as new_tables;
