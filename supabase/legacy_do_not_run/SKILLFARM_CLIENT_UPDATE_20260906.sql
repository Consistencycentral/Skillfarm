-- SkillFarm client-ready database update
-- Run this ENTIRE file once in the Supabase SQL Editor for the project's database.
-- It enables multiple batches, batch-aware registrations, learner registration snapshots,
-- and signed-in course reviews. Safe to re-run where the underlying migrations are idempotent.

-- ============================================================================
-- SkillFarm — PASS 3: Multiple batches per course
-- 2026-09-03
--
-- SAFE / NON-DESTRUCTIVE:
--   * Does NOT drop courses or registrations.
--   * Existing registrations are assigned to a legacy batch.
--   * Existing course seats_total / seats_filled are preserved.
--   * Existing registration status values remain valid, including waitlist.
--   * Learners continue to use the RPCs; direct registration writes stay blocked.
--
-- Run only after reviewing this file. It is written to be re-runnable.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Batches
-- ---------------------------------------------------------------------------
create table if not exists public.batches (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  name text not null,
  start_date date,
  end_date date,
  duration_weeks int,
  timings text,
  seats_total int not null default 0 check (seats_total >= 0),
  seats_filled int not null default 0 check (seats_filled >= 0),
  registration_deadline timestamptz,
  created_at timestamptz not null default now(),
  constraint batches_dates_check check (
    start_date is null or end_date is null or end_date >= start_date
  ),
  constraint batches_duration_check check (
    duration_weeks is null or duration_weeks > 0
  ),
  constraint batches_seats_check check (seats_filled <= seats_total)
);

create index if not exists batches_course_id_idx
  on public.batches(course_id);

create index if not exists batches_course_start_date_idx
  on public.batches(course_id, start_date);

-- One course can have many batches, but a batch name is unique inside that course.
create unique index if not exists batches_course_name_uidx
  on public.batches(course_id, lower(name));

-- ---------------------------------------------------------------------------
-- 2) Add batch_id without touching existing registration rows yet.
-- ---------------------------------------------------------------------------
alter table public.registrations
  add column if not exists batch_id uuid;

create index if not exists registrations_batch_id_idx
  on public.registrations(batch_id);

-- ---------------------------------------------------------------------------
-- 3) Create one legacy/default batch for every existing course that has no
--    batch yet. This copies the course-level values exactly.
--
-- Existing course data is therefore not recalculated or discarded.
-- ---------------------------------------------------------------------------
insert into public.batches (
  course_id,
  name,
  start_date,
  end_date,
  duration_weeks,
  timings,
  seats_total,
  seats_filled,
  registration_deadline
)
select
  c.id,
  'Batch 1',
  c.start_date,
  case
    when c.start_date is not null and c.duration_weeks is not null
      then c.start_date + (c.duration_weeks * 7 - 1)
    else null
  end,
  c.duration_weeks,
  c.batch_timings,
  c.seats_total,
  c.seats_filled,
  case
    when c.registration_deadline is null then null
    else c.registration_deadline::timestamptz
  end
from public.courses c
where not exists (
  select 1
  from public.batches b
  where b.course_id = c.id
);

-- ---------------------------------------------------------------------------
-- 4) Preserve every existing registration by assigning it to the first
--    existing batch for its course.
--
-- This also makes the migration safe if it is re-run after a partial attempt.
-- ---------------------------------------------------------------------------
update public.registrations r
set batch_id = b.id
from lateral (
  select b1.id
  from public.batches b1
  where b1.course_id = r.course_id
  order by b1.created_at asc, b1.id asc
  limit 1
) b
where r.batch_id is null
  and b.id is not null;

-- A valid SkillFarm registration must belong to a course, and every course now
-- has at least one batch. Refuse to silently create bad rows if that invariant
-- is somehow broken in a manually modified database.
do $$
begin
  if exists (
    select 1
    from public.registrations
    where batch_id is null
  ) then
    raise exception
      'PASS 3 stopped safely: some registrations could not be assigned to a batch.';
  end if;
end $$;

alter table public.registrations
  alter column batch_id set not null;

alter table public.registrations
  drop constraint if exists registrations_batch_id_fkey;

alter table public.registrations
  add constraint registrations_batch_id_fkey
  foreign key (batch_id) references public.batches(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 5) Replace the old UNIQUE(course_id, student_id).
--
-- IMPORTANT: the old constraint is incompatible with multiple batches.
-- We identify it by the columns, rather than assuming a constraint name.
-- ---------------------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'registrations'
      and con.contype = 'u'
      and (
        select array_agg(att.attname order by x.ord)
        from unnest(con.conkey) with ordinality as x(attnum, ord)
        join pg_attribute att
          on att.attrelid = rel.oid
         and att.attnum = x.attnum
      )::text[] = array['course_id','student_id']::text[]
  loop
    execute format(
      'alter table public.registrations drop constraint %I',
      c.conname
    );
  end loop;
end $$;

create unique index if not exists registrations_course_student_batch_uidx
  on public.registrations(course_id, student_id, batch_id);

-- ---------------------------------------------------------------------------
-- 6) RLS for batches.
-- ---------------------------------------------------------------------------
alter table public.batches enable row level security;

drop policy if exists "batches select authenticated" on public.batches;
create policy "batches select authenticated"
on public.batches
for select
to authenticated
using (
  exists (
    select 1
    from public.courses c
    where c.id = batches.course_id
      and (
        c.provider_id = auth.uid()
        or exists (
          select 1
          from public.profiles p
          where p.id = c.provider_id
            and (p.is_active is null or p.is_active = true)
        )
      )
  )
);

-- Do not expose direct batch writes. Seat/capacity changes must lock the
-- parent course first so they cannot deadlock with enrollment RPCs.
drop policy if exists "batches insert provider" on public.batches;
drop policy if exists "batches update provider" on public.batches;
drop policy if exists "batches delete provider" on public.batches;

revoke insert, update, delete on public.batches from authenticated;

-- ---------------------------------------------------------------------------
-- 7) Seat invariants.
--
-- `registrations.status='registered'` is the source of truth for batch
-- seats_filled. Batch capacity is provider-controlled; filled seats are not.
-- This prevents a provider/API client from accidentally editing seats_filled.
--
-- Existing course seats_filled is preserved during the migration by the
-- legacy batch copy. After the backfill, we reconcile the batch fill count to
-- the existing registration data. If an old database has a mismatch between
-- its counter and its registration rows, the existing course counter wins
-- during migration; new changes are then kept correct by these triggers.
-- ---------------------------------------------------------------------------

-- Never cascade-delete a batch that already has registrations. This protects
-- historical enrollment data and forces the provider to resolve registrations
-- explicitly before removing a batch.
create or replace function public.prevent_batch_delete_with_registrations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.registrations r where r.batch_id = old.id
  ) then
    raise exception 'Cannot delete a batch that has registrations.';
  end if;

  if not exists (
    select 1
    from public.batches b
    where b.course_id = old.course_id
      and b.id <> old.id
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

-- When a batch is inserted/updated, force its filled count to the actual
-- number of currently registered registrations. This means direct table edits
-- cannot manufacture seats.
create or replace function public.enforce_batch_filled_seats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Keep the two date fields and duration useful whichever form the UI sends.
  if new.start_date is not null and new.end_date is null and new.duration_weeks is not null then
    new.end_date := new.start_date + (new.duration_weeks * 7 - 1);
  elsif new.start_date is not null and new.end_date is not null and new.duration_weeks is null then
    new.duration_weeks := greatest(
      1,
      ceil(((new.end_date - new.start_date) + 1)::numeric / 7)::int
    );
  end if;

  if tg_op = 'INSERT' then
    new.seats_filled := 0;
  else
    new.seats_filled := (
      select count(*)::int
      from public.registrations r
      where r.batch_id = new.id
        and r.status = 'registered'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_batch_filled_seats on public.batches;
create trigger trg_enforce_batch_filled_seats
before insert or update on public.batches
for each row execute function public.enforce_batch_filled_seats();

-- Registration status changes maintain the batch counter atomically.
create or replace function public.sync_batch_filled_from_registration()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_registered boolean := false;
  v_new_registered boolean := false;
begin
  if tg_op <> 'INSERT' then
    v_old_registered := old.status = 'registered';
  end if;

  if tg_op <> 'DELETE' then
    v_new_registered := new.status = 'registered';
  end if;

  if tg_op = 'UPDATE' and old.batch_id is distinct from new.batch_id then
    if v_old_registered then
      update public.batches
      set seats_filled = greatest(0, seats_filled - 1)
      where id = old.batch_id;
    end if;

    if v_new_registered then
      update public.batches
      set seats_filled = seats_filled + 1
      where id = new.batch_id
        and seats_filled < seats_total;
      if not found then
        raise exception 'Cannot register: batch is full.';
      end if;
    end if;
  else
    if not v_old_registered and v_new_registered then
      update public.batches
      set seats_filled = seats_filled + 1
      where id = new.batch_id
        and seats_filled < seats_total;
      if not found then
        raise exception 'Cannot register: batch is full.';
      end if;
    elsif v_old_registered and not v_new_registered then
      update public.batches
      set seats_filled = greatest(0, seats_filled - 1)
      where id = old.batch_id;
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_sync_batch_filled_from_registration on public.registrations;
create trigger trg_sync_batch_filled_from_registration
after insert or update of status, batch_id or delete on public.registrations
for each row execute function public.sync_batch_filled_from_registration();

-- Course aggregate always mirrors the batches.
create or replace function public.sync_course_batch_seats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course_id uuid;
begin
  v_course_id := coalesce(new.course_id, old.course_id);

  update public.courses c
  set
    seats_total = coalesce((
      select sum(b.seats_total)::int
      from public.batches b
      where b.course_id = v_course_id
    ), 0),
    seats_filled = coalesce((
      select sum(b.seats_filled)::int
      from public.batches b
      where b.course_id = v_course_id
    ), 0)
  where c.id = v_course_id;

  if tg_op = 'UPDATE' and old.course_id is distinct from new.course_id then
    update public.courses c
    set
      seats_total = coalesce((
        select sum(b.seats_total)::int
        from public.batches b
        where b.course_id = old.course_id
      ), 0),
      seats_filled = coalesce((
        select sum(b.seats_filled)::int
        from public.batches b
        where b.course_id = old.course_id
      ), 0)
    where c.id = old.course_id;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_sync_course_batch_seats on public.batches;
create trigger trg_sync_course_batch_seats
after insert or update or delete on public.batches
for each row execute function public.sync_course_batch_seats();

-- Protect the aggregate columns from direct client edits once batches exist.
-- The batch aggregate trigger is allowed because it runs inside a trigger
-- context (pg_trigger_depth() > 0).
create or replace function public.guard_course_aggregate_seats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() = 0
     and exists (select 1 from public.batches b where b.course_id = old.id)
     and (
       new.seats_total is distinct from old.seats_total
       or new.seats_filled is distinct from old.seats_filled
     ) then
    raise exception 'Course seat totals are managed by batches. Edit the batch capacity instead.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_course_aggregate_seats on public.courses;
create trigger trg_guard_course_aggregate_seats
before update on public.courses
for each row execute function public.guard_course_aggregate_seats();

-- Any newly created course gets one initial batch. This keeps the existing
-- course-creation flow working without requiring a second client request.
create or replace function public.create_default_batch_for_course()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.batches (
    course_id, name, start_date, end_date, duration_weeks, timings,
    seats_total, seats_filled, registration_deadline
  )
  values (
    new.id,
    'Batch 1',
    new.start_date,
    case
      when new.start_date is not null and new.duration_weeks is not null
        then new.start_date + (new.duration_weeks * 7 - 1)
      else null
    end,
    new.duration_weeks,
    new.batch_timings,
    new.seats_total,
    0,
    case
      when new.registration_deadline is null then null
      else new.registration_deadline::timestamptz
    end
  );

  return new;
end;
$$;

drop trigger if exists trg_create_default_batch_for_course on public.courses;
create trigger trg_create_default_batch_for_course
after insert on public.courses
for each row execute function public.create_default_batch_for_course();

-- New tables created in the SQL editor do not rely on dashboard defaults for
-- privileges. RLS remains the actual security boundary.
grant select, insert, update, delete on public.batches to authenticated;

-- Provider batch management RPCs. Every write locks course first.
create or replace function public.create_batch(
  p_course_id uuid,
  p_name text,
  p_start_date date default null,
  p_end_date date default null,
  p_duration_weeks int default null,
  p_timings text default null,
  p_seats_total int default 0,
  p_registration_deadline timestamptz default null
)
returns public.batches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course public.courses%rowtype;
  v_batch public.batches%rowtype;
begin
  select * into v_course
  from public.courses
  where id = p_course_id and provider_id = auth.uid()
  for update;

  if not found then
    raise exception 'Not authorized.';
  end if;

  insert into public.batches (
    course_id, name, start_date, end_date, duration_weeks, timings,
    seats_total, seats_filled, registration_deadline
  )
  values (
    p_course_id, trim(p_name), p_start_date, p_end_date, p_duration_weeks,
    nullif(trim(p_timings), ''), greatest(0, p_seats_total), 0,
    p_registration_deadline
  )
  returning * into v_batch;

  return v_batch;
end;
$$;

create or replace function public.update_batch(
  p_batch_id uuid,
  p_name text default null,
  p_start_date date default null,
  p_end_date date default null,
  p_duration_weeks int default null,
  p_timings text default null,
  p_seats_total int default null,
  p_registration_deadline timestamptz default null
)
returns public.batches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.batches%rowtype;
  v_course public.courses%rowtype;
begin
  select b.* into v_batch
  from public.batches b
  where b.id = p_batch_id;

  if not found then
    raise exception 'Batch not found.';
  end if;

  select * into v_course
  from public.courses
  where id = v_batch.course_id and provider_id = auth.uid()
  for update;

  if not found then
    raise exception 'Not authorized.';
  end if;

  update public.batches
  set
    name = coalesce(nullif(trim(p_name), ''), name),
    start_date = p_start_date,
    end_date = p_end_date,
    duration_weeks = p_duration_weeks,
    timings = nullif(trim(coalesce(p_timings, '')), ''),
    seats_total = coalesce(p_seats_total, seats_total),
    registration_deadline = p_registration_deadline
  where id = p_batch_id
  returning * into v_batch;

  return v_batch;
end;
$$;

create or replace function public.delete_batch(p_batch_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.batches%rowtype;
  v_course public.courses%rowtype;
begin
  select * into v_batch from public.batches where id = p_batch_id;
  if not found then
    raise exception 'Batch not found.';
  end if;

  select * into v_course
  from public.courses
  where id = v_batch.course_id and provider_id = auth.uid()
  for update;

  if not found then
    raise exception 'Not authorized.';
  end if;

  delete from public.batches where id = p_batch_id;
  return true;
end;
$$;

grant execute on function public.create_batch(uuid,text,date,date,int,text,int,timestamptz) to authenticated;
grant execute on function public.update_batch(uuid,text,date,date,int,text,int,timestamptz) to authenticated;
grant execute on function public.delete_batch(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8) PASS 3 enrollment RPCs.
--
-- All seat-changing paths lock the course FIRST, then the batch, then the
-- registration. This gives register / approve / cancel / reject the same lock
-- order and prevents overbooking + reduces deadlock risk.
-- ---------------------------------------------------------------------------

-- Remove the old no-capture and capture signatures before creating the new one.
drop function if exists public.register_seat(uuid);
drop function if exists public.register_seat(uuid, text, int, text, boolean);
drop function if exists public.register_seat(uuid, uuid);
drop function if exists public.register_seat(uuid, uuid, text, int, text, boolean);

create or replace function public.register_seat(
  p_course_id uuid,
  p_batch_id uuid,
  p_email text default null,
  p_age int default null,
  p_location text default null,
  p_experience boolean default null
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
  v_status text;
  v_left int;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'error', 'Not signed in.');
  end if;

  select * into v_course
  from public.courses
  where id = p_course_id
  for update;

  if not found then
    return json_build_object('ok', false, 'error', 'Course not found.');
  end if;

  select * into v_batch
  from public.batches
  where id = p_batch_id
    and course_id = p_course_id
  for update;

  if not found then
    return json_build_object('ok', false, 'error', 'Selected batch was not found.');
  end if;

  if v_batch.registration_deadline is not null
     and now() > v_batch.registration_deadline then
    return json_build_object('ok', false, 'error', 'Registration for this batch is closed.');
  end if;

  select * into v_existing
  from public.registrations
  where course_id = p_course_id
    and student_id = auth.uid()
    and batch_id = p_batch_id
  for update;

  if found and v_existing.status in
    ('pending','registered','waitlist','completed') then
    return json_build_object(
      'ok', false,
      'status', v_existing.status,
      'error', 'You already have a registration for this batch.'
    );
  end if;

  if v_batch.seats_total > v_batch.seats_filled then
    v_status := 'pending';
  else
    v_status := 'waitlist';
  end if;

  if found then
    update public.registrations
    set
      status = v_status,
      attendance_status = 'pending',
      registered_at = now(),
      learner_email = p_email,
      learner_age = p_age,
      learner_location = p_location,
      learner_experience = p_experience
    where id = v_existing.id;
  else
    insert into public.registrations (
      course_id, student_id, batch_id, status, attendance_status,
      learner_email, learner_age, learner_location, learner_experience
    )
    values (
      p_course_id, auth.uid(), p_batch_id, v_status, 'pending',
      p_email, p_age, p_location, p_experience
    );
  end if;

  select greatest(0, seats_total - seats_filled)
  into v_left
  from public.batches
  where id = p_batch_id;

  return json_build_object(
    'ok', true,
    'status', v_status,
    'seats_left', v_left,
    'batch_id', p_batch_id
  );
end;
$$;

grant execute on function public.register_seat(uuid, uuid, text, int, text, boolean)
to authenticated;

-- Backward-compatible wrapper for older clients. It deliberately chooses the
-- earliest-created batch instead of guessing from seat totals.
create or replace function public.register_seat(
  p_course_id uuid,
  p_email text default null,
  p_age int default null,
  p_location text default null,
  p_experience boolean default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
begin
  select id into v_batch_id
  from public.batches
  where course_id = p_course_id
  order by created_at asc, id asc
  limit 1;

  if v_batch_id is null then
    return json_build_object('ok', false, 'error', 'No batch exists for this course.');
  end if;

  return public.register_seat(
    p_course_id, v_batch_id, p_email, p_age, p_location, p_experience
  );
end;
$$;

grant execute on function public.register_seat(uuid, text, int, text, boolean)
to authenticated;

-- ---------------------------------------------------------------------------
-- Approval: lock course -> batch -> registration.
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
  v_left int;
begin
  select * into v_reg from public.registrations where id = p_reg_id;
  if not found then
    return json_build_object('ok', false, 'error', 'Registration not found.');
  end if;

  -- Same lock order as register/cancel/reject: course -> batch -> registration.
  select * into v_course
  from public.courses
  where id = v_reg.course_id and provider_id = auth.uid()
  for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Not authorized.');
  end if;

  select * into v_batch
  from public.batches
  where id = v_reg.batch_id and course_id = v_reg.course_id
  for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Batch not found.');
  end if;

  select * into v_reg from public.registrations where id = p_reg_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Registration not found.');
  end if;

  if v_reg.status not in ('pending','waitlist') then
    return json_build_object(
      'ok', false,
      'error', 'Only pending or waitlist registrations can be approved.'
    );
  end if;

  v_left := greatest(0, v_batch.seats_total - v_batch.seats_filled);

  if v_left > 0 then
    update public.registrations
    set status = 'registered'
    where id = p_reg_id;

    -- The registration trigger atomically updates batch + course aggregates.
    return json_build_object(
      'ok', true,
      'status', 'registered',
      'seats_left', v_left - 1,
      'batch_id', v_batch.id
    );
  end if;

  update public.registrations
  set status = 'waitlist'
  where id = p_reg_id;

  return json_build_object(
    'ok', true,
    'status', 'waitlist',
    'seats_left', 0,
    'batch_id', v_batch.id
  );
end;
$$;

grant execute on function public.approve_registration(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Reject: release a held batch seat only when the old status was registered.
-- ---------------------------------------------------------------------------
create or replace function public.reject_registration(p_reg_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg public.registrations%rowtype;
  v_course public.courses%rowtype;
  v_batch public.batches%rowtype;
begin
  select * into v_reg from public.registrations where id = p_reg_id;
  if not found then
    return json_build_object('ok', false, 'error', 'Registration not found.');
  end if;

  select * into v_course
  from public.courses
  where id = v_reg.course_id and provider_id = auth.uid()
  for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Not authorized.');
  end if;

  select * into v_batch
  from public.batches
  where id = v_reg.batch_id and course_id = v_reg.course_id
  for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Batch not found.');
  end if;

  select * into v_reg from public.registrations where id = p_reg_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Registration not found.');
  end if;

  if v_reg.status not in ('pending','waitlist','registered') then
    return json_build_object('ok', false, 'error', 'Nothing to reject.');
  end if;

  update public.registrations
  set status = 'rejected', attendance_status = 'pending'
  where id = p_reg_id;

  return json_build_object(
    'ok', true,
    'status', 'rejected',
    'batch_id', v_batch.id
  );
end;
$$;

grant execute on function public.reject_registration(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Cancel: release only the selected batch's held seat.
-- ---------------------------------------------------------------------------
create or replace function public.free_seat(p_course_id uuid, p_batch_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course public.courses%rowtype;
  v_batch public.batches%rowtype;
  v_reg public.registrations%rowtype;
  v_left int;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'error', 'Not signed in.');
  end if;

  select * into v_course
  from public.courses
  where id = p_course_id
  for update;

  if not found then
    return json_build_object('ok', false, 'error', 'Course not found.');
  end if;

  select * into v_batch
  from public.batches
  where id = p_batch_id
    and course_id = p_course_id
  for update;

  if not found then
    return json_build_object('ok', false, 'error', 'Batch not found.');
  end if;

  select * into v_reg
  from public.registrations
  where course_id = p_course_id
    and batch_id = p_batch_id
    and student_id = auth.uid()
  for update;

  if not found then
    return json_build_object('ok', false, 'error', 'No registration found for this batch.');
  end if;

  if v_reg.status in ('cancelled','rejected') then
    return json_build_object(
      'ok', true,
      'status', v_reg.status,
      'batch_id', p_batch_id
    );
  end if;

  if v_reg.status = 'completed' then
    return json_build_object(
      'ok', false,
      'error', 'A completed course cannot be cancelled.'
    );
  end if;

  if v_reg.status = 'registered' then
  end if;

  update public.registrations
  set status = 'cancelled', attendance_status = 'pending'
  where id = v_reg.id;

  select greatest(0, seats_total - seats_filled)
  into v_left
  from public.batches
  where id = p_batch_id;

  return json_build_object(
    'ok', true,
    'status', 'cancelled',
    'seats_left', v_left,
    'batch_id', p_batch_id
  );
end;
$$;

grant execute on function public.free_seat(uuid, uuid) to authenticated;

-- Backward-compatible cancellation wrapper: use the learner's existing batch.
create or replace function public.free_seat(p_course_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
begin
  select batch_id into v_batch_id
  from public.registrations
  where course_id = p_course_id
    and student_id = auth.uid()
  order by registered_at desc
  limit 1;

  if v_batch_id is null then
    return json_build_object('ok', false, 'error', 'No registration found for this course.');
  end if;

  return public.free_seat(p_course_id, v_batch_id);
end;
$$;

grant execute on function public.free_seat(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9) Remove the old trigger/function if present from a partial PASS 3.
-- ---------------------------------------------------------------------------
drop function if exists public.sync_batch_seats_to_course();

-- ---------------------------------------------------------------------------
-- 10) Final invariant check.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from public.batches where seats_filled > seats_total
  ) then
    raise exception 'PASS 3 stopped: a batch has seats_filled > seats_total.';
  end if;

  if exists (
    select 1
    from public.courses c
    where c.seats_total <> coalesce((
      select sum(b.seats_total)::int from public.batches b where b.course_id = c.id
    ),0)
  ) then
    raise exception 'PASS 3 stopped: course seats_total does not match batch aggregate.';
  end if;

  if exists (
    select 1
    from public.courses c
    where c.seats_filled <> coalesce((
      select sum(b.seats_filled)::int from public.batches b where b.course_id = c.id
    ),0)
  ) then
    raise exception 'PASS 3 stopped: course seats_filled does not match batch aggregate.';
  end if;
end $$;

commit;


-- SkillFarm: authenticated review access
-- Client requirement: signed-in users may rate/comment without an approved registration.
-- Course-owner self-review remains blocked by the application UI; ownership can also be
-- enforced in a later policy if the production schema exposes provider ownership directly.

alter table public.reviews enable row level security;

drop policy if exists "reviews_insert_registered" on public.reviews;
drop policy if exists "reviews_insert_authenticated" on public.reviews;

create policy "reviews_insert_authenticated" on public.reviews
  for insert to authenticated
  with check (learner_id = auth.uid());


-- SkillFarm: snapshot the learner's registration contact/details.
-- Keeps the existing profile fields while storing what the learner submitted
-- for this particular course request.
alter table public.registrations
  add column if not exists learner_name text,
  add column if not exists learner_phone text,
  add column if not exists learner_additional_details text;

-- New capture-aware registration RPC. The older signatures remain available for
-- older clients, while the current app sends the full registration snapshot.
drop function if exists public.register_seat(uuid, uuid, text, int, text, boolean, text, text, text);

create or replace function public.register_seat(
  p_course_id uuid,
  p_batch_id uuid,
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
  v_existing public.registrations%rowtype;
  v_status text;
  v_left int;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'error', 'Not signed in.');
  end if;

  select * into v_course from public.courses where id = p_course_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Course not found.');
  end if;

  select * into v_batch
  from public.batches
  where id = p_batch_id and course_id = p_course_id
  for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Selected batch was not found.');
  end if;

  if v_batch.registration_deadline is not null and now() > v_batch.registration_deadline then
    return json_build_object('ok', false, 'error', 'Registration for this batch is closed.');
  end if;

  select * into v_existing
  from public.registrations
  where course_id = p_course_id and student_id = auth.uid() and batch_id = p_batch_id
  for update;

  if found and v_existing.status in ('pending','registered','waitlist','completed') then
    return json_build_object('ok', false, 'status', v_existing.status,
      'error', 'You already have a registration for this batch.');
  end if;

  if v_batch.seats_total > v_batch.seats_filled then
    v_status := 'pending';
  else
    v_status := 'waitlist';
  end if;

  if found then
    update public.registrations set
      status = v_status,
      attendance_status = 'pending',
      registered_at = now(),
      learner_name = nullif(trim(p_name), ''),
      learner_phone = nullif(trim(p_phone), ''),
      learner_email = nullif(trim(p_email), ''),
      learner_age = p_age,
      learner_location = nullif(trim(p_location), ''),
      learner_experience = p_experience,
      learner_additional_details = nullif(trim(p_additional_details), '')
    where id = v_existing.id;
  else
    insert into public.registrations (
      course_id, student_id, batch_id, status, attendance_status,
      learner_name, learner_phone, learner_email, learner_age,
      learner_location, learner_experience, learner_additional_details
    ) values (
      p_course_id, auth.uid(), p_batch_id, v_status, 'pending',
      nullif(trim(p_name), ''), nullif(trim(p_phone), ''), nullif(trim(p_email), ''),
      p_age, nullif(trim(p_location), ''), p_experience,
      nullif(trim(p_additional_details), '')
    );
  end if;

  select greatest(0, seats_total - seats_filled) into v_left
  from public.batches where id = p_batch_id;

  return json_build_object('ok', true, 'status', v_status,
    'seats_left', v_left, 'batch_id', p_batch_id);
end;
$$;

grant execute on function public.register_seat(uuid, uuid, text, int, text, boolean, text, text, text)
to authenticated;

-- Keep the legacy six-argument function synchronized with the new snapshot
-- columns. Existing older clients continue to work.
create or replace function public.register_seat(
  p_course_id uuid,
  p_batch_id uuid,
  p_email text default null,
  p_age int default null,
  p_location text default null,
  p_experience boolean default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_phone text;
begin
  select full_name, phone into v_name, v_phone from public.profiles where id = auth.uid();
  return public.register_seat(p_course_id, p_batch_id, p_email, p_age, p_location, p_experience, v_name, v_phone, null);
end;
$$;

grant execute on function public.register_seat(uuid, uuid, text, int, text, boolean) to authenticated;


-- Refresh PostgREST so registrations -> batches relationship is visible immediately.
notify pgrst, 'reload schema';

-- ============================================================================
-- FINAL CLIENT UPDATE — organization image gallery + schema-cache refresh
-- ============================================================================
alter table public.profiles
  add column if not exists org_images text[] not null default '{}';

create or replace view public.public_orgs
with (security_invoker = false) as
select
  p.id, p.full_name, p.org_name, p.org_logo_url, p.org_images, p.org_about,
  p.org_year_established, p.org_type, p.org_registration_number, p.org_website,
  p.org_address, p.org_maps_url, p.org_languages, p.org_sectors,
  coalesce(json_agg(
    json_build_object(
      'name', t.name, 'qualification', t.qualification,
      'experience', t.experience, 'expertise', t.expertise
    ) order by t.created_at
  ) filter (where t.id is not null), '[]'::json) as trainers
from public.profiles p
left join public.trainers t on t.provider_id = p.id
where (p.is_active is null or p.is_active = true)
group by p.id;

grant select on public.public_orgs to anon;
grant select on public.public_orgs to authenticated;

-- PostgREST relationship cache refresh. Required for
-- registrations -> batches embedded selects used by My Seats/provider views.
notify pgrst, 'reload schema';
