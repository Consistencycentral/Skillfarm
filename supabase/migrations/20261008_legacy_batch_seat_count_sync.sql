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
