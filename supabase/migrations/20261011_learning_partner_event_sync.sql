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
