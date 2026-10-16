-- SkillFarm one-time TEST/DEMO reset
--
-- Purpose:
--   Make the first 2 currently-live upcoming courses completely fresh for
--   seat-booking testing:
--     - exactly 40 seats per course's primary batch
--     - 0 booked seats
--     - no old learner registrations on those 2 courses
--
-- IMPORTANT:
--   This intentionally removes registrations for the selected 2 courses.
--   Run ONLY on the client's test/staging database, or after confirming that
--   those two courses contain no real customer bookings.
--
-- "Currently live" = provider is active (or provider has no is_active value)
-- and the course start date is today or later. The 2 earliest-created matching
-- courses are selected so the script is deterministic.
--
-- After this script, the learner flow is:
--   0/40 -> choose Seat 01..40 -> details -> Razorpay -> verified success.

begin;

-- 1) Select exactly two live upcoming courses that have one primary batch.
create temporary table _skillfarm_reset_courses on commit drop as
select c.id as course_id
from public.courses c
left join public.profiles p on p.id = c.provider_id
where (p.is_active is null or p.is_active = true)
  and c.start_date is not null
  and c.start_date >= current_date
order by c.created_at asc
limit 2;

-- 2) Delete old registrations for those courses.
--    This is a TEST/STAGING reset only. It guarantees the selected courses
--    start from 0 booked seats.
delete from public.registrations r
using _skillfarm_reset_courses x
where r.course_id = x.course_id;

-- 3) Guarantee a real booking batch exists.
--    The learner app never invents a batch in the UI; this one-time script
--    creates the real DB row that the ticket-booking flow reads.
insert into public.batches (
  course_id, name, start_date, end_date, duration_weeks, timings,
  seats_total, seats_filled, registration_deadline
)
select
  c.id,
  'Batch 1',
  greatest(c.start_date, current_date + 1),
  case when c.duration_weeks is not null
    then greatest(c.start_date, current_date + 1) + (c.duration_weeks * 7 - 1)
    else null end,
  c.duration_weeks,
  nullif(trim(coalesce(c.batch_timings, '')), ''),
  40,
  0,
  case
    when c.registration_deadline is null then null
    when c.registration_deadline::date >= current_date + 1 then c.registration_deadline
    else (current_date + 1)::timestamp
  end
from public.courses c
join _skillfarm_reset_courses x on x.course_id = c.id
where not exists (select 1 from public.batches b where b.course_id = c.id);

-- 4) Reset the earliest/primary batch for each selected course to exactly 40 seats.
--    Other real batches remain intact.
with primary_batches as (
  select distinct on (b.course_id)
    b.id,
    b.course_id
  from public.batches b
  join _skillfarm_reset_courses x on x.course_id = b.course_id
  order by b.course_id, b.start_date asc nulls last, b.created_at asc
)
update public.batches b
set seats_total = 40,
    seats_filled = 0,
    start_date = greatest(coalesce(b.start_date, current_date + 1), current_date + 1),
    registration_deadline = case
      when b.registration_deadline is null then null
      when b.registration_deadline::date >= current_date + 1 then b.registration_deadline
      else (current_date + 1)::timestamp
    end
from primary_batches pb
where b.id = pb.id;

-- 5) Keep the course-level legacy counters aligned with the real batch.
--    The app uses batches as the booking source of truth, but this keeps the
--    browse-card metadata consistent too.
update public.courses c
set seats_total = coalesce((
      select sum(b.seats_total)::int
      from public.batches b
      where b.course_id = c.id
    ), 40),
    seats_filled = coalesce((
      select sum(b.seats_filled)::int
      from public.batches b
      where b.course_id = c.id
    ), 0)
where c.id in (select course_id from _skillfarm_reset_courses);

-- 6) Verification result.
select
  c.id as course_id,
  c.title,
  c.seats_total as course_total,
  c.seats_filled as course_booked,
  b.id as batch_id,
  b.name as batch_name,
  b.seats_total as batch_total,
  b.seats_filled as batch_booked,
  coalesce((select count(*) from public.registrations r where r.course_id = c.id), 0) as registration_rows
from public.courses c
join _skillfarm_reset_courses x on x.course_id = c.id
left join lateral (
  select b.*
  from public.batches b
  where b.course_id = c.id
  order by b.start_date asc nulls last, b.created_at asc
  limit 1
) b on true
order by c.created_at asc;

commit;
