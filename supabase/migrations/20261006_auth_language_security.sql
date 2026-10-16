-- ===========================================================================
-- SkillFarm — auth/language/security hardening
-- 2026-10-06
--
-- Run this migration in Supabase SQL Editor after the existing migrations.
-- It is intentionally idempotent.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) profiles: private by default. Public catalog data is served by the
--    already-existing public_courses/public_orgs projection views instead.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_all" on public.profiles;
drop policy if exists "profiles_select_scoped" on public.profiles;
drop policy if exists "profiles read all" on public.profiles;

create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- 2) Track whether the user has explicitly completed role onboarding.
-- Existing accounts are treated as already onboarded; newly-created profiles
-- start false even though profiles.role keeps its legacy NOT NULL placeholder.
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists onboarding_complete boolean not null default true;
alter table public.profiles alter column onboarding_complete set default false;

-- ---------------------------------------------------------------------------
-- 3) Provider/student contact lookup for an authorized registration only.
--    This avoids broad SELECT access to the profiles table.
-- ---------------------------------------------------------------------------
create or replace function public.get_registration_student_contacts(p_student_ids uuid[])
returns table (id uuid, full_name text, phone text)
language sql
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.phone
  from public.profiles p
  where p.id = any(p_student_ids)
    and exists (
      select 1
      from public.registrations r
      join public.courses c on c.id = r.course_id
      where r.student_id = p.id
        and c.provider_id = auth.uid()
    );
$$;

revoke all on function public.get_registration_student_contacts(uuid[]) from public;
grant execute on function public.get_registration_student_contacts(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Public review projection. The profiles table remains owner-only while
-- review cards can still show the reviewer's display name without exposing the
-- rest of their profile columns.
-- ---------------------------------------------------------------------------
create or replace view public.public_course_reviews
with (security_invoker = false) as
select
  r.id,
  r.course_id,
  r.learner_id,
  r.rating,
  r.body,
  r.created_at,
  p.full_name as learner_name,
  rr.id as reply_id,
  rr.review_id as reply_review_id,
  rr.partner_id as reply_partner_id,
  rr.body as reply_body,
  rr.created_at as reply_created_at
from public.reviews r
left join public.profiles p on p.id = r.learner_id
left join public.review_replies rr on rr.review_id = r.id;

grant select on public.public_course_reviews to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) Authenticated course projection. This preserves course contact_phone for
-- signed-in learners without reopening the profiles table. Anonymous users
-- continue to use public_courses, which intentionally omits contact_phone.
-- ---------------------------------------------------------------------------
create or replace view public.authenticated_courses
with (security_invoker = false) as
select
  c.id, c.provider_id, c.title, c.description, c.category, c.start_date,
  c.duration_weeks, c.seats_total, c.seats_filled, c.fee, c.address, c.city,
  c.state, c.contact_phone, c.image_url, c.learning_outcomes, c.agenda,
  c.batch_timings, c.registration_deadline, c.discount, c.language,
  c.certificate_available, c.eligibility, c.images, c.created_at,
  p.full_name as provider_name,
  coalesce(p.is_active, true) as provider_active
from public.courses c
join public.profiles p on p.id = c.provider_id
where p.is_active is null or p.is_active = true;

revoke all on public.authenticated_courses from anon;
grant select on public.authenticated_courses to authenticated;

-- ---------------------------------------------------------------------------
-- 6) Public catalog views remain the only cross-user profile projection; authenticated_courses is the course-only projection.
-- ---------------------------------------------------------------------------
grant select on public.public_courses to anon, authenticated;
grant select on public.public_orgs to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7) Verify expected policy shape.
-- ---------------------------------------------------------------------------
select policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename = 'profiles'
order by cmd, policyname;
