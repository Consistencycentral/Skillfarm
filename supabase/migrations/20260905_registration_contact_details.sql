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
