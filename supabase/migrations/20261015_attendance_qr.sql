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
