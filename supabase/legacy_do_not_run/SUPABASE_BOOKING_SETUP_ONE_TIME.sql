-- SkillFarm booking setup bundle. Run only on the intended SkillFarm Supabase project.
-- Prefer the normal Supabase migration workflow when available.

-- ===== supabase/migrations/20260903_multi_batch_system.sql =====
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

-- Refresh PostgREST's relationship cache so registrations -> batches is visible immediately.
notify pgrst, 'reload schema';


-- ===== supabase/migrations/20260909_seat_preference.sql =====
-- SkillFarm: optional theatre-style seat preference for batch registration.
-- This is intentionally a preference, not a capacity reservation. The existing
-- approval RPC remains the authority for capacity; providers can confirm or
-- change the seat when approving a request. No production data is deleted.
alter table public.registrations
  add column if not exists preferred_seat_number integer;

alter table public.registrations
  drop constraint if exists registrations_preferred_seat_check;
alter table public.registrations
  add constraint registrations_preferred_seat_check
  check (preferred_seat_number is null or preferred_seat_number > 0);

create index if not exists registrations_batch_preferred_seat_idx
  on public.registrations(batch_id, preferred_seat_number)
  where preferred_seat_number is not null;

-- Existing registration RPC remains authoritative. This helper lets the UI
-- store a preferred seat without granting learners direct UPDATE access.
create or replace function public.set_preferred_seat(p_reg_id uuid, p_seat_number integer)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg public.registrations%rowtype;
  v_batch public.batches%rowtype;
begin
  if auth.uid() is null then return json_build_object('ok', false, 'error', 'Not signed in.'); end if;
  select * into v_reg from public.registrations where id = p_reg_id and student_id = auth.uid() for update;
  if not found then return json_build_object('ok', false, 'error', 'Registration not found.'); end if;
  select * into v_batch from public.batches where id = v_reg.batch_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Batch not found.'); end if;
  if p_seat_number is null or p_seat_number < 1 or p_seat_number > v_batch.seats_total then
    return json_build_object('ok', false, 'error', 'Seat is outside this batch capacity.');
  end if;
  update public.registrations set preferred_seat_number = p_seat_number where id = v_reg.id;
  return json_build_object('ok', true, 'preferred_seat_number', p_seat_number);
end;
$$;

grant execute on function public.set_preferred_seat(uuid, integer) to authenticated;


-- ===== supabase/migrations/20261007_theatre_seat_map.sql =====
-- Theatre-style seat status. Safe to apply on existing SkillFarm data.
-- Pending/registered/completed seats are treated as booked so learners never pick an already requested seat.
create or replace function public.get_batch_booked_seats(p_batch_id uuid)
returns json
language sql
security definer
set search_path = public
as $$
  select coalesce(json_agg(preferred_seat_number order by preferred_seat_number), '[]'::json)
  from public.registrations
  where batch_id = p_batch_id
    and preferred_seat_number is not null
    and status in ('pending','registered','completed');
$$;

grant execute on function public.get_batch_booked_seats(uuid) to anon, authenticated;


-- ===== supabase/migrations/20261008_booking_payment_flow.sql =====
-- SkillFarm booking + Razorpay payment flow.
-- Flow: Batch -> exact seat -> learner details -> pending seat hold -> Razorpay -> paid/registered.
-- Existing registered rows are preserved as paid/not-required so current learners are not locked out.

alter table public.registrations
  add column if not exists payment_status text;

alter table public.registrations
  add column if not exists payment_amount numeric(12,2);

alter table public.registrations
  add column if not exists payment_currency text;

alter table public.registrations
  add column if not exists razorpay_payment_link_id text;

alter table public.registrations
  add column if not exists razorpay_payment_id text;

alter table public.registrations
  add column if not exists payment_link_url text;

alter table public.registrations
  add column if not exists payment_paid_at timestamptz;

update public.registrations
set payment_status = case
  when status in ('registered','completed') then 'not_required'
  else 'unpaid'
end
where payment_status is null;

update public.registrations
set payment_currency = 'INR'
where payment_currency is null;

alter table public.registrations
  alter column payment_status set default 'unpaid';

alter table public.registrations
  alter column payment_status set not null;

alter table public.registrations
  drop constraint if exists registrations_payment_status_check;

alter table public.registrations
  add constraint registrations_payment_status_check
  check (payment_status in ('unpaid','pending','paid','failed','refunded','not_required'));

create index if not exists registrations_payment_status_idx
  on public.registrations(payment_status);

create unique index if not exists registrations_razorpay_payment_link_uidx
  on public.registrations(razorpay_payment_link_id)
  where razorpay_payment_link_id is not null;

create unique index if not exists registrations_razorpay_payment_uidx
  on public.registrations(razorpay_payment_id)
  where razorpay_payment_id is not null;

-- Replace the previous direct-booking RPC with a payment-aware version.
-- Paid courses are held as `pending` until Razorpay confirms payment.
-- Free courses become `registered` immediately.
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
  v_status text;
  v_payment_status text;
  v_fee numeric(12,2);
  v_left int;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'error', 'Not signed in.');
  end if;

  if p_preferred_seat_number is null or p_preferred_seat_number <= 0 then
    return json_build_object('ok', false, 'error', 'Please choose an available seat.');
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
  where id = p_batch_id and course_id = p_course_id
  for update;

  if not found then
    return json_build_object('ok', false, 'error', 'Selected batch was not found.');
  end if;

  if v_batch.registration_deadline is not null and now() > v_batch.registration_deadline then
    return json_build_object('ok', false, 'error', 'Booking for this batch is closed.');
  end if;

  if p_preferred_seat_number > v_batch.seats_total then
    return json_build_object('ok', false, 'error', 'That seat does not exist in this batch.');
  end if;

  select * into v_existing
  from public.registrations
  where course_id = p_course_id
    and batch_id = p_batch_id
    and student_id = auth.uid()
  for update;

  if found and v_existing.status in ('pending','registered','completed','waitlist') then
    return json_build_object(
      'ok', false,
      'status', v_existing.status,
      'registration_id', v_existing.id,
      'error', case
        when v_existing.status = 'pending' then 'You already have a payment pending for this batch.'
        else 'You already have a booking for this batch.'
      end
    );
  end if;

  if v_batch.seats_filled >= v_batch.seats_total then
    return json_build_object('ok', false, 'error', 'This batch is full. Please choose another batch.');
  end if;

  if exists (
    select 1 from public.registrations r
    where r.batch_id = p_batch_id
      and r.preferred_seat_number = p_preferred_seat_number
      and r.status in ('pending','registered','completed')
  ) then
    return json_build_object('ok', false, 'error', 'That seat was just booked by another learner. Please choose another seat.');
  end if;

  v_fee := greatest(0, coalesce(v_course.fee, 0) - coalesce(v_course.discount, 0));
  v_payment_status := case when v_fee > 0 then 'pending' else 'not_required' end;
  v_status := case when v_fee > 0 then 'pending' else 'registered' end;

  if found then
    update public.registrations
    set status = v_status,
        attendance_status = 'pending',
        registered_at = now(),
        learner_email = p_email,
        learner_age = p_age,
        learner_location = p_location,
        learner_experience = p_experience,
        learner_name = p_name,
        learner_phone = p_phone,
        learner_additional_details = p_additional_details,
        preferred_seat_number = p_preferred_seat_number,
        payment_status = v_payment_status,
        payment_amount = v_fee,
        payment_currency = 'INR',
        razorpay_payment_link_id = null,
        razorpay_payment_id = null,
        payment_link_url = null,
        payment_paid_at = case when v_fee = 0 then now() else null end
    where id = v_existing.id
    returning id into v_registration_id;
  else
    insert into public.registrations (
      course_id, student_id, batch_id, status, attendance_status,
      learner_email, learner_age, learner_location, learner_experience,
      learner_name, learner_phone, learner_additional_details,
      preferred_seat_number, payment_status, payment_amount,
      payment_currency, payment_paid_at
    ) values (
      p_course_id, auth.uid(), p_batch_id, v_status, 'pending',
      p_email, p_age, p_location, p_experience,
      p_name, p_phone, p_additional_details,
      p_preferred_seat_number, v_payment_status, v_fee,
      'INR', case when v_fee = 0 then now() else null end
    ) returning id into v_registration_id;
  end if;

  -- `pending` holds an exact seat via the theatre-seat unique index but does
  -- not increment seats_filled. Only the verified payment transition to
  -- `registered` increments the real filled-seat counter through the trigger.
  select greatest(0, seats_total - seats_filled)
  into v_left
  from public.batches
  where id = p_batch_id;

  return json_build_object(
    'ok', true,
    'status', v_status,
    'payment_status', v_payment_status,
    'payment_amount', v_fee,
    'registration_id', v_registration_id,
    'seat_number', p_preferred_seat_number,
    'seats_left', v_left,
    'batch_id', p_batch_id
  );

exception
  when unique_violation then
    return json_build_object('ok', false, 'error', 'That seat was just booked by another learner. Please choose another available seat.');
end;
$$;

grant execute on function public.book_seat(uuid, uuid, text, int, text, boolean, text, text, text, int) to authenticated;

-- Server-only finalization target. The Edge Function uses the service role to
-- call this after validating the Razorpay webhook/payment link.
create or replace function public.finalize_razorpay_payment(
  p_registration_id uuid,
  p_payment_link_id text,
  p_payment_id text,
  p_amount numeric
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg public.registrations%rowtype;
  v_batch public.batches%rowtype;
  v_expected numeric(12,2);
begin
  select * into v_reg
  from public.registrations
  where id = p_registration_id
  for update;

  if not found then
    return json_build_object('ok', false, 'error', 'Registration not found.');
  end if;

  v_expected := coalesce(v_reg.payment_amount, 0);

  if p_amount is null or abs(p_amount - v_expected) > 0.01 then
    return json_build_object('ok', false, 'error', 'Payment amount does not match the booking amount.');
  end if;

  if v_reg.payment_status = 'paid' then
    return json_build_object('ok', true, 'status', 'registered', 'payment_status', 'paid');
  end if;

  if v_reg.status not in ('pending','registered') then
    return json_build_object('ok', false, 'error', 'This registration is no longer payable.');
  end if;

  select * into v_batch
  from public.batches
  where id = v_reg.batch_id
  for update;

  if not found then
    return json_build_object('ok', false, 'error', 'Batch not found.');
  end if;

  -- The learner already owns an exact seat through the active-seat unique
  -- index. Do not reject a paid learner merely because the aggregate counter
  -- reached capacity between payment and webhook delivery. The seat itself is
  -- the source of truth; the trigger will reconcile seats_filled atomically.

  update public.registrations
  set status = 'registered',
      payment_status = 'paid',
      razorpay_payment_link_id = p_payment_link_id,
      razorpay_payment_id = p_payment_id,
      payment_paid_at = now()
  where id = v_reg.id;

  return json_build_object('ok', true, 'status', 'registered', 'payment_status', 'paid');
end;
$$;

revoke execute on function public.finalize_razorpay_payment(uuid, text, text, numeric) from public, anon, authenticated;
grant execute on function public.finalize_razorpay_payment(uuid, text, text, numeric) to service_role;


-- ===== supabase/migrations/20261008_ensure_legacy_batch_for_learner.sql =====
-- SkillFarm compatibility fix: expose an existing course-level event as a real batch.
-- Safe/idempotent: does nothing when a batch already exists.

begin;

create or replace function public.ensure_learner_batch(p_course_id uuid)
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
  from public.courses c
  where c.id = p_course_id
    and exists (
      select 1 from public.profiles p
      where p.id = c.provider_id
        and (p.is_active is null or p.is_active = true)
    )
  for update;

  if not found then
    raise exception 'Course not available.';
  end if;

  select * into v_batch
  from public.batches b
  where b.course_id = p_course_id
  order by b.start_date asc nulls last, b.created_at asc
  limit 1;

  if found then
    -- Older builds could create a single compatibility `Batch 1` and then
    -- the Learning Partner could update the course's published event. Keep
    -- that compatibility row in sync so learners never see e.g. 39 seats
    -- on the course card while the booking batch incorrectly says FULL.
    -- Never overwrite a real multi-batch setup.
    if v_batch.name = 'Batch 1'
       and not exists (select 1 from public.batches bx where bx.course_id = p_course_id and bx.id <> v_batch.id)
       and (v_course.start_date is distinct from v_batch.start_date
            or v_course.duration_weeks is distinct from v_batch.duration_weeks
            or nullif(trim(coalesce(v_course.batch_timings, '')), '') is distinct from nullif(trim(coalesce(v_batch.timings, '')), '')
            or greatest(0, coalesce(v_course.seats_total, 0)) <> coalesce(v_batch.seats_total, 0)) then
      update public.batches
      set start_date = v_course.start_date,
          duration_weeks = v_course.duration_weeks,
          timings = nullif(trim(coalesce(v_course.batch_timings, '')), ''),
          seats_total = greatest(0, coalesce(v_course.seats_total, 0)),
          registration_deadline = v_course.registration_deadline
      where id = v_batch.id
      returning * into v_batch;
    end if;
    return v_batch;
  end if;

  -- Only materialize a real event when the course already has published
  -- scheduling/capacity data. Do not invent an event for an empty course.
  if v_course.start_date is null
     and nullif(trim(coalesce(v_course.batch_timings, '')), '') is null
     and coalesce(v_course.seats_total, 0) <= 0 then
    return null;
  end if;

  insert into public.batches (
    course_id, name, start_date, duration_weeks, timings, seats_total,
    seats_filled, registration_deadline
  )
  values (
    v_course.id,
    'Batch 1',
    v_course.start_date,
    v_course.duration_weeks,
    nullif(trim(v_course.batch_timings), ''),
    greatest(0, coalesce(v_course.seats_total, 0)),
    0,
    v_course.registration_deadline
  )
  returning * into v_batch;

  return v_batch;
end;
$$;

grant execute on function public.ensure_learner_batch(uuid) to authenticated;

commit;


-- ===== supabase/migrations/20261008_legacy_batch_seat_count_sync.sql =====
-- Keep the single compatibility Batch 1 aligned with the course-level
-- published seat count for older courses. Real multi-batch courses are never
-- overwritten. This fixes cases where the course says "39 seats left" while
-- the compatibility batch still says FULL.
create or replace function public.ensure_learner_batch(p_course_id uuid)
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
  from public.courses c
  where c.id = p_course_id
    and exists (select 1 from public.profiles p where p.id = c.provider_id and (p.is_active is null or p.is_active = true))
  for update;
  if not found then raise exception 'Course not available.'; end if;

  select * into v_batch from public.batches b
  where b.course_id = p_course_id
  order by b.start_date asc nulls last, b.created_at asc limit 1;

  if found then
    if v_batch.name = 'Batch 1'
       and not exists (select 1 from public.batches bx where bx.course_id = p_course_id and bx.id <> v_batch.id) then
      update public.batches set
        start_date = v_course.start_date,
        duration_weeks = v_course.duration_weeks,
        timings = nullif(trim(coalesce(v_course.batch_timings, '')), ''),
        seats_total = greatest(0, coalesce(v_course.seats_total, 0)),
        seats_filled = least(greatest(0, coalesce(v_course.seats_total, 0)), greatest(0, coalesce(v_course.seats_filled, 0))),
        registration_deadline = v_course.registration_deadline
      where id = v_batch.id returning * into v_batch;
    end if;
    return v_batch;
  end if;

  if v_course.start_date is null and nullif(trim(coalesce(v_course.batch_timings, '')), '') is null and coalesce(v_course.seats_total, 0) <= 0 then return null; end if;

  insert into public.batches (course_id,name,start_date,duration_weeks,timings,seats_total,seats_filled,registration_deadline)
  values (v_course.id,'Batch 1',v_course.start_date,v_course.duration_weeks,nullif(trim(v_course.batch_timings),''),greatest(0,coalesce(v_course.seats_total,0)),least(greatest(0,coalesce(v_course.seats_total,0)),greatest(0,coalesce(v_course.seats_filled,0))),v_course.registration_deadline)
  returning * into v_batch;
  return v_batch;
end;
$$;

grant execute on function public.ensure_learner_batch(uuid) to authenticated;


-- ===== supabase/migrations/20261008_theatre_seat_integrity.sql =====
-- SkillFarm theatre-seat integrity fix.
-- Apply this migration to persist exact seat assignments and make registration batch-scoped.
-- The app remains backward-compatible when this migration is not yet applied.

alter table public.registrations add column if not exists preferred_seat_number integer;

alter table public.registrations drop constraint if exists registrations_preferred_seat_check;
alter table public.registrations add constraint registrations_preferred_seat_check check (preferred_seat_number is null or preferred_seat_number > 0);

create or replace function public.get_batch_booked_seats(p_batch_id uuid)
returns json language sql security definer set search_path=public as $$
  select coalesce(json_agg(preferred_seat_number order by preferred_seat_number), '[]'::json)
  from public.registrations
  where batch_id=p_batch_id and preferred_seat_number is not null
    and status in ('pending','registered','completed');
$$;
grant execute on function public.get_batch_booked_seats(uuid) to authenticated;


-- ===== supabase/migrations/20261009_atomic_seat_booking.sql =====
-- SkillFarm: atomic BookMyShow-style seat booking.
-- Run after the existing batch/theatre-seat migrations.
-- A pending/registered/completed learner holds exactly one seat in a batch.
-- Waitlisted learners do not hold a seat.

alter table public.registrations
  add column if not exists preferred_seat_number integer;

alter table public.registrations
  drop constraint if exists registrations_preferred_seat_check;

alter table public.registrations
  add constraint registrations_preferred_seat_check
  check (preferred_seat_number is null or preferred_seat_number > 0);

create unique index if not exists registrations_batch_active_seat_uidx
  on public.registrations(batch_id, preferred_seat_number)
  where preferred_seat_number is not null
    and status in ('pending','registered','completed');

drop function if exists public.register_seat(uuid, uuid, text, int, text, boolean, text);
drop function if exists public.register_seat(uuid, uuid, text, int, text, boolean);

create or replace function public.register_seat(
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
  v_status text;
  v_left int;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'error', 'Not signed in.');
  end if;

  if p_preferred_seat_number is not null and p_preferred_seat_number <= 0 then
    return json_build_object('ok', false, 'error', 'Invalid seat number.');
  end if;

  select * into v_course
  from public.courses where id = p_course_id for update;
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

  if p_preferred_seat_number is not null and
     p_preferred_seat_number > v_batch.seats_total then
    return json_build_object('ok', false, 'error', 'That seat does not exist in this batch.');
  end if;

  select * into v_existing
  from public.registrations
  where course_id = p_course_id
    and student_id = auth.uid()
    and batch_id = p_batch_id
  for update;

  if found and v_existing.status in ('pending','registered','waitlist','completed') then
    return json_build_object(
      'ok', false,
      'status', v_existing.status,
      'error', 'You already have a registration for this batch.'
    );
  end if;

  -- A learner selecting a seat must have capacity. A full batch can only
  -- create a waitlist entry and therefore cannot accept a seat number.
  if p_preferred_seat_number is not null and v_batch.seats_filled >= v_batch.seats_total then
    return json_build_object('ok', false, 'status', 'waitlist', 'error', 'This batch is full. Please join the waitlist.');
  end if;

  v_status := case
    when v_batch.seats_total > v_batch.seats_filled then 'pending'
    else 'waitlist'
  end;

  if found then
    update public.registrations
    set status = v_status,
        attendance_status = 'pending',
        registered_at = now(),
        learner_email = p_email,
        learner_age = p_age,
        learner_location = p_location,
        learner_experience = p_experience,
        learner_name = p_name,
        learner_phone = p_phone,
        learner_additional_details = p_additional_details,
        preferred_seat_number = case when v_status = 'pending' then p_preferred_seat_number else null end
    where id = v_existing.id;
  else
    insert into public.registrations (
      course_id, student_id, batch_id, status, attendance_status,
      learner_email, learner_age, learner_location, learner_experience,
      learner_name, learner_phone, learner_additional_details,
      preferred_seat_number
    )
    values (
      p_course_id, auth.uid(), p_batch_id, v_status, 'pending',
      p_email, p_age, p_location, p_experience,
      p_name, p_phone, p_additional_details,
      case when v_status = 'pending' then p_preferred_seat_number else null end
    );
  end if;

  select greatest(0, seats_total - seats_filled)
  into v_left
  from public.batches where id = p_batch_id;

  return json_build_object(
    'ok', true,
    'status', v_status,
    'seats_left', v_left,
    'batch_id', p_batch_id,
    'seat_number', p_preferred_seat_number
  );

exception
  when unique_violation then
    return json_build_object(
      'ok', false,
      'error', 'That seat was just booked by another learner. Please choose another seat.'
    );
end;
$$;

grant execute on function public.register_seat(uuid, uuid, text, int, text, boolean, text, text, text, int)
to authenticated;

-- Keep the legacy wrapper for older screens that don't pass a batch.
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
declare v_batch_id uuid;
begin
  select id into v_batch_id
  from public.batches
  where course_id = p_course_id
  order by created_at asc, id asc limit 1;

  if v_batch_id is null then
    return json_build_object('ok', false, 'error', 'No batch exists for this course.');
  end if;

  return public.register_seat(
    p_course_id, v_batch_id, p_email, p_age, p_location, p_experience,
    null, null, null, null
  );
end;
$$;

grant execute on function public.register_seat(uuid, text, int, text, boolean)
to authenticated;


-- ===== supabase/migrations/20261010_direct_seat_booking.sql =====
-- SkillFarm: direct BookMyShow-style seat booking.
-- The learner selects an exact seat and the booking is immediately confirmed.
-- This intentionally bypasses the older Learning Partner approval flow for
-- theatre-style seat bookings. Existing pending registrations remain supported.

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
  v_batch public.batches%rowtype;
  v_existing public.registrations%rowtype;
  v_registration_id uuid;
  v_left int;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'error', 'Not signed in.');
  end if;

  if p_preferred_seat_number is null or p_preferred_seat_number <= 0 then
    return json_build_object('ok', false, 'error', 'Please choose an available seat.');
  end if;

  select * into v_batch
  from public.batches
  where id = p_batch_id and course_id = p_course_id
  for update;

  if not found then
    return json_build_object('ok', false, 'error', 'Selected batch was not found.');
  end if;

  if v_batch.registration_deadline is not null and now() > v_batch.registration_deadline then
    return json_build_object('ok', false, 'error', 'Booking for this batch is closed.');
  end if;

  if p_preferred_seat_number > v_batch.seats_total then
    return json_build_object('ok', false, 'error', 'That seat does not exist in this batch.');
  end if;

  select * into v_existing
  from public.registrations
  where course_id = p_course_id
    and batch_id = p_batch_id
    and student_id = auth.uid()
  for update;

  if found and v_existing.status in ('pending','registered','completed','waitlist') then
    return json_build_object(
      'ok', false,
      'status', v_existing.status,
      'error', 'You already have a booking for this batch.'
    );
  end if;

  if v_batch.seats_filled >= v_batch.seats_total then
    return json_build_object('ok', false, 'error', 'This batch is full. Please choose another batch.');
  end if;

  -- The partial unique index from the theatre-seat migration prevents two
  -- concurrent users from owning the same active seat.
  if exists (
    select 1 from public.registrations r
    where r.batch_id = p_batch_id
      and r.preferred_seat_number = p_preferred_seat_number
      and r.status in ('pending','registered','completed')
  ) then
    return json_build_object('ok', false, 'error', 'That seat was just booked by another learner. Please choose another seat.');
  end if;

  if found then
    update public.registrations
    set status = 'registered',
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
      learner_name, learner_phone, learner_additional_details,
      preferred_seat_number
    ) values (
      p_course_id, auth.uid(), p_batch_id, 'registered', 'pending',
      p_email, p_age, p_location, p_experience,
      p_name, p_phone, p_additional_details, p_preferred_seat_number
    ) returning id into v_registration_id;
  end if;

  update public.batches
  set seats_filled = least(seats_total, seats_filled + 1)
  where id = p_batch_id;

  select greatest(0, seats_total - seats_filled)
  into v_left
  from public.batches where id = p_batch_id;

  return json_build_object(
    'ok', true,
    'status', 'registered',
    'registration_id', v_registration_id,
    'seat_number', p_preferred_seat_number,
    'seats_left', v_left,
    'batch_id', p_batch_id
  );

exception
  when unique_violation then
    return json_build_object('ok', false, 'error', 'That seat was just booked by another learner. Please choose another seat.');
end;
$$;

grant execute on function public.book_seat(uuid, uuid, text, int, text, boolean, text, text, text, int) to authenticated;


-- ===== supabase/migrations/20261011_learning_partner_event_sync.sql =====
-- SkillFarm: one source of truth for Learning Partner events.
--
-- The learner booking flow MUST read a real `batches` row. Course-level
-- seats/date fields are legacy display fields and must never be used to fake
-- a booking batch. This migration makes the partner's normal course save
-- publish/sync its first event automatically when the course has a start date.
-- Existing multi-batch courses are left untouched.

begin;

-- Backfill one real event row for legacy courses that already contain a
-- published start date/capacity but never received a batch row.
insert into public.batches (
  course_id, name, start_date, end_date, duration_weeks, timings,
  seats_total, seats_filled, registration_deadline
)
select
  c.id,
  'Batch 1',
  c.start_date,
  case when c.duration_weeks is not null then c.start_date + (c.duration_weeks * 7 - 1) else null end,
  c.duration_weeks,
  nullif(trim(coalesce(c.batch_timings, '')), ''),
  greatest(0, coalesce(c.seats_total, 0)),
  0,
  c.registration_deadline
from public.courses c
where c.start_date is not null
  and not exists (select 1 from public.batches b where b.course_id = c.id);

create or replace function public.sync_course_event_to_primary_batch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.batches%rowtype;
begin
  -- A course without a real event date is not bookable yet.
  if new.start_date is null then
    return new;
  end if;

  -- Never rewrite a real multi-batch schedule from legacy course fields.
  select * into v_batch
  from public.batches b
  where b.course_id = new.id
  order by b.created_at asc, b.id asc
  limit 1;

  if not found then
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
    ) values (
      new.id,
      'Batch 1',
      new.start_date,
      case
        when new.duration_weeks is not null
          then new.start_date + (new.duration_weeks * 7 - 1)
        else null
      end,
      new.duration_weeks,
      nullif(trim(coalesce(new.batch_timings, '')), ''),
      greatest(0, coalesce(new.seats_total, 0)),
      0,
      new.registration_deadline
    );
    return new;
  end if;

  -- Only synchronize a single legacy/default batch. If the partner created
  -- multiple named batches, those batches are the authoritative schedule.
  if v_batch.name = 'Batch 1'
     and not exists (
       select 1 from public.batches b2
       where b2.course_id = new.id and b2.id <> v_batch.id
     ) then
    update public.batches
    set start_date = new.start_date,
        end_date = case
          when new.duration_weeks is not null
            then new.start_date + (new.duration_weeks * 7 - 1)
          else end_date
        end,
        duration_weeks = new.duration_weeks,
        timings = nullif(trim(coalesce(new.batch_timings, '')), ''),
        seats_total = greatest(0, coalesce(new.seats_total, 0)),
        registration_deadline = new.registration_deadline
    where id = v_batch.id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_course_event_to_primary_batch on public.courses;
create trigger trg_sync_course_event_to_primary_batch
after insert or update of start_date, duration_weeks, batch_timings, seats_total, registration_deadline
on public.courses
for each row
execute function public.sync_course_event_to_primary_batch();

revoke execute on function public.sync_course_event_to_primary_batch() from public, anon, authenticated;
grant execute on function public.sync_course_event_to_primary_batch() to service_role;

commit;


-- ===== Optional TEST reset =====
-- The reset below is intentionally NOT executed automatically.
-- Copy/run SUPABASE_ONE_TIME_RESET_2_LIVE_COURSES_40_SEATS.sql separately on test/staging.
