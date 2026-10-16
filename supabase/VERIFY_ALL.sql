-- ===========================================================================
-- SkillFarm: ONE read-only check of everything the client reported.
-- Run the whole file in Supabase SQL Editor. It changes nothing.
-- You get ONE table: any row with status MISSING is not applied yet.
-- ===========================================================================
with
fn(name, why) as (values
  ('book_seat',                'seat booking'),
  ('book_seats',               'v8: multi-seat booking (My Seats / seat select)'),
  ('approve_registration',     'v6: partner Approve'),
  ('batch_held_count',         'v6: 40-seat counter'),
  ('get_batch_booked_seats',   'v6: seat map (clickable seats)'),
  ('submit_review',            'v6: reviews and ratings'),
  ('post_review_reply',        'v6: review replies'),
  ('attendance_payment_required','attendance v3'),
  ('mark_attendance_by_code',  'attendance v3'),
  ('mark_attendance_by_token', 'attendance v3'),
  ('issue_attendance_challenge','attendance QR'),
  ('get_attendance_report',    'attendance export'),
  ('get_attendance_summaries', 'attendance')
),
col(tbl, colname, why) as (values
  ('courses','translations',    'v6: Tamil/Hindi text'),
  ('courses','trainer_name',    'v8: trainer details'),
  ('courses','trainer_bio',     'v8: trainer details'),
  ('courses','certificate_url', 'v8: certificate upload'),
  ('courses','certificate_name','v8: certificate upload'),
  ('registrations','preferred_seat_number','seat booking')
),
trg(name, why) as (values
  ('trg_enforce_batch_filled_seats',        'v6: fixes "stack depth limit exceeded"'),
  ('trg_sync_batch_filled_from_registration','v6: fixes "stack depth limit exceeded"'),
  ('trg_sync_course_batch_seats',           'v6: fixes "stack depth limit exceeded"'),
  ('trg_sync_course_event_to_primary_batch','v6: fixes course edit "Could not save"'),
  ('trg_aa_enforce_fixed_batch_capacity',   'v6: exactly 40 seats per batch')
)
select * from (
  select 1 as ord, 'function ' || fn.name as check_name,
         case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                            where n.nspname = 'public' and p.proname = fn.name)
              then 'OK' else 'MISSING' end as status,
         fn.why as detail
    from fn
  union all
  select 2, 'column ' || col.tbl || '.' || col.colname,
         case when exists (select 1 from information_schema.columns c
                            where c.table_schema = 'public' and c.table_name = col.tbl and c.column_name = col.colname)
              then 'OK' else 'MISSING' end,
         col.why
    from col
  union all
  select 3, 'public_courses view has trainer_name',
         case when exists (select 1 from information_schema.columns c
                            where c.table_schema = 'public' and c.table_name = 'public_courses' and c.column_name = 'trainer_name')
              then 'OK' else 'MISSING' end,
         'v8: signed-out course page shows trainer/translations'
  union all
  select 4, 'trigger ' || trg.name,
         case when exists (select 1 from pg_trigger t where t.tgname = trg.name and not t.tgisinternal)
              then 'OK' else 'MISSING' end,
         trg.why
    from trg
  union all
  select 5, 'storage bucket course-certificates',
         case when exists (select 1 from storage.buckets b where b.id = 'course-certificates')
              then 'OK' else 'MISSING' end,
         'v8: partner certificate upload'
  union all
  select 6, 'book_seat is the no-payment version (v6/v8)',
         case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                            where n.nspname = 'public' and p.proname = 'book_seat')
               and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                where n.nspname = 'public' and p.proname = 'book_seat' and p.prokind = 'f'
                                  and pg_get_functiondef(p.oid) ilike '%payment_status%')
              then 'OK' else 'MISSING' end,
         'If MISSING: the older Razorpay/payment booking function is still live'
  union all
  select 7, 'table app_settings (attendance payment switch)',
         case when to_regclass('public.app_settings') is not null then 'OK' else 'MISSING' end,
         'attendance v3'
  union all
  select 8, 'batches holding more than 40 seats',
         case when exists (select 1 from public.registrations r
                            where r.status in ('pending','registered','completed')
                            group by r.batch_id having count(*) > 40)
              then 'MISSING' else 'OK' end,
         'Any batch over 40 needs a manual look'
) r
order by (status = 'OK'), ord, check_name;
