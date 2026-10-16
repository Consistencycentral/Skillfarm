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
