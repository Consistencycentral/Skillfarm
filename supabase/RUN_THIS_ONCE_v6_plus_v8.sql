-- ===========================================================================
-- SKILLFARM: RUN THIS ONE FILE ONCE in Supabase SQL Editor (safe to re-run).
-- Contains v6 (seat/booking/reviews fixes) followed by v8 (trainer, certificate,
-- multi-seat). Order matters; do not split.
-- ===========================================================================

-- ########## PART 1: v6 ##########
-- ===========================================================================
-- SkillFarm client fixes v6  (2026-10-13)
--
-- !! NOT YET RUN ANYWHERE. Written without access to the live Supabase project.
-- !! Run it FIRST on a staging copy (or after a backup), then on production.
--
-- What this fixes
--   1. "stack depth limit exceeded" when a partner edits a course or approves a
--      learner. Cause: courses -> batches -> courses trigger loop. Every sync
--      below now writes only when a value really changed, and the
--      course->batch sync refuses to run from inside another trigger.
--   2. Approve failing while Reject works (same loop: approving changes the
--      seat counter, rejecting a pending row did not).
--   3. Seat counts. batches.seats_filled now means "held seats" =
--      pending + registered + completed. Learners see the real availability,
--      and the database refuses to hold more than seats_total.
--   4. Exactly 40 seats per batch (and therefore 40 for a normal one-batch
--      course). Enforced by trigger, so the app cannot send another number.
--   5. Booking = request. book_seat() holds the chosen seat as `pending`
--      (waiting for the Learning Partner). Approve -> `registered`,
--      Reject -> `rejected` (seat is freed). NO payment / Razorpay step.
--   6. Same seat can never be held twice (partial unique index).
--   7. Reviews: submit_review() / post_review_reply() RPCs with clear errors.
--   8. courses.translations (jsonb) for Tamil / Hindi course content.
--   9. Deleting a course no longer fails with "A course must keep at least one batch".
--
-- Safe to run more than once.
-- Prerequisite: the older booking migrations (multi-batch, theatre seat) have
-- already been applied. The preflight below stops with a clear message if not.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Preflight
-- ---------------------------------------------------------------------------
do $$
declare v_missing text := '';
begin
  if to_regclass('public.courses') is null then v_missing := v_missing || ' public.courses;'; end if;
  if to_regclass('public.batches') is null then v_missing := v_missing || ' public.batches (run 20260903_multi_batch_system.sql);'; end if;
  if to_regclass('public.registrations') is null then v_missing := v_missing || ' public.registrations;'; end if;
  if to_regclass('public.reviews') is null then v_missing := v_missing || ' public.reviews (run 20260805_trust_enrollment.sql);'; end if;
  if to_regclass('public.review_replies') is null then v_missing := v_missing || ' public.review_replies;'; end if;
  if v_missing <> '' then
    raise exception 'SkillFarm v6 cannot run yet. Missing:%', v_missing;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='registrations' and column_name='preferred_seat_number') then
    alter table public.registrations add column preferred_seat_number integer;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Translations column (Tamil / Hindi course content typed by the partner)
--    Shape: { "ta": {"title":"..","description":"..","agenda":"..",
--                    "learning_outcomes":"..","eligibility":"..",
--                    "batch_timings":".."}, "hi": { ... } }
-- ---------------------------------------------------------------------------
alter table public.courses
  add column if not exists translations jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- 2. Held-seat helper + counters
-- ---------------------------------------------------------------------------
create or replace function public.batch_held_count(p_batch_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.registrations r
  where r.batch_id = p_batch_id
    and r.status in ('pending', 'registered', 'completed');
$$;

-- BEFORE trigger on batches: dates stay tidy and seats_filled is always the
-- real held count, so nobody can fake availability with a direct table edit.
create or replace function public.enforce_batch_filled_seats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.start_date is not null and new.end_date is null and new.duration_weeks is not null then
    new.end_date := new.start_date + (new.duration_weeks * 7 - 1);
  elsif new.start_date is not null and new.end_date is not null and new.duration_weeks is null then
    new.duration_weeks := greatest(1, ceil(((new.end_date - new.start_date) + 1)::numeric / 7)::int);
  end if;

  if tg_op = 'INSERT' then
    new.seats_filled := 0;
  else
    new.seats_filled := public.batch_held_count(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_batch_filled_seats on public.batches;
create trigger trg_enforce_batch_filled_seats
before insert or update on public.batches
for each row execute function public.enforce_batch_filled_seats();

-- AFTER trigger on registrations: recount the batch. Raises if a change would
-- put more than seats_total held seats in the batch (overbooking guard).
-- Writes to batches only when the number actually changed (no trigger loop).
create or replace function public.sync_batch_filled_from_registration()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old uuid;
  v_new uuid;
  v_cnt int;
  v_total int;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := old.batch_id; end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := new.batch_id; end if;

  if v_new is not null then
    select b.seats_total into v_total from public.batches b where b.id = v_new;
    v_cnt := public.batch_held_count(v_new);
    if v_cnt > coalesce(v_total, 0) then
      raise exception 'Cannot book: this batch is full.';
    end if;
    update public.batches b
    set seats_filled = v_cnt
    where b.id = v_new and b.seats_filled is distinct from v_cnt;
  end if;

  if v_old is not null and v_old is distinct from v_new then
    v_cnt := public.batch_held_count(v_old);
    update public.batches b
    set seats_filled = v_cnt
    where b.id = v_old and b.seats_filled is distinct from v_cnt;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_sync_batch_filled_from_registration on public.registrations;
create trigger trg_sync_batch_filled_from_registration
after insert or update of status, batch_id or delete on public.registrations
for each row execute function public.sync_batch_filled_from_registration();

-- ---------------------------------------------------------------------------
-- 3. Loop-safe course aggregate (batches -> courses)
-- ---------------------------------------------------------------------------
create or replace function public.sync_course_batch_seats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
  v_total int;
  v_filled int;
begin
  v_course_id := coalesce(new.course_id, old.course_id);

  select coalesce(sum(b.seats_total), 0)::int, coalesce(sum(b.seats_filled), 0)::int
    into v_total, v_filled
  from public.batches b where b.course_id = v_course_id;

  update public.courses c
  set seats_total = v_total, seats_filled = v_filled
  where c.id = v_course_id
    and (c.seats_total is distinct from v_total or c.seats_filled is distinct from v_filled);

  if tg_op = 'UPDATE' and old.course_id is distinct from new.course_id then
    select coalesce(sum(b.seats_total), 0)::int, coalesce(sum(b.seats_filled), 0)::int
      into v_total, v_filled
    from public.batches b where b.course_id = old.course_id;

    update public.courses c
    set seats_total = v_total, seats_filled = v_filled
    where c.id = old.course_id
      and (c.seats_total is distinct from v_total or c.seats_filled is distinct from v_filled);
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_sync_course_batch_seats on public.batches;
create trigger trg_sync_course_batch_seats
after insert or update or delete on public.batches
for each row execute function public.sync_course_batch_seats();

-- ---------------------------------------------------------------------------
-- 4. Loop-safe course -> primary batch sync (partner edits a course)
--    Only runs for a real, top-level partner edit (trigger depth 1). When it is
--    reached from another trigger (depth > 1) it exits immediately.
-- ---------------------------------------------------------------------------
create or replace function public.sync_course_event_to_primary_batch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.batches%rowtype;
  v_end date;
  v_timings text;
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if new.start_date is null then return new; end if;

  v_end := case when new.duration_weeks is not null
                then new.start_date + (new.duration_weeks * 7 - 1) else null end;
  v_timings := nullif(trim(coalesce(new.batch_timings, '')), '');

  select * into v_batch
  from public.batches b
  where b.course_id = new.id
  order by b.created_at asc, b.id asc
  limit 1;

  if not found then
    insert into public.batches (
      course_id, name, start_date, end_date, duration_weeks, timings,
      seats_total, seats_filled, registration_deadline
    ) values (
      new.id, 'Batch 1', new.start_date, v_end, new.duration_weeks, v_timings,
      40, 0, new.registration_deadline
    );
    return new;
  end if;

  -- Only the single default batch follows the course form; real multi-batch
  -- schedules stay authoritative. Capacity is NOT copied (always 40).
  if v_batch.name = 'Batch 1'
     and not exists (select 1 from public.batches b2 where b2.course_id = new.id and b2.id <> v_batch.id)
     and (v_batch.start_date is distinct from new.start_date
          or v_batch.duration_weeks is distinct from new.duration_weeks
          or v_batch.timings is distinct from v_timings
          or v_batch.registration_deadline is distinct from new.registration_deadline) then
    update public.batches
    set start_date = new.start_date,
        end_date = coalesce(v_end, end_date),
        duration_weeks = new.duration_weeks,
        timings = v_timings,
        registration_deadline = new.registration_deadline
    where id = v_batch.id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_course_event_to_primary_batch on public.courses;
create trigger trg_sync_course_event_to_primary_batch
after insert or update of start_date, duration_weeks, batch_timings, registration_deadline
on public.courses
for each row execute function public.sync_course_event_to_primary_batch();

revoke execute on function public.sync_course_event_to_primary_batch() from public, anon, authenticated;
grant execute on function public.sync_course_event_to_primary_batch() to service_role;

-- ---------------------------------------------------------------------------
-- 5. Exactly 40 seats per batch
-- ---------------------------------------------------------------------------
create or replace function public.enforce_fixed_batch_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.seats_total := 40;
  return new;
end;
$$;

drop trigger if exists trg_aa_enforce_fixed_batch_capacity on public.batches;
create trigger trg_aa_enforce_fixed_batch_capacity
before insert or update of seats_total on public.batches
for each row execute function public.enforce_fixed_batch_capacity();

-- A brand-new course always starts at 40 (its batches then define the total).
create or replace function public.default_course_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.seats_total := 40;
  return new;
end;
$$;

drop trigger if exists trg_aa_default_course_capacity on public.courses;
create trigger trg_aa_default_course_capacity
before insert on public.courses
for each row execute function public.default_course_capacity();

-- Existing batches -> 40. Batches already holding more than 40 are left alone
-- and reported (they need a manual look).
do $$
declare v_bad int;
begin
  update public.batches b
  set seats_total = 40
  where b.seats_total is distinct from 40
    and public.batch_held_count(b.id) <= 40;

  select count(*) into v_bad from public.batches b
  where public.batch_held_count(b.id) > 40;
  if v_bad > 0 then
    raise warning 'SkillFarm v6: % batch(es) hold more than 40 seats and were not changed. Review them manually.', v_bad;
  end if;
end $$;

-- Recount every batch once (fixes stale numbers from the old counter logic).
update public.batches b
set seats_filled = public.batch_held_count(b.id)
where b.seats_filled is distinct from public.batch_held_count(b.id);

-- ---------------------------------------------------------------------------
-- 5b. Deleting a whole course must work. The old batch-delete guard also fired
--     during the cascade from the course and blocked it ("A course must keep
--     at least one batch"). A direct batch delete is still guarded.
-- ---------------------------------------------------------------------------
create or replace function public.prevent_batch_delete_with_registrations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The parent course is already gone: this is the cascade from deleting it.
  if not exists (select 1 from public.courses c where c.id = old.course_id) then
    return old;
  end if;

  if exists (select 1 from public.registrations r where r.batch_id = old.id) then
    raise exception 'Cannot delete a batch that has registrations.';
  end if;

  if not exists (
    select 1 from public.batches b
    where b.course_id = old.course_id and b.id <> old.id
  ) then
    raise exception 'A course must keep at least one batch.';
  end if;

  return old;
end;
$$;

drop trigger if exists trg_prevent_batch_delete on public.batches;
create trigger trg_prevent_batch_delete
before delete on public.batches
for each row execute function public.prevent_batch_delete_with_registrations();

-- ---------------------------------------------------------------------------
-- 6. One active holder per seat
-- ---------------------------------------------------------------------------
do $$
begin
  create unique index if not exists registrations_batch_seat_active_uniq
    on public.registrations (batch_id, preferred_seat_number)
    where preferred_seat_number is not null
      and status in ('pending', 'registered', 'completed');
exception when unique_violation then
  raise warning 'SkillFarm v6: duplicate active seat numbers exist, so the unique seat index was NOT created. Fix the duplicates and re-run this file.';
end $$;

-- ---------------------------------------------------------------------------
-- 7. book_seat(): hold the chosen seat as PENDING (waiting for the partner)
-- ---------------------------------------------------------------------------
create or replace function public.book_seat(
  p_course_id uuid,
  p_batch_id uuid,
  p_email text default null,
  p_age int default null,
  p_location text default null,
  p_experience boolean default null,
  p_name text default null,
  p_phone text default null,
  p_additional_details text default null,
  p_preferred_seat_number int default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course public.courses%rowtype;
  v_batch public.batches%rowtype;
  v_existing public.registrations%rowtype;
  v_registration_id uuid;
  v_found boolean;
  v_left int;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'error', 'Not signed in.');
  end if;
  if p_preferred_seat_number is null or p_preferred_seat_number <= 0 then
    return json_build_object('ok', false, 'error', 'Please choose an available seat.');
  end if;

  -- Same lock order everywhere: course -> batch -> registration.
  select * into v_course from public.courses where id = p_course_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Course not found.');
  end if;
  if v_course.provider_id = auth.uid() then
    return json_build_object('ok', false, 'error', 'You cannot book a seat in your own course.');
  end if;

  select * into v_batch from public.batches where id = p_batch_id and course_id = p_course_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Selected batch was not found.');
  end if;

  -- A plain-date deadline (midnight UTC) means "until the end of that day".
  if v_batch.registration_deadline is not null
     and now() > (case
          when v_batch.registration_deadline = date_trunc('day', v_batch.registration_deadline at time zone 'UTC') at time zone 'UTC'
            then v_batch.registration_deadline + interval '1 day'
          else v_batch.registration_deadline end) then
    return json_build_object('ok', false, 'error', 'Booking for this batch is closed.');
  end if;

  if p_preferred_seat_number > 40 or p_preferred_seat_number > v_batch.seats_total then
    return json_build_object('ok', false, 'error', 'That seat does not exist in this batch.');
  end if;

  select * into v_existing
  from public.registrations
  where course_id = p_course_id and batch_id = p_batch_id and student_id = auth.uid()
  for update;
  v_found := found;

  if v_found and v_existing.status in ('pending', 'registered', 'completed', 'waitlist') then
    return json_build_object(
      'ok', false, 'status', v_existing.status, 'registration_id', v_existing.id,
      'error', case when v_existing.status = 'pending'
                    then 'You already have a request waiting for approval in this batch.'
                    else 'You already have a booking in this batch.' end);
  end if;

  if public.batch_held_count(p_batch_id) >= least(40, v_batch.seats_total) then
    return json_build_object('ok', false, 'error', 'This batch is full (40 of 40 seats taken).');
  end if;

  if exists (
    select 1 from public.registrations r
    where r.batch_id = p_batch_id
      and r.preferred_seat_number = p_preferred_seat_number
      and r.status in ('pending', 'registered', 'completed')
  ) then
    return json_build_object('ok', false, 'error', 'That seat was just taken by another learner. Please choose another seat.');
  end if;

  if v_found then
    update public.registrations
    set status = 'pending',
        attendance_status = 'pending',
        registered_at = now(),
        learner_email = p_email,
        learner_age = p_age,
        learner_location = p_location,
        learner_experience = p_experience,
        learner_name = p_name,
        learner_phone = p_phone,
        learner_additional_details = p_additional_details,
        preferred_seat_number = p_preferred_seat_number
    where id = v_existing.id
    returning id into v_registration_id;
  else
    insert into public.registrations (
      course_id, student_id, batch_id, status, attendance_status,
      learner_email, learner_age, learner_location, learner_experience,
      learner_name, learner_phone, learner_additional_details, preferred_seat_number
    ) values (
      p_course_id, auth.uid(), p_batch_id, 'pending', 'pending',
      p_email, p_age, p_location, p_experience,
      p_name, p_phone, p_additional_details, p_preferred_seat_number
    ) returning id into v_registration_id;
  end if;

  select greatest(0, b.seats_total - b.seats_filled) into v_left from public.batches b where b.id = p_batch_id;

  return json_build_object(
    'ok', true, 'status', 'pending',
    'registration_id', v_registration_id,
    'seat_number', p_preferred_seat_number,
    'seats_left', v_left,
    'batch_id', p_batch_id);

exception
  when unique_violation then
    return json_build_object('ok', false, 'error', 'That seat was just taken by another learner. Please choose another seat.');
  when raise_exception then
    return json_build_object('ok', false, 'error', 'This batch is full.');
end;
$$;

grant execute on function public.book_seat(uuid, uuid, text, int, text, boolean, text, text, text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. approve_registration(): pending -> registered (seat already held)
--    waitlist -> registered only if a seat is free (re-seats if needed)
-- ---------------------------------------------------------------------------
create or replace function public.approve_registration(p_reg_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg public.registrations%rowtype;
  v_course public.courses%rowtype;
  v_batch public.batches%rowtype;
  v_seat int;
begin
  select * into v_reg from public.registrations where id = p_reg_id;
  if not found then
    return json_build_object('ok', false, 'error', 'Registration not found.');
  end if;

  select * into v_course from public.courses
  where id = v_reg.course_id and provider_id = auth.uid() for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Not authorized.');
  end if;

  select * into v_batch from public.batches
  where id = v_reg.batch_id and course_id = v_reg.course_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Batch not found.');
  end if;

  select * into v_reg from public.registrations where id = p_reg_id for update;

  if v_reg.status not in ('pending', 'waitlist') then
    return json_build_object('ok', false, 'error', 'Only pending or waitlist requests can be approved.');
  end if;

  if v_reg.status = 'waitlist' then
    if public.batch_held_count(v_batch.id) >= least(40, v_batch.seats_total) then
      return json_build_object('ok', true, 'status', 'waitlist', 'seats_left', 0, 'batch_id', v_batch.id);
    end if;
    v_seat := v_reg.preferred_seat_number;
    if v_seat is null or exists (
      select 1 from public.registrations r
      where r.batch_id = v_batch.id and r.id <> v_reg.id
        and r.preferred_seat_number = v_seat
        and r.status in ('pending', 'registered', 'completed')
    ) then
      select min(n) into v_seat
      from generate_series(1, least(40, v_batch.seats_total)) n
      where not exists (
        select 1 from public.registrations r
        where r.batch_id = v_batch.id
          and r.preferred_seat_number = n
          and r.status in ('pending', 'registered', 'completed'));
    end if;
    update public.registrations set status = 'registered', preferred_seat_number = v_seat where id = p_reg_id;
  else
    update public.registrations set status = 'registered' where id = p_reg_id;
  end if;

  return json_build_object(
    'ok', true, 'status', 'registered',
    'seats_left', greatest(0, v_batch.seats_total - public.batch_held_count(v_batch.id)),
    'batch_id', v_batch.id);
end;
$$;

grant execute on function public.approve_registration(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Seat map: every seat held by a pending/registered/completed learner
-- ---------------------------------------------------------------------------
create or replace function public.get_batch_booked_seats(p_batch_id uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(preferred_seat_number order by preferred_seat_number), '[]'::json)
  from public.registrations
  where batch_id = p_batch_id
    and preferred_seat_number is not null
    and status in ('pending', 'registered', 'completed');
$$;

grant execute on function public.get_batch_booked_seats(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. Reviews & ratings
-- ---------------------------------------------------------------------------
create or replace view public.public_course_reviews
with (security_invoker = false) as
select
  r.id, r.course_id, r.learner_id, r.rating, r.body, r.created_at,
  p.full_name as learner_name,
  rr.id as reply_id, rr.review_id as reply_review_id,
  rr.partner_id as reply_partner_id, rr.body as reply_body,
  rr.created_at as reply_created_at
from public.reviews r
left join public.profiles p on p.id = r.learner_id
left join public.review_replies rr on rr.review_id = r.id;

grant select on public.public_course_reviews to anon, authenticated;

create or replace function public.submit_review(
  p_course_id uuid,
  p_rating int,
  p_body text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider uuid;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'error', 'Please sign in to leave a review.');
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    return json_build_object('ok', false, 'error', 'Choose a rating from 1 to 5 stars.');
  end if;

  select provider_id into v_provider from public.courses where id = p_course_id;
  if not found then
    return json_build_object('ok', false, 'error', 'Course not found.');
  end if;
  if v_provider = auth.uid() then
    return json_build_object('ok', false, 'error', 'You cannot review your own course.');
  end if;
  if not exists (select 1 from public.profiles where id = auth.uid()) then
    return json_build_object('ok', false, 'error', 'Please finish setting up your profile, then try again.');
  end if;

  insert into public.reviews (course_id, learner_id, rating, body)
  values (p_course_id, auth.uid(), p_rating, nullif(trim(coalesce(p_body, '')), ''))
  on conflict (course_id, learner_id)
  do update set rating = excluded.rating, body = excluded.body;

  return json_build_object('ok', true);
end;
$$;

grant execute on function public.submit_review(uuid, int, text) to authenticated;

create or replace function public.post_review_reply(p_review_id uuid, p_body text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'error', 'Please sign in.');
  end if;
  if nullif(trim(coalesce(p_body, '')), '') is null then
    return json_build_object('ok', false, 'error', 'Write a reply first.');
  end if;

  select c.provider_id into v_owner
  from public.reviews rv join public.courses c on c.id = rv.course_id
  where rv.id = p_review_id;
  if not found then
    return json_build_object('ok', false, 'error', 'Review not found.');
  end if;
  if v_owner <> auth.uid() then
    return json_build_object('ok', false, 'error', 'Only the course owner can reply.');
  end if;

  insert into public.review_replies (review_id, partner_id, body)
  values (p_review_id, auth.uid(), trim(p_body))
  on conflict (review_id)
  do update set body = excluded.body, partner_id = excluded.partner_id;

  return json_build_object('ok', true);
end;
$$;

grant execute on function public.post_review_reply(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Reload PostgREST so the new functions/columns are visible immediately
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';

commit;

-- ===========================================================================
-- Verification queries (run AFTER the migration; they only read data)
--
--   -- every batch: exactly 40 total, filled = held, never above 40
--   select id, seats_total, seats_filled, public.batch_held_count(id) as held
--   from public.batches
--   where seats_total <> 40 or seats_filled <> public.batch_held_count(id) or seats_filled > 40;
--   -- expected: 0 rows
--
--   -- no seat held twice
--   select batch_id, preferred_seat_number, count(*)
--   from public.registrations
--   where status in ('pending','registered','completed') and preferred_seat_number is not null
--   group by 1,2 having count(*) > 1;
--   -- expected: 0 rows
-- ===========================================================================

-- ########## PART 2: v8 ##########
-- ===========================================================================
-- SkillFarm v8 (2026-10-14). Run ONCE in Supabase SQL Editor (safe to re-run).
-- Run AFTER 20261013_client_fixes_v6.sql.
--
--  1. Course trainer fields (name, bio, photo is not included)
--  2. Course certificate file (partner upload) + 'course-certificates' bucket
--  3. public_courses view now exposes translations + trainer + certificate,
--     so signed-out / shared links show Tamil/Hindi text too
--  4. Multiple seats in one booking (book_seats) + per-seat cancel
-- ===========================================================================

-- 1 + 2. Columns -------------------------------------------------------------
alter table public.courses
  add column if not exists trainer_name text,
  add column if not exists trainer_bio text,
  add column if not exists certificate_url text,
  add column if not exists certificate_name text;

-- Certificate bucket: public read, partner uploads under their own uid folder.
insert into storage.buckets (id, name, public)
values ('course-certificates', 'course-certificates', true)
on conflict (id) do nothing;

drop policy if exists "course_certs_read_all" on storage.objects;
create policy "course_certs_read_all" on storage.objects
  for select to public using (bucket_id = 'course-certificates');

drop policy if exists "course_certs_insert_own" on storage.objects;
create policy "course_certs_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'course-certificates' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "course_certs_update_own" on storage.objects;
create policy "course_certs_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'course-certificates' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'course-certificates' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "course_certs_delete_own" on storage.objects;
create policy "course_certs_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'course-certificates' and (storage.foldername(name))[1] = auth.uid()::text);

-- 3. public_courses: add new columns at the END (CREATE OR REPLACE VIEW only
--    allows appending columns). -------------------------------------------------
create or replace view public.public_courses
with (security_invoker = false) as
select
  c.id, c.provider_id, c.title, c.description, c.category, c.address, c.city,
  c.state, c.start_date, c.duration_weeks, c.seats_total, c.seats_filled,
  c.fee, c.discount, c.image_url, c.images, c.learning_outcomes, c.agenda,
  c.batch_timings, c.registration_deadline, c.language, c.certificate_available,
  c.eligibility, c.created_at,
  p.full_name as provider_name,
  c.translations,
  c.trainer_name,
  c.trainer_bio,
  c.certificate_url,
  c.certificate_name
from public.courses c
inner join public.profiles p on p.id = c.provider_id
where coalesce(p.is_active, true) = true;

grant select on public.public_courses to anon;
grant select on public.public_courses to authenticated;

-- 4. Multiple seats ------------------------------------------------------------
-- One learner may now hold several seats in the same batch: one registration
-- row PER SEAT. The partial unique index on (batch_id, preferred_seat_number)
-- from v6 still guarantees a seat has one holder. The old one-row-per-learner
-- index must go.
drop index if exists public.registrations_course_student_batch_uidx;

create or replace function public.book_seats(
  p_course_id uuid,
  p_batch_id uuid,
  p_seat_numbers int[],
  p_email text default null,
  p_age int default null,
  p_location text default null,
  p_experience boolean default null,
  p_name text default null,
  p_phone text default null,
  p_additional_details text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course public.courses%rowtype;
  v_batch public.batches%rowtype;
  v_seats int[];
  v_seat int;
  v_active int;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_left int;
  v_fee numeric;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'error', 'Not signed in.');
  end if;

  -- de-duplicate + sort the requested seats
  select coalesce(array_agg(distinct s order by s), '{}') into v_seats
  from unnest(coalesce(p_seat_numbers, '{}')) as s
  where s is not null and s > 0;

  if array_length(v_seats, 1) is null then
    return json_build_object('ok', false, 'error', 'Please choose at least one available seat.');
  end if;
  if array_length(v_seats, 1) > 6 then
    return json_build_object('ok', false, 'error', 'You can book at most 6 seats in one booking.');
  end if;

  select * into v_course from public.courses where id = p_course_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Course not found.');
  end if;
  if v_course.provider_id = auth.uid() then
    return json_build_object('ok', false, 'error', 'You cannot book a seat in your own course.');
  end if;

  select * into v_batch from public.batches where id = p_batch_id and course_id = p_course_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Selected batch was not found.');
  end if;

  if v_batch.registration_deadline is not null
     and now() > (case
          when v_batch.registration_deadline = date_trunc('day', v_batch.registration_deadline at time zone 'UTC') at time zone 'UTC'
            then v_batch.registration_deadline + interval '1 day'
          else v_batch.registration_deadline end) then
    return json_build_object('ok', false, 'error', 'Booking for this batch is closed.');
  end if;

  foreach v_seat in array v_seats loop
    if v_seat > 40 or v_seat > v_batch.seats_total then
      return json_build_object('ok', false, 'error', 'Seat ' || v_seat || ' does not exist in this batch.');
    end if;
  end loop;

  -- cap per learner per batch
  select count(*) into v_active
  from public.registrations
  where course_id = p_course_id and batch_id = p_batch_id and student_id = auth.uid()
    and status in ('pending', 'registered', 'completed', 'waitlist');
  if v_active + array_length(v_seats, 1) > 6 then
    return json_build_object('ok', false,
      'error', 'You already hold ' || v_active || ' seat(s) in this batch. The limit is 6 per learner.');
  end if;

  if public.batch_held_count(p_batch_id) + array_length(v_seats, 1) > least(40, v_batch.seats_total) then
    return json_build_object('ok', false, 'error', 'Not enough free seats left in this batch.');
  end if;

  if exists (
    select 1 from public.registrations r
    where r.batch_id = p_batch_id
      and r.preferred_seat_number = any(v_seats)
      and r.status in ('pending', 'registered', 'completed')
  ) then
    return json_build_object('ok', false, 'error', 'One of those seats was just taken by another learner. Please choose again.');
  end if;

  v_fee := greatest(0, coalesce(v_course.fee, 0) - coalesce(v_course.discount, 0));

  foreach v_seat in array v_seats loop
    insert into public.registrations (
      course_id, student_id, batch_id, status, attendance_status,
      learner_email, learner_age, learner_location, learner_experience,
      learner_name, learner_phone, learner_additional_details, preferred_seat_number
    ) values (
      p_course_id, auth.uid(), p_batch_id, 'pending', 'pending',
      p_email, p_age, p_location, p_experience,
      p_name, p_phone, p_additional_details, v_seat
    ) returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;

  select greatest(0, b.seats_total - b.seats_filled) into v_left from public.batches b where b.id = p_batch_id;

  return json_build_object(
    'ok', true, 'status', 'pending',
    'registration_ids', to_json(v_ids),
    'seat_numbers', to_json(v_seats),
    'seat_count', array_length(v_seats, 1),
    'price_per_seat', v_fee,
    'total_price', v_fee * array_length(v_seats, 1),
    'seats_left', v_left,
    'batch_id', p_batch_id);

exception
  when unique_violation then
    return json_build_object('ok', false, 'error', 'One of those seats was just taken by another learner. Please choose again.');
  when raise_exception then
    return json_build_object('ok', false, 'error', 'This batch is full.');
end;
$$;

grant execute on function public.book_seats(uuid, uuid, int[], text, int, text, boolean, text, text, text) to authenticated;

-- Old single-seat entry point keeps working (delegates to book_seats).
create or replace function public.book_seat(
  p_course_id uuid, p_batch_id uuid, p_email text default null, p_age int default null,
  p_location text default null, p_experience boolean default null, p_name text default null,
  p_phone text default null, p_additional_details text default null, p_preferred_seat_number int default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res json;
begin
  if p_preferred_seat_number is null or p_preferred_seat_number <= 0 then
    return json_build_object('ok', false, 'error', 'Please choose an available seat.');
  end if;
  v_res := public.book_seats(p_course_id, p_batch_id, array[p_preferred_seat_number],
    p_email, p_age, p_location, p_experience, p_name, p_phone, p_additional_details);
  if (v_res->>'ok')::boolean then
    return json_build_object('ok', true, 'status', 'pending',
      'registration_id', (v_res->'registration_ids'->>0)::uuid,
      'seat_number', p_preferred_seat_number,
      'seats_left', (v_res->>'seats_left')::int,
      'batch_id', p_batch_id);
  end if;
  return v_res;
end;
$$;

grant execute on function public.book_seat(uuid, uuid, text, int, text, boolean, text, text, text, int) to authenticated;

-- Cancel ONE seat (registration row) that belongs to the caller.
create or replace function public.cancel_my_registration(p_reg_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg public.registrations%rowtype;
  v_left int;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'error', 'Not signed in.');
  end if;

  select * into v_reg from public.registrations where id = p_reg_id and student_id = auth.uid() for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Registration not found.');
  end if;
  if v_reg.status in ('cancelled', 'rejected') then
    return json_build_object('ok', true, 'status', v_reg.status, 'batch_id', v_reg.batch_id);
  end if;
  if v_reg.status = 'completed' then
    return json_build_object('ok', false, 'error', 'A completed course cannot be cancelled.');
  end if;

  update public.registrations set status = 'cancelled', attendance_status = 'pending' where id = v_reg.id;

  select greatest(0, seats_total - seats_filled) into v_left from public.batches where id = v_reg.batch_id;
  return json_build_object('ok', true, 'status', 'cancelled', 'seats_left', v_left, 'batch_id', v_reg.batch_id);
end;
$$;

grant execute on function public.cancel_my_registration(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verification (each must return the stated result)
-- ---------------------------------------------------------------------------
-- a) 4 rows:
--    select column_name from information_schema.columns
--     where table_name = 'courses' and column_name in
--       ('trainer_name','trainer_bio','certificate_url','certificate_name');
-- b) 1 row:  select id from storage.buckets where id = 'course-certificates';
-- c) 0 rows: select 1 from pg_indexes where indexname = 'registrations_course_student_batch_uidx';
-- d) 0 rows (no batch over 40):
--    select batch_id, count(*) from public.registrations
--     where status in ('pending','registered','completed') group by batch_id having count(*) > 40;
