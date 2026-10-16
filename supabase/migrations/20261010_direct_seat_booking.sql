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
