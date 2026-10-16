-- Fix: signup fails with HTTP 500 "Database error saving new user"
--
-- Cause: the on_auth_user_created trigger on auth.users errors during insert,
-- and GoTrue rolls back the whole signup. The trigger was an early attempt to
-- auto-create profiles rows; the app has since done that client-side
-- (ensureProfile() in app/login.tsx) under the "profiles insert own" policy,
-- so the trigger is both broken and unnecessary.
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> Run.

drop trigger if exists on_auth_user_created on auth.users;

-- Verify it is gone (expect zero rows):
select tgname from pg_trigger
where tgrelid = 'auth.users'::regclass and not tgisinternal;
