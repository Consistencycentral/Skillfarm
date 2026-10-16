-- ============================================================================
-- SkillFarm v10 (2026-10-19): Learning Partner decides the seat count per event
-- ============================================================================
-- Before: every batch was forced to exactly 40 seats.
-- Now   : the Learning Partner chooses 1..200 seats per event/batch. The seat map
--         in the app draws exactly that many seats (A1, A2 ... ).
--
-- Safe to re-run. Run AFTER v6 + v8 + 20261018_waitlist_and_push.sql.
-- Existing batches keep their current seat count (40 for old ones).
-- ============================================================================

-- 1. Capacity trigger: no longer forces 40. Validates 1..200 and refuses to go
--    below the seats that are already taken.
create or replace function public.enforce_fixed_batch_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_held int;
  v_max_seat int;
begin
  -- Empty / zero / missing capacity -> default of 40.
  if new.seats_total is null or new.seats_total < 1 then
    new.seats_total := 40;
  end if;

  if new.seats_total > 200 then
    raise exception 'An event can have at most 200 seats.';
  end if;

  if tg_op = 'UPDATE' then
    v_held := public.batch_held_count(new.id);
    if new.seats_total < v_held then
      raise exception 'Cannot reduce to % seats: % seats are already booked.', new.seats_total, v_held;
    end if;

    select coalesce(max(r.preferred_seat_number), 0) into v_max_seat
    from public.registrations r
    where r.batch_id = new.id
      and r.status in ('pending', 'registered', 'completed');
    if new.seats_total < v_max_seat then
      raise exception 'Cannot reduce to % seats: seat number % is already booked.', new.seats_total, v_max_seat;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_aa_enforce_fixed_batch_capacity on public.batches;
create trigger trg_aa_enforce_fixed_batch_capacity
before insert or update of seats_total on public.batches
for each row execute function public.enforce_fixed_batch_capacity();

-- 2. Booking / approval / waitlist functions: use the batch's own seat count
--    instead of the hard-coded 40.

-- book_seats (multi-seat booking)
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
    if v_seat > v_batch.seats_total then
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

  if public.batch_held_count(p_batch_id) + array_length(v_seats, 1) > v_batch.seats_total then
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

-- approve_registration
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
    if public.batch_held_count(v_batch.id) >= v_batch.seats_total then
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
      from generate_series(1, v_batch.seats_total) n
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

-- join_waitlist
create or replace function public.join_waitlist(
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
  v_id uuid;
  v_pos int;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'error', 'Not signed in.');
  end if;

  select * into v_course from public.courses where id = p_course_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Course not found.');
  end if;
  if v_course.provider_id = auth.uid() then
    return json_build_object('ok', false, 'error', 'You cannot join the waitlist of your own course.');
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

  if v_batch.start_date is not null and v_batch.start_date < (now() at time zone 'Asia/Kolkata')::date then
    return json_build_object('ok', false, 'error', 'This batch has already started.');
  end if;

  -- Only a genuinely full batch has a waitlist. Otherwise the learner should book a seat.
  if public.batch_held_count(p_batch_id) < v_batch.seats_total then
    return json_build_object('ok', false, 'error', 'Seats are still available in this batch. Please choose a seat instead.');
  end if;

  if exists (
    select 1 from public.registrations r
    where r.batch_id = p_batch_id and r.student_id = auth.uid()
      and r.status in ('pending', 'registered', 'completed', 'waitlist')
  ) then
    return json_build_object('ok', false, 'error', 'You already have a seat or a waitlist spot in this batch.');
  end if;

  insert into public.registrations (
    course_id, student_id, batch_id, status, attendance_status,
    learner_email, learner_age, learner_location, learner_experience,
    learner_name, learner_phone, learner_additional_details
  ) values (
    p_course_id, auth.uid(), p_batch_id, 'waitlist', 'pending',
    p_email, p_age, p_location, p_experience,
    p_name, p_phone, p_additional_details
  ) returning id into v_id;

  select count(*)::int into v_pos
  from public.registrations w
  where w.batch_id = p_batch_id and w.status = 'waitlist';

  return json_build_object('ok', true, 'status', 'waitlist',
    'registration_id', v_id, 'position', v_pos, 'batch_id', p_batch_id);
end;
$$;

-- promote_waitlist
create or replace function public.promote_waitlist(p_batch_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.batches%rowtype;
  v_cap int;
  v_reg public.registrations%rowtype;
  v_seat int;
  v_count int := 0;
begin
  select * into v_batch from public.batches where id = p_batch_id for update;
  if not found then return 0; end if;

  -- A batch that has already started does not take new seats.
  if v_batch.start_date is not null and v_batch.start_date < (now() at time zone 'Asia/Kolkata')::date then
    return 0;
  end if;

  v_cap := v_batch.seats_total;

  loop
    exit when public.batch_held_count(p_batch_id) >= v_cap;

    select * into v_reg
    from public.registrations
    where batch_id = p_batch_id and status = 'waitlist'
    order by registered_at, id
    limit 1
    for update skip locked;
    exit when not found;

    select min(n) into v_seat
    from generate_series(1, v_cap) n
    where not exists (
      select 1 from public.registrations r
      where r.batch_id = p_batch_id
        and r.preferred_seat_number = n
        and r.status in ('pending', 'registered', 'completed'));
    exit when v_seat is null;

    update public.registrations
    set status = 'pending', preferred_seat_number = v_seat, waitlist_promoted_at = now()
    where id = v_reg.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- done
