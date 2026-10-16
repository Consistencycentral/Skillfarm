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
