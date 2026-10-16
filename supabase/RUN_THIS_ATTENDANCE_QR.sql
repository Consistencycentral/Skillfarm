-- ===========================================================================
-- SkillFarm: Attendance QR (v9)   Safe to run more than once.
--
-- Flow
--   1. Learning Partner approves a request  -> registrations.status = 'registered'
--   2. Learner opens the ticket -> app calls issue_attendance_challenge()
--      and shows a short-lived QR (refreshes every 10 s, valid 45 s).
--   3. Partner opens "Scan attendance" -> camera reads the QR ->
--      mark_attendance_by_token() verifies owner + expiry + one-time use and
--      sets attendance_status = 'present' in ONE atomic call.
--
-- QR rule: approved by partner (status = 'registered') AND payment settled
-- (paid / not_required / free course). See attendance_eligibility().
-- ===========================================================================

create table if not exists public.attendance_challenges (
  token           text primary key,
  registration_id uuid not null references public.registrations(id) on delete cascade,
  expires_at      timestamptz not null,
  used_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists attendance_challenges_reg_idx
  on public.attendance_challenges (registration_id, created_at desc);

-- No direct access from the app; only the security-definer functions below.
alter table public.attendance_challenges enable row level security;
revoke all on public.attendance_challenges from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 0. Eligibility rule (single source of truth):
--    approved by partner (status = 'registered')  AND  payment settled
--    payment settled = payment_status in ('paid','not_required')
--                      OR the course is free (fee - discount <= 0)
-- ---------------------------------------------------------------------------
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
  if v_reg.payment_status in ('paid', 'not_required') then return null; end if;
  select greatest(0, coalesce(c.fee, 0) - coalesce(c.discount, 0)) into v_net
    from public.courses c where c.id = v_reg.course_id;
  if coalesce(v_net, 0) <= 0 then return null; end if;
  return 'Payment pending. Complete your payment to get the attendance QR.';
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Learner: issue a fresh QR token for MY approved registration
-- ---------------------------------------------------------------------------
create or replace function public.issue_attendance_challenge(p_registration_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg   public.registrations%rowtype;
  v_token text;
  v_exp   timestamptz;
  v_block text;
begin
  if auth.uid() is null then
    raise exception 'Please sign in again.';
  end if;

  select * into v_reg from public.registrations where id = p_registration_id;
  if not found or v_reg.student_id <> auth.uid() then
    raise exception 'Ticket not found.';
  end if;
  v_block := public.attendance_eligibility(v_reg.id);
  if v_block is not null then
    raise exception '%', v_block;
  end if;

  -- housekeeping: drop old tokens for this registration
  delete from public.attendance_challenges
   where registration_id = v_reg.id
     and (expires_at < now() - interval '5 minutes' or used_at is not null);

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_exp   := now() + interval '45 seconds';

  insert into public.attendance_challenges (token, registration_id, expires_at)
  values (v_token, v_reg.id, v_exp);

  return json_build_object('token', v_token, 'expires_at', v_exp);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Partner: just check a token (no side effects)
-- ---------------------------------------------------------------------------
create or replace function public.validate_attendance_challenge(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ch  public.attendance_challenges%rowtype;
  v_reg public.registrations%rowtype;
begin
  select * into v_ch from public.attendance_challenges where token = p_token;
  if not found then raise exception 'Invalid QR. Ask the learner to refresh their ticket.'; end if;
  if v_ch.used_at is not null then raise exception 'This QR was already used.'; end if;
  if v_ch.expires_at < now() then raise exception 'QR expired. Ask the learner to refresh their ticket.'; end if;

  select * into v_reg from public.registrations where id = v_ch.registration_id;
  if not exists (select 1 from public.courses c where c.id = v_reg.course_id and c.provider_id = auth.uid()) then
    raise exception 'This ticket is not for one of your courses.';
  end if;

  return json_build_object('registration_id', v_reg.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Partner: scan = verify + mark present (atomic, one-time token)
-- ---------------------------------------------------------------------------
create or replace function public.mark_attendance_by_token(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ch      public.attendance_challenges%rowtype;
  v_reg     public.registrations%rowtype;
  v_title   text;
  v_already boolean;
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
  select c.title into v_title
    from public.courses c
   where c.id = v_reg.course_id and c.provider_id = auth.uid();
  if v_title is null then
    return json_build_object('ok', false, 'error', 'This ticket is not for one of your courses.');
  end if;

  if v_reg.status <> 'registered' then
    return json_build_object('ok', false, 'error', 'This booking is not approved (status: ' || v_reg.status || ').');
  end if;
  if public.attendance_eligibility(v_reg.id) is not null then
    return json_build_object('ok', false, 'error', 'Payment is not completed for this ticket.');
  end if;

  v_already := (v_reg.attendance_status = 'present');

  if v_ch.used_at is not null and not v_already then
    return json_build_object('ok', false, 'error', 'This QR was already used.');
  end if;

  update public.attendance_challenges set used_at = coalesce(used_at, now()) where token = p_token;
  update public.registrations set attendance_status = 'present' where id = v_reg.id;

  return json_build_object(
    'ok', true,
    'already_present', v_already,
    'registration_id', v_reg.id,
    'learner_name', coalesce(v_reg.learner_name, 'Learner'),
    'seat', v_reg.preferred_seat_number,
    'course_title', v_title
  );
end;
$$;

grant execute on function public.attendance_eligibility(uuid)       to authenticated;
grant execute on function public.issue_attendance_challenge(uuid)   to authenticated;
grant execute on function public.validate_attendance_challenge(text) to authenticated;
grant execute on function public.mark_attendance_by_token(text)      to authenticated;

notify pgrst, 'reload schema';


-- ########## PART 2: attendance v2 ##########
-- ===========================================================================
-- SkillFarm: Attendance v2   (safe to run more than once)
-- Requires 20261015_attendance_qr.sql (the combined RUN file already has it).
--
--   * per-day attendance (attendance_logs) -> multi-day batches work
--   * attendance only inside the batch date window (India time)
--   * manual present/absent now needs an approved + paid ticket
--   * 6-digit backup code when a phone camera / web scanner fails
--   * learner + partner read attendance summaries through one RPC
--   * housekeeping: at most a few live tokens per registration
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Helpers
-- ---------------------------------------------------------------------------
create or replace function public.ist_today()
returns date language sql stable as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

create table if not exists public.attendance_logs (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations(id) on delete cascade,
  attendance_date date not null,
  status          text not null check (status in ('present','absent')),
  method          text not null default 'qr' check (method in ('qr','code','manual')),
  marked_by       uuid,
  marked_at       timestamptz not null default now(),
  unique (registration_id, attendance_date)
);
create index if not exists attendance_logs_reg_idx on public.attendance_logs (registration_id, attendance_date desc);
alter table public.attendance_logs enable row level security;
revoke all on public.attendance_logs from anon, authenticated;

alter table public.attendance_challenges add column if not exists short_code text;
create index if not exists attendance_challenges_code_idx
  on public.attendance_challenges (short_code) where used_at is null;

-- Carry over what was already marked (one row on the batch start date, or today).
insert into public.attendance_logs (registration_id, attendance_date, status, method)
select r.id, coalesce(b.start_date::date, public.ist_today()), r.attendance_status, 'manual'
  from public.registrations r
  left join public.batches b on b.id = r.batch_id
 where r.attendance_status in ('present','absent')
on conflict (registration_id, attendance_date) do nothing;

-- ---------------------------------------------------------------------------
-- 1. Date window (null = no problem)
-- ---------------------------------------------------------------------------
create or replace function public.attendance_window_error(p_reg_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_start date;
  v_end   date;
  v_today date := public.ist_today();
begin
  select batch_id into v_batch_id from public.registrations where id = p_reg_id;
  if v_batch_id is null then return null; end if;
  select b.start_date::date, b.end_date::date into v_start, v_end from public.batches b where b.id = v_batch_id;
  if v_start is not null and v_today < v_start then
    return 'This batch starts on ' || to_char(v_start, 'DD Mon YYYY') || '. Attendance opens that day.';
  end if;
  if coalesce(v_end, v_start) is not null and v_today > coalesce(v_end, v_start) then
    return 'This batch ended on ' || to_char(coalesce(v_end, v_start), 'DD Mon YYYY') || '. Attendance is closed.';
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Internal: keep registrations.attendance_status = latest logged day
-- ---------------------------------------------------------------------------
create or replace function public._sync_attendance_summary(p_reg_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.registrations r
     set attendance_status = coalesce(
       (select l.status from public.attendance_logs l
         where l.registration_id = p_reg_id order by l.attendance_date desc limit 1),
       'pending')
   where r.id = p_reg_id;
$$;
revoke all on function public._sync_attendance_summary(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Learner: issue QR token (+ 6-digit backup code)
-- ---------------------------------------------------------------------------
create or replace function public.issue_attendance_challenge(p_registration_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg   public.registrations%rowtype;
  v_token text;
  v_code  text;
  v_exp   timestamptz;
  v_block text;
  i int := 0;
begin
  if auth.uid() is null then raise exception 'Please sign in again.'; end if;

  select * into v_reg from public.registrations where id = p_registration_id;
  if not found or v_reg.student_id <> auth.uid() then raise exception 'Ticket not found.'; end if;

  v_block := public.attendance_eligibility(v_reg.id);
  if v_block is not null then raise exception '%', v_block; end if;

  -- keep only the last ~30 s of tokens for this ticket (QR refreshes every 10 s)
  delete from public.attendance_challenges
   where registration_id = v_reg.id and created_at < now() - interval '30 seconds';
  if random() < 0.05 then
    delete from public.attendance_challenges where expires_at < now() - interval '1 day';
  end if;

  loop
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (
      select 1 from public.attendance_challenges
       where short_code = v_code and used_at is null and expires_at > now());
    i := i + 1;
    exit when i > 10;
  end loop;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_exp   := now() + interval '45 seconds';
  insert into public.attendance_challenges (token, registration_id, expires_at, short_code)
  values (v_token, v_reg.id, v_exp, v_code);

  return json_build_object('token', v_token, 'short_code', v_code, 'expires_at', v_exp);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Partner: scan = verify + log today's attendance (one-time token)
-- ---------------------------------------------------------------------------
create or replace function public.mark_attendance_by_token(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ch      public.attendance_challenges%rowtype;
  v_reg     public.registrations%rowtype;
  v_title   text;
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
    'days_present', (select count(*) from public.attendance_logs l
                      where l.registration_id = v_reg.id and l.status = 'present')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Partner: backup 6-digit code (camera broken / web)
-- ---------------------------------------------------------------------------
create table if not exists public.attendance_code_attempts (
  id           bigserial primary key,
  provider_id  uuid not null,
  attempted_at timestamptz not null default now()
);
create index if not exists attendance_code_attempts_idx
  on public.attendance_code_attempts (provider_id, attempted_at desc);
alter table public.attendance_code_attempts enable row level security;
revoke all on public.attendance_code_attempts from anon, authenticated;

create or replace function public.mark_attendance_by_code(p_code text)
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

  -- brute-force guard: max 8 wrong codes per partner per 5 minutes
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
  return public.mark_attendance_by_token(v_tokens[1]);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Partner manual present/absent/clear (today) - now guarded
-- ---------------------------------------------------------------------------
create or replace function public.set_attendance(p_reg_id uuid, p_status text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg public.registrations%rowtype;
  v_err text;
begin
  if p_status not in ('pending','present','absent') then
    return json_build_object('ok', false, 'error', 'Invalid attendance status.');
  end if;
  select * into v_reg from public.registrations where id = p_reg_id;
  if not found then return json_build_object('ok', false, 'error', 'Registration not found.'); end if;
  if not exists (select 1 from public.courses c where c.id = v_reg.course_id and c.provider_id = auth.uid()) then
    return json_build_object('ok', false, 'error', 'Not authorized.');
  end if;

  if p_status = 'pending' then
    delete from public.attendance_logs where registration_id = p_reg_id and attendance_date = public.ist_today();
  else
    if v_reg.status <> 'registered' then
      return json_build_object('ok', false, 'error', 'Approve this learner before marking attendance.');
    end if;
    v_err := public.attendance_eligibility(p_reg_id);
    if v_err is not null and p_status = 'present' then
      return json_build_object('ok', false, 'error', 'Payment is not completed for this learner.');
    end if;
    if p_status = 'present' then
      v_err := public.attendance_window_error(p_reg_id);
      if v_err is not null then return json_build_object('ok', false, 'error', v_err); end if;
    end if;
    insert into public.attendance_logs (registration_id, attendance_date, status, method, marked_by)
    values (p_reg_id, public.ist_today(), p_status, 'manual', auth.uid())
    on conflict (registration_id, attendance_date)
    do update set status = p_status, method = 'manual', marked_by = auth.uid(), marked_at = now();
  end if;

  perform public._sync_attendance_summary(p_reg_id);
  return json_build_object('ok', true, 'attendance_status', p_status);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Summaries for ticket screen (learner) and learner list (partner)
-- ---------------------------------------------------------------------------
create or replace function public.get_attendance_summaries(p_reg_ids uuid[])
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(json_build_object(
    'registration_id', r.id,
    'today_status', (select l.status from public.attendance_logs l
                      where l.registration_id = r.id and l.attendance_date = public.ist_today()),
    'days_present', (select count(*) from public.attendance_logs l
                      where l.registration_id = r.id and l.status = 'present')
  )), '[]'::json)
  from public.registrations r
  join public.courses c on c.id = r.course_id
  where r.id = any(p_reg_ids)
    and (r.student_id = auth.uid() or c.provider_id = auth.uid());
$$;

grant execute on function public.ist_today()                           to authenticated;
grant execute on function public.attendance_window_error(uuid)         to authenticated;
grant execute on function public.issue_attendance_challenge(uuid)      to authenticated;
grant execute on function public.mark_attendance_by_token(text)        to authenticated;
grant execute on function public.mark_attendance_by_code(text)         to authenticated;
grant execute on function public.set_attendance(uuid, text)            to authenticated;
grant execute on function public.get_attendance_summaries(uuid[])      to authenticated;

notify pgrst, 'reload schema';


-- ########## PART 3: attendance v3 (payment switch, batch filter, report) ##########
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
