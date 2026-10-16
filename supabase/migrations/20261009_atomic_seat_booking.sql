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
