-- ===========================================================================
-- SkillFarm — P0 integrity & security migration (v5)
-- Run ONCE in the Supabase SQL Editor. Idempotent — safe to re-run.
--
-- Fixes five defects found in the 2026-08-21 audit. Read this before running:
-- it changes RLS in ways that BREAK any client older than the commit that
-- ships alongside it, on purpose.
--
--   P0.1  free_seat() now owns the entire cancellation. The app used to set
--         status='cancelled' itself and *then* call free_seat, which only
--         decremented seats_filled `if status = 'registered'` -- already false
--         by then. Confirmed seats were never released; courses silently
--         became unfillable.
--   P0.2  Learners could PATCH /registrations directly (the policy had no
--         WITH CHECK and no column restriction) and set status='registered',
--         attendance_status='present' -- self-approval, bypassing the partner
--         entirely. Direct INSERT/UPDATE/DELETE by learners is now removed;
--         every transition goes through a SECURITY DEFINER RPC.
--   P0.3  unique(course_id, student_id) plus register_seat's blanket "already
--         registered" check meant cancelling locked you out of a course
--         forever. register_seat now revives a cancelled/rejected row.
--   P0.4  courses INSERT/UPDATE only checked provider_id = auth.uid(), so any
--         learner account could publish courses. Now requires role='provider'.
--   P0.5  `profiles read all` and `courses read all` were declared
--         `using (true)` with no TO clause, i.e. granted to the anon role. The
--         anon key ships inside the APK, so every learner's name and phone was
--         publicly enumerable. Both are now authenticated-only.
--
-- NOT included (tracked separately, needs a view + api/registrations.ts rework):
--   learner-to-learner PII. An authenticated learner can still read other
--   learners' profiles rows. Narrowing that needs a public_profiles view and a
--   change to listMyStudents(), which legitimately reads its own registrants.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0) Drop the stale register_seat(uuid) overload.
--
-- Migration 20260805 created register_seat(uuid); 20260810 then created
-- register_seat(uuid, text, int, text, boolean) via CREATE OR REPLACE. Because
-- the argument lists differ that produced a second function rather than
-- replacing the first, so both live in the database. Since every parameter
-- after the first has a default, a named call passing only p_course_id is
-- ambiguous between them and errors with "function is not unique". The app
-- always sends all five arguments so it resolves today, but the overload is a
-- trap. Remove it.
-- ---------------------------------------------------------------------------
drop function if exists public.register_seat(uuid);

-- ---------------------------------------------------------------------------
-- 1) P0.1 — free_seat() owns the whole cancellation, atomically.
--
-- Contract: the caller passes only the course id and must NOT pre-modify the
-- registration row. Returns { ok, status, seats_left } or { ok:false, error }.
-- Idempotent: cancelling twice is a no-op, so a double tap cannot double-refund
-- a seat.
-- ---------------------------------------------------------------------------
create or replace function public.free_seat(p_course_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg  public.registrations%rowtype;
  v_left int;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'error', 'Not signed in.');
  end if;

  -- Lock the course row BEFORE the registration row. approve_registration()
  -- takes the same locks in the same order, so a concurrent approve and cancel
  -- on one course serialise instead of deadlocking or both adjusting the count.
  perform 1 from public.courses where id = p_course_id for update;

  select * into v_reg from public.registrations
    where course_id = p_course_id and student_id = auth.uid()
    for update;
  if not found then
    return json_build_object('ok', false, 'error', 'No registration found for this course.');
  end if;

  -- Already inactive: report success without touching the seat count. Also
  -- preserves a partner's 'rejected' decision rather than overwriting it.
  if v_reg.status in ('cancelled', 'rejected') then
    return json_build_object('ok', true, 'status', v_reg.status);
  end if;

  if v_reg.status = 'completed' then
    return json_build_object('ok', false, 'error', 'A completed course cannot be cancelled.');
  end if;

  -- Only 'registered' was ever counted against seats_filled -- 'pending' and
  -- 'waitlist' never bumped it, so decrementing for them would invent seats.
  if v_reg.status = 'registered' then
    update public.courses
      set seats_filled = greatest(0, seats_filled - 1)
      where id = p_course_id;
  end if;

  update public.registrations
    set status = 'cancelled', attendance_status = 'pending'
    where id = v_reg.id;

  select greatest(0, seats_total - seats_filled) into v_left
    from public.courses where id = p_course_id;

  return json_build_object('ok', true, 'status', 'cancelled', 'seats_left', v_left);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) P0.3 — register_seat() revives a cancelled/rejected row.
--
-- Also changes the "already registered" response from ok=true to ok=false. The
-- old shape made app/course/[id].tsx show "Request sent" for a request that
-- created nothing, because it only tested `result.ok`.
-- ---------------------------------------------------------------------------
create or replace function public.register_seat(
  p_course_id  uuid,
  p_email      text    default null,
  p_age        int     default null,
  p_location   text    default null,
  p_experience boolean default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course   public.courses%rowtype;
  v_existing public.registrations%rowtype;
  v_had_row  boolean;
  v_status   text;
  v_left     int;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'error', 'Not signed in.');
  end if;

  select * into v_course from public.courses where id = p_course_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Course not found.');
  end if;

  select * into v_existing from public.registrations
    where course_id = p_course_id and student_id = auth.uid()
    for update;
  v_had_row := found;   -- captured now; later statements clobber FOUND

  if v_had_row and v_existing.status in ('pending','registered','waitlist','completed') then
    return json_build_object(
      'ok', false,
      'status', v_existing.status,
      'error', 'You already have a registration for this course.'
    );
  end if;

  v_status := case
    when v_course.seats_total - v_course.seats_filled > 0 then 'pending'
    else 'waitlist'
  end;

  if v_had_row then
    -- Reuse the cancelled/rejected row: unique(course_id, student_id) makes a
    -- fresh INSERT impossible, and that is exactly what locked out anyone who
    -- cancelled by mistake.
    update public.registrations
      set status             = v_status,
          attendance_status  = 'pending',
          registered_at      = now(),
          learner_email      = p_email,
          learner_age        = p_age,
          learner_location   = p_location,
          learner_experience = p_experience
      where id = v_existing.id;
  else
    insert into public.registrations
      (course_id, student_id, status, attendance_status,
       learner_email, learner_age, learner_location, learner_experience)
    values
      (p_course_id, auth.uid(), v_status, 'pending',
       p_email, p_age, p_location, p_experience);
  end if;

  select greatest(0, seats_total - seats_filled) into v_left
    from public.courses where id = p_course_id;

  return json_build_object('ok', true, 'status', v_status, 'seats_left', v_left);
end;
$$;

grant execute on function public.register_seat(uuid, text, int, text, boolean) to authenticated;
grant execute on function public.free_seat(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) P0.2 — learners can no longer write `registrations` directly.
--
-- The RPCs are SECURITY DEFINER and run as the table owner, so they bypass RLS
-- and keep working with no policy at all. Removing these three policies closes
-- the self-approval hole *and* a second one: DELETE on a 'registered' row
-- destroyed the registration without ever decrementing seats_filled, leaking a
-- seat the same way the cancel bug did.
--
-- Supported paths after this: register_seat, free_seat, approve_registration,
-- reject_registration, set_attendance. SELECT is untouched -- learners still
-- read their own rows and partners still read their courses' rows.
-- ---------------------------------------------------------------------------
drop policy if exists "reg insert own" on public.registrations;
drop policy if exists "reg update own" on public.registrations;
drop policy if exists "reg delete own" on public.registrations;

-- SELECT is functionally unchanged (anon already matched no rows, because
-- auth.uid() is null for it) but gets an explicit TO authenticated so the whole
-- table's policy set reads consistently.
drop policy if exists "reg select owner or provider" on public.registrations;
create policy "reg select owner or provider" on public.registrations
  for select to authenticated
  using (
    auth.uid() = student_id
    or exists (
      select 1 from public.courses c
      where c.id = course_id and c.provider_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 4) P0.4 — publishing a course requires the 'provider' role.
--
-- Consequence worth knowing: a partner who flips their role to 'student' via
-- Switch role can no longer edit their existing courses. That is the intended
-- reading of the rule, but it is a behaviour change.
-- ---------------------------------------------------------------------------
drop policy if exists "courses insert own" on public.courses;
create policy "courses insert own" on public.courses
  for insert to authenticated
  with check (
    auth.uid() = provider_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'provider'
    )
  );

drop policy if exists "courses update own" on public.courses;
create policy "courses update own" on public.courses
  for update to authenticated
  using (auth.uid() = provider_id)
  with check (
    auth.uid() = provider_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'provider'
    )
  );

drop policy if exists "courses delete own" on public.courses;
create policy "courses delete own" on public.courses
  for delete to authenticated using (auth.uid() = provider_id);

-- ---------------------------------------------------------------------------
-- 5) P0.5 — no anonymous reads of profiles or courses.
--
-- Both base policies were `for select using (true)` with no TO clause, which
-- grants the anon role. The app always signs in before browsing, so scoping to
-- `authenticated` costs nothing.
--
-- Storage stays public on purpose: org-logos and course-images are rendered by
-- <Image> with no auth header, so `*_read_all ... to public` must remain.
-- ---------------------------------------------------------------------------
drop policy if exists "courses read all" on public.courses;
drop policy if exists "courses_select_authenticated" on public.courses;
create policy "courses_select_authenticated" on public.courses
  for select to authenticated using (true);

drop policy if exists "profiles read all" on public.profiles;
drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all" on public.profiles
  for select to authenticated using (true);

-- While we are here: both profile write policies were missing a WITH CHECK, so
-- the row could be updated into a state the USING clause would have refused
-- (e.g. reassigning `id`). Add the check and scope both to authenticated.
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own" on public.profiles
  for insert to authenticated
  with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- 6) Verify. Read the output rather than assuming success.
--    (`check` is a reserved word in Postgres, so the label column is `step`.)
-- ---------------------------------------------------------------------------

-- Expect exactly one register_seat, with five arguments.
select '1. register_seat overloads' as step,
       count(*) as n,
       string_agg(pg_get_function_identity_arguments(oid), ' | ') as signatures
from pg_proc
where proname = 'register_seat'
  and pronamespace = 'public'::regnamespace;

-- Expect registrations to have SELECT only -- no INSERT/UPDATE/DELETE rows.
select '2. registrations policies' as step, policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename = 'registrations'
order by cmd, policyname;

-- Expect every row's roles to be {authenticated}; anything showing {public}
-- is still anon-readable.
select '3. read policies' as step, tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'courses')
order by tablename, cmd, policyname;

-- Expect both columns true: free_seat decrements, and only for a held seat.
select '4. free_seat guards status' as step,
       position('greatest(0, seats_filled - 1)' in prosrc) > 0 as decrements,
       position('v_reg.status = ''registered''' in prosrc) > 0 as checks_status
from pg_proc
where proname = 'free_seat' and pronamespace = 'public'::regnamespace;

