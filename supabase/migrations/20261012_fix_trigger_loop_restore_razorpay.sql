-- SkillFarm fix 2026-10-09
--
-- 1) "stack depth limit exceeded" when a Learning Partner approves a booking
--    (and on any change that moves seats_filled).
--    Cause: an infinite trigger loop
--      registrations -> batches (sync_batch_filled_from_registration)
--      batches -> courses     (sync_course_batch_seats)
--      courses -> batches     (sync_course_event_to_primary_batch, added in
--                              20261011; it fires on "UPDATE OF seats_total")
--      batches -> courses ...  and so on forever.
--    Fix: the course->batch sync ignores nested trigger calls and only writes
--    when something really changed; the batch->course sync only writes when
--    the aggregate really changed.
--
-- 2) Razorpay payment step missing from the booking flow.
--    Cause: 20261010_direct_seat_booking.sql re-defined public.book_seat() as an
--    instant "registered" booking, overwriting the payment-aware version from
--    20261008_booking_payment_flow.sql. This migration restores the
--    payment-aware version (paid course -> pending -> Razorpay -> registered;
--    free course -> registered immediately).
--
-- Safe to run more than once.

begin;

-- ---------------------------------------------------------------------------
-- 0. Preflight: this file only REPAIRS an existing booking setup. If an older
--    migration was never run, stop with a clear message instead of failing in
--    the middle of the file.
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing text := '';
begin
  if to_regclass('public.batches') is null then
    v_missing := v_missing || ' public.batches (run 20260903_multi_batch_system.sql);';
  end if;
  if to_regclass('public.registrations') is null then
    v_missing := v_missing || ' public.registrations;';
  else
    if not exists (select 1 from information_schema.columns
                   where table_schema='public' and table_name='registrations' and column_name='razorpay_payment_id') then
      v_missing := v_missing || ' registrations.razorpay_payment_id (run 20261008_booking_payment_flow.sql);';
    end if;
    if not exists (select 1 from information_schema.columns
                   where table_schema='public' and table_name='registrations' and column_name='preferred_seat_number') then
      v_missing := v_missing || ' registrations.preferred_seat_number (run 20261008_theatre_seat_integrity.sql);';
    end if;
  end if;
  if to_regprocedure('public.finalize_razorpay_payment(uuid,text,text,numeric)') is null then
    v_missing := v_missing || ' finalize_razorpay_payment() (run 20261008_booking_payment_flow.sql);';
  end if;
  if v_missing <> '' then
    raise exception 'SkillFarm fix cannot run yet. Missing:%', v_missing;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1a. batches -> courses aggregate: write only when the numbers changed.
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
  from public.batches b
  where b.course_id = v_course_id;

  update public.courses c
  set seats_total = v_total,
      seats_filled = v_filled
  where c.id = v_course_id
    and (c.seats_total is distinct from v_total
         or c.seats_filled is distinct from v_filled);

  if tg_op = 'UPDATE' and old.course_id is distinct from new.course_id then
    select coalesce(sum(b.seats_total), 0)::int, coalesce(sum(b.seats_filled), 0)::int
      into v_total, v_filled
    from public.batches b
    where b.course_id = old.course_id;

    update public.courses c
    set seats_total = v_total,
        seats_filled = v_filled
    where c.id = old.course_id
      and (c.seats_total is distinct from v_total
           or c.seats_filled is distinct from v_filled);
  end if;

  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------------
-- 1b. courses -> primary batch: never run from inside another trigger, and
--     only touch the batch when a field really differs.
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
  v_total int;
begin
  -- Called from another trigger (e.g. the batch->course aggregate sync)?
  -- Then this is NOT a partner edit; stop here to avoid an endless loop.
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  -- A course without a real event date is not bookable yet.
  if new.start_date is null then
    return new;
  end if;

  v_end := case
    when new.duration_weeks is not null then new.start_date + (new.duration_weeks * 7 - 1)
    else null
  end;
  v_timings := nullif(trim(coalesce(new.batch_timings, '')), '');
  v_total := greatest(0, coalesce(new.seats_total, 0));

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
      v_total, 0, new.registration_deadline
    );
    return new;
  end if;

  -- Only synchronize a single legacy/default batch. Real multi-batch
  -- schedules stay authoritative.
  if v_batch.name = 'Batch 1'
     and not exists (
       select 1 from public.batches b2
       where b2.course_id = new.id and b2.id <> v_batch.id
     )
     and (
       v_batch.start_date is distinct from new.start_date
       or v_batch.duration_weeks is distinct from new.duration_weeks
       or v_batch.timings is distinct from v_timings
       or v_batch.seats_total is distinct from v_total
       or v_batch.registration_deadline is distinct from new.registration_deadline
     ) then
    update public.batches
    set start_date = new.start_date,
        end_date = coalesce(v_end, end_date),
        duration_weeks = new.duration_weeks,
        timings = v_timings,
        seats_total = v_total,
        registration_deadline = new.registration_deadline
    where id = v_batch.id;
  end if;

  return new;
end;
$$;

revoke execute on function public.sync_course_event_to_primary_batch() from public, anon, authenticated;
grant execute on function public.sync_course_event_to_primary_batch() to service_role;

-- ---------------------------------------------------------------------------
-- 2. Restore the payment-aware book_seat() (Razorpay flow).
-- ---------------------------------------------------------------------------
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

  -- A deadline stored as a plain date (midnight UTC) means "until the end of that
  -- day"; a deadline with a real time of day is honoured exactly.
  if v_batch.registration_deadline is not null
     and now() > (
       case
         when v_batch.registration_deadline = date_trunc('day', v_batch.registration_deadline at time zone 'UTC') at time zone 'UTC'
           then v_batch.registration_deadline + interval '1 day'
         else v_batch.registration_deadline
       end
     ) then
    return json_build_object('ok', false, 'error', 'Booking for this batch is closed.');
  end if;

  if p_preferred_seat_number > v_batch.seats_total then
    return json_build_object('ok', false, 'error', 'That seat does not exist in this batch.');
  end if;

  -- Release seat holds from abandoned payments (pending for more than 30
  -- minutes) so a learner who closes the payment page does not block a seat
  -- forever. A late payment is still honoured by finalize_razorpay_payment().
  update public.registrations
  set status = 'cancelled',
      payment_status = 'failed'
  where batch_id = p_batch_id
    and status = 'pending'
    and payment_status in ('pending', 'unpaid')
    and registered_at < now() - interval '30 minutes';

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

-- ---------------------------------------------------------------------------
-- 3. Seat map: do not show seats held by abandoned (>30 min) pending payments.
-- ---------------------------------------------------------------------------
create or replace function public.get_batch_booked_seats(p_batch_id uuid)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(preferred_seat_number order by preferred_seat_number), '[]'::json)
  from public.registrations
  where batch_id = p_batch_id
    and preferred_seat_number is not null
    and (
      status in ('registered', 'completed')
      or (status = 'pending' and registered_at >= now() - interval '30 minutes')
    );
$$;
grant execute on function public.get_batch_booked_seats(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. finalize_razorpay_payment(): honour a payment that arrives after the
--    30-minute hold was released, as long as the seat is still free. If the
--    seat was meanwhile given to someone else, report it clearly (refund).
-- ---------------------------------------------------------------------------
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

  if v_reg.status not in ('pending', 'registered', 'cancelled') then
    return json_build_object('ok', false, 'error', 'This registration is no longer payable.');
  end if;

  if not exists (select 1 from public.batches where id = v_reg.batch_id) then
    return json_build_object('ok', false, 'error', 'Batch not found.');
  end if;

  begin
    update public.registrations
    set status = 'registered',
        payment_status = 'paid',
        razorpay_payment_link_id = p_payment_link_id,
        razorpay_payment_id = p_payment_id,
        payment_paid_at = now()
    where id = v_reg.id;
  exception
    when unique_violation or raise_exception then
      return json_build_object(
        'ok', false,
        'error', 'The seat was released after the payment window and is no longer available. Please refund this payment in Razorpay.'
      );
  end;

  return json_build_object('ok', true, 'status', 'registered', 'payment_status', 'paid');
end;
$$;

revoke execute on function public.finalize_razorpay_payment(uuid, text, text, numeric) from public, anon, authenticated;
grant execute on function public.finalize_razorpay_payment(uuid, text, text, numeric) to service_role;

commit;
