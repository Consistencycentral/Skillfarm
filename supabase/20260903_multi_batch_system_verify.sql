-- PASS 3 verification — READ ONLY.
-- Run this only AFTER the migration has been reviewed/applied.
-- It changes nothing.

select
  'registrations.batch_id exists' as check_name,
  exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='registrations'
      and column_name='batch_id'
  ) as ok
union all
select
  'registrations batch_id is NOT NULL',
  exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='registrations'
      and column_name='batch_id'
      and is_nullable='NO'
  )
union all
select
  'old unique(course_id,student_id) is gone',
  not exists (
    select 1
    from pg_constraint con
    join pg_class rel on rel.oid=con.conrelid
    join pg_namespace nsp on nsp.oid=rel.relnamespace
    where nsp.nspname='public'
      and rel.relname='registrations'
      and con.contype='u'
      and (
        select array_agg(att.attname order by x.ord)::text[]
        from unnest(con.conkey) with ordinality x(attnum,ord)
        join pg_attribute att
          on att.attrelid=rel.oid and att.attnum=x.attnum
      ) = array['course_id','student_id']::text[]
  )
union all
select
  'new unique(course_id,student_id,batch_id) exists',
  exists (
    select 1 from pg_indexes
    where schemaname='public'
      and indexname='registrations_course_student_batch_uidx'
  )
union all
select
  'register_seat batch signature exists',
  exists (
    select 1 from pg_proc
    where pronamespace='public'::regnamespace
      and proname='register_seat'
      and pg_get_function_identity_arguments(oid)
        = 'uuid, uuid, text, integer, text, boolean'
  )
union all
select
  'register_seat execute granted',
  has_function_privilege(
    'authenticated',
    'public.register_seat(uuid,uuid,text,integer,text,boolean)',
    'EXECUTE'
  )
union all
select
  'free_seat batch signature execute granted',
  has_function_privilege(
    'authenticated',
    'public.free_seat(uuid,uuid)',
    'EXECUTE'
  )
union all
select
  'batches RLS enabled',
  relrowsecurity
from pg_class
where oid='public.batches'::regclass
union all
select
  'batch registration FK exists',
  exists (
    select 1
    from pg_constraint con
    join pg_class rel on rel.oid=con.conrelid
    where rel.oid='public.registrations'::regclass
      and con.conname='registrations_batch_id_fkey'
  )
union all
select
  'no registration has null batch',
  not exists (select 1 from public.registrations where batch_id is null)
union all
select
  'no batch is over capacity',
  not exists (select 1 from public.batches where seats_filled > seats_total)
union all
select
  'course seat totals equal batch aggregates',
  not exists (
    select 1
    from public.courses c
    where c.seats_total <> coalesce(
      (select sum(b.seats_total)::int from public.batches b where b.course_id=c.id),0
    )
  )
union all
select
  'course filled seats equal batch aggregates',
  not exists (
    select 1
    from public.courses c
    where c.seats_filled <> coalesce(
      (select sum(b.seats_filled)::int from public.batches b where b.course_id=c.id),0
    )
  );

-- Status compatibility: this should return TRUE.
select
  'waitlist status is accepted' as check_name,
  exists (
    select 1
    from pg_constraint con
    join pg_class rel on rel.oid=con.conrelid
    join pg_namespace nsp on nsp.oid=rel.relnamespace
    where nsp.nspname='public'
      and rel.relname='registrations'
      and con.contype='c'
      and pg_get_constraintdef(con.oid) ilike '%waitlist%'
  ) as ok;

-- SECURITY DEFINER + fixed search_path:
select
  p.proname,
  p.prosecdef as security_definer,
  (p.proconfig @> ARRAY['search_path=public']) as fixed_search_path
from pg_proc p
where p.pronamespace='public'::regnamespace
  and p.proname in ('register_seat','approve_registration','reject_registration','free_seat');
