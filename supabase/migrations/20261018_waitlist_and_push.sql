-- ===========================================================================
-- SkillFarm v9 (2026-10-18). Run ONCE in Supabase SQL Editor (safe to re-run).
-- Run AFTER 20261014_client_fixes_v8.sql.
--
--  A. WAITLIST (item 7)
--     * join_waitlist()      learner joins when a batch is full
--     * promote_waitlist()   a freed seat goes to the oldest waitlisted learner
--                            automatically (as PENDING; the partner still approves)
--     * my_waitlist_positions()  "you are #3 on the waitlist"
--  B. REAL PUSH (item 5)
--     * push_tokens table + register_push_token() / unregister_push_token()
--     * trigger on registrations -> pg_net -> Edge Function `send-push` -> Expo
--
-- After running this file you must still do the one-time push setup
-- (see CLIENT_FIXES_V9.md, section "Push setup").
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A. WAITLIST
-- ---------------------------------------------------------------------------
alter table public.registrations
  add column if not exists waitlist_promoted_at timestamptz;

-- Learner joins the waitlist of a FULL batch. No seat number is held; the row is
-- status 'waitlist'. One active row per learner per batch (seat or waitlist).
create or replace function public.join_waitlist(
  p_course_id uuid,
  p_batch_id uuid,
  p_email text default null,
  p_age int default null,
  p_location text default null,
  p_experience boolean default null,
  p_name text default null,
  p_phone text default null,
  p_additional_details text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course public.courses%rowtype;
  v_batch public.batches%rowtype;
  v_id uuid;
  v_pos int;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'error', 'Not signed in.');
  end if;

  select * into v_course from public.courses where id = p_course_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Course not found.');
  end if;
  if v_course.provider_id = auth.uid() then
    return json_build_object('ok', false, 'error', 'You cannot join the waitlist of your own course.');
  end if;

  select * into v_batch from public.batches where id = p_batch_id and course_id = p_course_id for update;
  if not found then
    return json_build_object('ok', false, 'error', 'Selected batch was not found.');
  end if;

  if v_batch.registration_deadline is not null
     and now() > (case
          when v_batch.registration_deadline = date_trunc('day', v_batch.registration_deadline at time zone 'UTC') at time zone 'UTC'
            then v_batch.registration_deadline + interval '1 day'
          else v_batch.registration_deadline end) then
    return json_build_object('ok', false, 'error', 'Booking for this batch is closed.');
  end if;

  if v_batch.start_date is not null and v_batch.start_date < (now() at time zone 'Asia/Kolkata')::date then
    return json_build_object('ok', false, 'error', 'This batch has already started.');
  end if;

  -- Only a genuinely full batch has a waitlist. Otherwise the learner should book a seat.
  if public.batch_held_count(p_batch_id) < least(40, v_batch.seats_total) then
    return json_build_object('ok', false, 'error', 'Seats are still available in this batch. Please choose a seat instead.');
  end if;

  if exists (
    select 1 from public.registrations r
    where r.batch_id = p_batch_id and r.student_id = auth.uid()
      and r.status in ('pending', 'registered', 'completed', 'waitlist')
  ) then
    return json_build_object('ok', false, 'error', 'You already have a seat or a waitlist spot in this batch.');
  end if;

  insert into public.registrations (
    course_id, student_id, batch_id, status, attendance_status,
    learner_email, learner_age, learner_location, learner_experience,
    learner_name, learner_phone, learner_additional_details
  ) values (
    p_course_id, auth.uid(), p_batch_id, 'waitlist', 'pending',
    p_email, p_age, p_location, p_experience,
    p_name, p_phone, p_additional_details
  ) returning id into v_id;

  select count(*)::int into v_pos
  from public.registrations w
  where w.batch_id = p_batch_id and w.status = 'waitlist';

  return json_build_object('ok', true, 'status', 'waitlist',
    'registration_id', v_id, 'position', v_pos, 'batch_id', p_batch_id);
end;
$$;

grant execute on function public.join_waitlist(uuid, uuid, text, int, text, boolean, text, text, text) to authenticated;

-- Give every free seat of a batch to the oldest waitlisted learners.
-- The learner gets the LOWEST free seat as PENDING (the partner still approves,
-- exactly like a normal booking). Returns how many learners were promoted.
create or replace function public.promote_waitlist(p_batch_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.batches%rowtype;
  v_cap int;
  v_reg public.registrations%rowtype;
  v_seat int;
  v_count int := 0;
begin
  select * into v_batch from public.batches where id = p_batch_id for update;
  if not found then return 0; end if;

  -- A batch that has already started does not take new seats.
  if v_batch.start_date is not null and v_batch.start_date < (now() at time zone 'Asia/Kolkata')::date then
    return 0;
  end if;

  v_cap := least(40, v_batch.seats_total);

  loop
    exit when public.batch_held_count(p_batch_id) >= v_cap;

    select * into v_reg
    from public.registrations
    where batch_id = p_batch_id and status = 'waitlist'
    order by registered_at, id
    limit 1
    for update skip locked;
    exit when not found;

    select min(n) into v_seat
    from generate_series(1, v_cap) n
    where not exists (
      select 1 from public.registrations r
      where r.batch_id = p_batch_id
        and r.preferred_seat_number = n
        and r.status in ('pending', 'registered', 'completed'));
    exit when v_seat is null;

    update public.registrations
    set status = 'pending', preferred_seat_number = v_seat, waitlist_promoted_at = now()
    where id = v_reg.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.promote_waitlist(uuid) from public, anon, authenticated;

-- A held seat was released (learner cancelled / partner rejected / row deleted)
-- -> hand it to the waitlist. 'trg_zz_' sorts after the seat-count sync trigger.
create or replace function public.trg_promote_waitlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch uuid := coalesce(old.batch_id, new.batch_id);
begin
  if v_batch is not null then
    perform public.promote_waitlist(v_batch);
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_zz_promote_waitlist_upd on public.registrations;
create trigger trg_zz_promote_waitlist_upd
after update of status on public.registrations
for each row
when (old.status in ('pending', 'registered', 'completed') and new.status in ('cancelled', 'rejected'))
execute function public.trg_promote_waitlist();

drop trigger if exists trg_zz_promote_waitlist_del on public.registrations;
create trigger trg_zz_promote_waitlist_del
after delete on public.registrations
for each row
when (old.status in ('pending', 'registered', 'completed'))
execute function public.trg_promote_waitlist();

-- "You are #N on the waitlist" for the signed-in learner (oldest = #1).
create or replace function public.my_waitlist_positions()
returns table (registration_id uuid, queue_position int, waitlist_total int)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    (select count(*)::int from public.registrations w
      where w.batch_id = r.batch_id and w.status = 'waitlist'
        and (coalesce(w.registered_at, 'epoch'::timestamptz), w.id) <= (coalesce(r.registered_at, 'epoch'::timestamptz), r.id)),
    (select count(*)::int from public.registrations w
      where w.batch_id = r.batch_id and w.status = 'waitlist')
  from public.registrations r
  where r.student_id = auth.uid() and r.status = 'waitlist';
$$;

grant execute on function public.my_waitlist_positions() to authenticated;

-- ---------------------------------------------------------------------------
-- B. REAL PUSH NOTIFICATIONS
-- ---------------------------------------------------------------------------
create table if not exists public.push_tokens (
  token      text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  platform   text,
  updated_at timestamptz not null default now()
);
create index if not exists push_tokens_user_idx on public.push_tokens (user_id);

-- Locked down: only the functions below and the Edge Function (service role) touch it.
alter table public.push_tokens enable row level security;
revoke all on public.push_tokens from anon, authenticated;

-- The device registers its Expo push token. A token always belongs to whoever is
-- signed in on that device NOW, so a shared phone never pings the previous user.
create or replace function public.register_push_token(p_token text, p_platform text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'error', 'Not signed in.');
  end if;
  if p_token is null or p_token !~ '^(Exponent|Expo)PushToken\[.+\]$' then
    return json_build_object('ok', false, 'error', 'Invalid push token.');
  end if;
  insert into public.push_tokens (token, user_id, platform, updated_at)
  values (p_token, auth.uid(), left(coalesce(p_platform, ''), 20), now())
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
  return json_build_object('ok', true);
end;
$$;
grant execute on function public.register_push_token(text, text) to authenticated;

create or replace function public.unregister_push_token(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'error', 'Not signed in.');
  end if;
  delete from public.push_tokens where token = p_token and user_id = auth.uid();
  return json_build_object('ok', true);
end;
$$;
grant execute on function public.unregister_push_token(text) to authenticated;

-- pg_net lets the database call the Edge Function.
create extension if not exists pg_net;

-- Settings live in the already locked-down app_settings table (no client access):
--   push_function_url     https://<project-ref>.supabase.co/functions/v1/send-push
--   push_webhook_secret   same value as the Edge Function secret PUSH_WEBHOOK_SECRET
-- Until both are set, the trigger below silently does nothing.

create or replace function public.notify_registration_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
  v_course text;
  v_title text;
  v_body text;
  v_type text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'registered' and old.status in ('pending', 'waitlist') then
    v_type := 'ticket-ready';
  elsif new.status = 'rejected' and old.status in ('pending', 'waitlist', 'registered') then
    v_type := 'request-rejected';
  elsif old.status = 'waitlist' and new.status = 'pending' then
    v_type := 'seat-opened';
  else
    return new;
  end if;

  select value into v_url from public.app_settings where key = 'push_function_url';
  select value into v_secret from public.app_settings where key = 'push_webhook_secret';
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    return new;
  end if;

  select title into v_course from public.courses where id = new.course_id;
  v_course := coalesce(v_course, 'Your course');

  if v_type = 'ticket-ready' then
    v_title := 'Seat approved — your QR ticket is ready';
    v_body  := v_course || ' is confirmed. Tap to open your attendance ticket.';
  elsif v_type = 'request-rejected' then
    v_title := 'Request not approved';
    v_body  := 'Your request for ' || v_course || ' was not approved.';
  else
    v_title := 'A seat opened up for you';
    v_body  := v_course || ': a seat is now held for you and waits for the Learning Partner''s approval.';
  end if;

  -- A push problem must NEVER break a booking or an approval.
  begin
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
      body := jsonb_build_object(
        'user_id', new.student_id,
        'title', v_title,
        'body', v_body,
        'data', jsonb_build_object('type', v_type, 'registrationId', new.id, 'courseId', new.course_id)
      )
    );
  exception when others then
    raise warning 'SkillFarm push skipped: %', sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists trg_zz_registration_push on public.registrations;
create trigger trg_zz_registration_push
after update of status on public.registrations
for each row
execute function public.notify_registration_push();

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- a) 5 rows (functions exist):
--    select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public' and proname in
--      ('join_waitlist','promote_waitlist','my_waitlist_positions','register_push_token','notify_registration_push');
-- b) 3 rows (triggers exist):
--    select tgname from pg_trigger where tgname in
--      ('trg_zz_promote_waitlist_upd','trg_zz_promote_waitlist_del','trg_zz_registration_push') and not tgisinternal;
-- c) push configured? (2 rows once set up):
--    select key from public.app_settings where key in ('push_function_url','push_webhook_secret');
