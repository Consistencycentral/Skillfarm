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
