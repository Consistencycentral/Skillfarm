-- ===========================================================================
-- SkillFarm: Attendance v3   (safe to run more than once; needs v1 + v2)
--   * on/off switch for "payment required before attendance QR"  (default OFF)
--   * partner can limit scanning to one batch
--   * day-wise attendance report RPC (for PDF / Excel export)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Settings + payment switch
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;

-- OFF = approved learners get the QR immediately (matches "no payment step").
-- Turn ON when Razorpay is live:
--   update public.app_settings set value = 'true' where key = 'attendance_require_payment';
insert into public.app_settings (key, value) values ('attendance_require_payment', 'false')
on conflict (key) do nothing;

create or replace function public.attendance_payment_required()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select value from public.app_settings where key = 'attendance_require_payment'), 'false') = 'true';
$$;
grant execute on function public.attendance_payment_required() to authenticated;

create or replace function public.attendance_eligibility(p_reg_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_reg public.registrations%rowtype;
  v_net numeric;
begin
  select * into v_reg from public.registrations where id = p_reg_id;
  if not found then return 'Ticket not found.'; end if;
  if v_reg.status <> 'registered' then
    return 'Your QR will be ready once the Learning Partner approves your request.';
  end if;
  if not public.attendance_payment_required() then return null; end if;
  if v_reg.payment_status in ('paid', 'not_required') then return null; end if;
  select greatest(0, coalesce(c.fee, 0) - coalesce(c.discount, 0)) into v_net
    from public.courses c where c.id = v_reg.course_id;
  if coalesce(v_net, 0) <= 0 then return null; end if;
  return 'Payment pending. Complete your payment to get the attendance QR.';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Scan with optional batch filter  (old 1-argument versions are replaced)
-- ---------------------------------------------------------------------------
drop function if exists public.mark_attendance_by_code(text);
drop function if exists public.mark_attendance_by_token(text);

create or replace function public.mark_attendance_by_token(p_token text, p_batch_id uuid default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ch      public.attendance_challenges%rowtype;
  v_reg     public.registrations%rowtype;
  v_title   text;
  v_batch   text;
  v_already boolean;
  v_err     text;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'error', 'Please sign in again.');
  end if;

  select * into v_ch from public.attendance_challenges where token = p_token for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Invalid QR. Ask the learner to refresh their ticket.');
  end if;
  if v_ch.expires_at < now() then
    return json_build_object('ok', false, 'error', 'QR expired. Ask the learner to refresh their ticket.');
  end if;

  select * into v_reg from public.registrations where id = v_ch.registration_id for update;
  select c.title into v_title from public.courses c
   where c.id = v_reg.course_id and c.provider_id = auth.uid();
  if v_title is null then
    return json_build_object('ok', false, 'error', 'This ticket is not for one of your courses.');
  end if;

  select b.name into v_batch from public.batches b where b.id = v_reg.batch_id;
  if p_batch_id is not null and v_reg.batch_id is distinct from p_batch_id then
    return json_build_object('ok', false,
      'error', 'This learner is in a different batch' || coalesce(' (' || v_batch || ')', '') || ', not the batch you selected.');
  end if;

  if v_reg.status <> 'registered' then
    return json_build_object('ok', false, 'error', 'This booking is not approved (status: ' || v_reg.status || ').');
  end if;
  if public.attendance_eligibility(v_reg.id) is not null then
    return json_build_object('ok', false, 'error', 'Payment is not completed for this ticket.');
  end if;
  v_err := public.attendance_window_error(v_reg.id);
  if v_err is not null then
    return json_build_object('ok', false, 'error', v_err);
  end if;

  v_already := exists (select 1 from public.attendance_logs l
                        where l.registration_id = v_reg.id
                          and l.attendance_date = public.ist_today() and l.status = 'present');

  if v_ch.used_at is not null and not v_already then
    return json_build_object('ok', false, 'error', 'This QR was already used.');
  end if;

  update public.attendance_challenges set used_at = coalesce(used_at, now()) where token = p_token;

  insert into public.attendance_logs (registration_id, attendance_date, status, method, marked_by)
  values (v_reg.id, public.ist_today(), 'present', 'qr', auth.uid())
  on conflict (registration_id, attendance_date)
  do update set status = 'present', method = 'qr', marked_by = auth.uid(), marked_at = now();
  perform public._sync_attendance_summary(v_reg.id);

  return json_build_object(
    'ok', true,
    'already_present', v_already,
    'registration_id', v_reg.id,
    'learner_name', coalesce(v_reg.learner_name, 'Learner'),
    'seat', v_reg.preferred_seat_number,
    'course_title', v_title,
    'batch_name', v_batch,
    'days_present', (select count(*) from public.attendance_logs l
                      where l.registration_id = v_reg.id and l.status = 'present')
  );
end;
$$;

create or replace function public.mark_attendance_by_code(p_code text, p_batch_id uuid default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tokens text[];
  v_code   text := regexp_replace(coalesce(p_code, ''), '\D', '', 'g');
  v_fails  int;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'error', 'Please sign in again.');
  end if;
  if length(v_code) <> 6 then
    return json_build_object('ok', false, 'error', 'Enter the 6-digit code shown under the learner QR.');
  end if;

  select count(*) into v_fails from public.attendance_code_attempts
   where provider_id = auth.uid() and attempted_at > now() - interval '5 minutes';
  if v_fails >= 8 then
    return json_build_object('ok', false, 'error', 'Too many wrong codes. Please wait a few minutes, or scan the QR instead.');
  end if;

  select array_agg(ch.token) into v_tokens
    from public.attendance_challenges ch
    join public.registrations r on r.id = ch.registration_id
    join public.courses c on c.id = r.course_id
   where ch.short_code = v_code and ch.used_at is null and ch.expires_at > now()
     and c.provider_id = auth.uid();

  if v_tokens is null then
    insert into public.attendance_code_attempts (provider_id) values (auth.uid());
    delete from public.attendance_code_attempts where attempted_at < now() - interval '1 day';
    return json_build_object('ok', false, 'error', 'Code not found or expired. Ask the learner to read the latest code.');
  end if;
  if array_length(v_tokens, 1) > 1 then
    return json_build_object('ok', false, 'error', 'Code matched more than one ticket. Wait 10 seconds and use the new code.');
  end if;
  return public.mark_attendance_by_token(v_tokens[1], p_batch_id);
end;
$$;

grant execute on function public.mark_attendance_by_token(text, uuid) to authenticated;
grant execute on function public.mark_attendance_by_code(text, uuid)  to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Day-wise attendance report (partner only; one row per learner per day)
-- ---------------------------------------------------------------------------
create or replace function public.get_attendance_report(
  p_course_id uuid default null,
  p_batch_id  uuid default null,
  p_from      date default null,
  p_to        date default null)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(json_build_object(
           'registration_id', r.id,
           'attendance_date', l.attendance_date,
           'status',          l.status,
           'method',          l.method
         ) order by l.attendance_date), '[]'::json)
    from public.attendance_logs l
    join public.registrations r on r.id = l.registration_id
    join public.courses c on c.id = r.course_id
   where c.provider_id = auth.uid()
     and (p_course_id is null or c.id = p_course_id)
     and (p_batch_id  is null or r.batch_id = p_batch_id)
     and (p_from is null or l.attendance_date >= p_from)
     and (p_to   is null or l.attendance_date <= p_to);
$$;
grant execute on function public.get_attendance_report(uuid, uuid, date, date) to authenticated;

notify pgrst, 'reload schema';
