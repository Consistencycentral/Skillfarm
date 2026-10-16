-- ===========================================================================
-- SkillFarm — Sectors + Enrollment-fields migration (v3)
-- Run ONCE in the Supabase SQL Editor. Safe to re-run (idempotent).
--
-- Adds:
--   1) profiles.org_sectors text[]  — multi-select training sectors on the
--      Learning Partner's Organization Profile (the 18 agriculture/allied
--      sectors). Learners read them on the org card.
--   2) registrations learner capture columns (Email, Age, Location, Previous
--      experience Yes/No) so each enrollment records these at register time,
--      and they flow into the export report.
--   3) register_seat(p_course_id, p_email, p_age, p_location, p_experience)
--      — accepts the new learner-capture params and stores them on the row.
-- The `courses.category` column is unchanged (kept as free text; the app's
-- CourseCategory union now lists the 18 sectors — values like 'crop_cultivation').
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) Organization Profile sectors (multi-select).
-- ---------------------------------------------------------------------------
alter table profiles
  add column if not exists org_sectors text[] not null default '{}';

-- Learners read org_sectors via the existing "profiles_select_all" policy
-- (created by the 20260805 migration). Nothing else to grant.

-- ---------------------------------------------------------------------------
-- 2) Learner enrollment-capture columns on registrations.
--    Captured at register time, shown in the export. All nullable except email
--    (a contact email the partner can reach the learner on).
-- ---------------------------------------------------------------------------
alter table registrations
  add column if not exists learner_email text,
  add column if not exists learner_age int,
  add column if not exists learner_location text,
  add column if not exists learner_experience boolean;

-- ---------------------------------------------------------------------------
-- 3) Replace register_seat to accept + store the learner-capture params.
--    Kept the existing pending->approve workflow from the 20260805 migration.
--    New signature: (p_course_id, p_email, p_age, p_location, p_experience).
-- ===========================================================================
create or replace function public.register_seat(
  p_course_id    uuid,
  p_email        text default null,
  p_age          int   default null,
  p_location     text  default null,
  p_experience   boolean default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course        public.courses%rowtype;
  v_existing      public.registrations%rowtype;
  v_status        text;
  v_seats_left    int;
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
  else
    v_status := 'waitlist';
  end if;

  insert into public.registrations
    (course_id, student_id, status, attendance_status,
     learner_email, learner_age, learner_location, learner_experience)
  values
    (p_course_id, auth.uid(), v_status, 'pending',
     p_email, p_age, p_location, p_experience);

  select greatest(0, seats_total - seats_filled) into v_seats_left
    from public.courses where id = p_course_id;

  return json_build_object(
    'ok', true,
    'status', v_status,
    'seats_left', v_seats_left
  );
end;
$$;

-- Confirm.
select '>>> sectors + enrollment capture migration complete' as info,
  (select count(*) from information_schema.columns
     where table_name = 'profiles' and column_name = 'org_sectors') as has_org_sectors,
  (select count(*) from information_schema.columns
     where table_name = 'registrations' and column_name like 'learner_%') as learner_capture_cols;
