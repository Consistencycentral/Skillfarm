-- Run this in Supabase SQL Editor to see what is live. Read-only.

-- 1) Which booking version is live? (payment step or not)
select p.oid::regprocedure as function,
       case when pg_get_functiondef(p.oid) ilike '%payment_status%'
            then 'PAYMENT version live (Razorpay: pending -> paid -> registered)'
            else 'v6/v8 version live (NO payment step: pending -> registered on approve)'
       end as booking_version
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'book_seat';

-- 2) Attendance functions installed? (expect 9 rows after running RUN_THIS_ATTENDANCE_QR.sql)
select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and proname in (
  'attendance_eligibility','attendance_window_error','issue_attendance_challenge',
  'mark_attendance_by_token','mark_attendance_by_code','set_attendance','get_attendance_summaries',
  'attendance_payment_required','get_attendance_report')
order by 1;

-- 3) Approved learners whose QR will be blocked by payment (fee > 0 and not paid)
select r.id, r.status, r.payment_status, c.title, c.fee, c.discount
from public.registrations r join public.courses c on c.id = r.course_id
where r.status = 'registered'
  and r.payment_status not in ('paid','not_required')
  and greatest(0, coalesce(c.fee,0) - coalesce(c.discount,0)) > 0;

-- 4) Is payment required before the attendance QR? (false = QR as soon as partner approves)
select key, value from public.app_settings where key = 'attendance_require_payment';
-- To change:  update public.app_settings set value = 'true'  where key = 'attendance_require_payment';
--             update public.app_settings set value = 'false' where key = 'attendance_require_payment';
