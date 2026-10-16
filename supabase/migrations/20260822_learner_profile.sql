-- ===========================================================================
-- SkillFarm — Learner Profile (P2.10)
-- Run ONCE in the Supabase SQL Editor. Idempotent — safe to re-run.
--
-- Adds the learner-facing half of `profiles`. Until now the table only carried
-- full_name/phone/role plus the Learning Partner's org_* columns, and
-- app/(student)/profile.tsx was a stub with two links.
--
--   1) Basic info      first_name, last_name  (auth.users.email stays the
--                      single source of truth for the email — not duplicated
--                      here, so it can never drift from the login identity)
--   2) Headline         headline
--   3) Biography        bio
--   4) Profile picture  avatar_url + a new public `avatars` storage bucket
--   5) Links            website_url (full URL) and four social HANDLES
--   6) Privacy          profile_public, show_enrolled_courses
--
-- Socials are stored as handles, not URLs, on purpose: the app renders them
-- behind a fixed prefix (twitter.com/<handle>), so a profile cannot be turned
-- into a link to an arbitrary attacker-controlled host. website_url is the one
-- free-form URL and is restricted to http/https by a CHECK below.
--
-- full_name is NOT dropped. It remains the display name joined by
-- api/courses.ts, api/reviews.ts and api/registrations.ts; the app keeps it in
-- sync as first_name + last_name on every save.
--
-- SCOPE CHANGE (2026-08-21, after this file was written): the public learner
-- profile was cut back on request. The app now uses ONLY first_name/last_name,
-- avatar_url, the `avatars` bucket and the storage DELETE policies in section 3.
-- headline, bio, website_url, the four *_handle columns, profile_public,
-- show_enrolled_courses and get_public_learner_profile() are all still created
-- by this file but nothing reads them — the /learner/[id] viewer screen and the
-- headline/bio/links/privacy form sections were removed. They are left in place
-- rather than dropped so re-running this file stays safe and the feature can
-- come back without a schema change. profiles_select_scoped is still the SELECT
-- policy and still behaves correctly: profile_public defaults to true, so with
-- the switch gone every learner profile is readable by signed-in users, exactly
-- as it was before this migration.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) Columns
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists first_name            text;
alter table public.profiles add column if not exists last_name             text;
alter table public.profiles add column if not exists headline              text;
alter table public.profiles add column if not exists bio                   text;
alter table public.profiles add column if not exists avatar_url            text;
alter table public.profiles add column if not exists website_url           text;
alter table public.profiles add column if not exists twitter_handle        text;
alter table public.profiles add column if not exists facebook_handle       text;
alter table public.profiles add column if not exists linkedin_handle       text;
alter table public.profiles add column if not exists youtube_handle        text;
alter table public.profiles add column if not exists profile_public        boolean not null default true;
alter table public.profiles add column if not exists show_enrolled_courses boolean not null default false;

-- Length caps so one profile cannot ship a megabyte to every course page.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_headline_len') then
    alter table public.profiles add constraint profiles_headline_len
      check (headline is null or char_length(headline) <= 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_bio_len') then
    alter table public.profiles add constraint profiles_bio_len
      check (bio is null or char_length(bio) <= 2000);
  end if;
  -- Only http(s). Blocks javascript:, file:, intent: and friends from ever
  -- reaching Linking.openURL on another user's device.
  if not exists (select 1 from pg_constraint where conname = 'profiles_website_scheme') then
    alter table public.profiles add constraint profiles_website_scheme
      check (website_url is null or website_url ~* '^https?://[^\s]+$');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Backfill first/last from the existing full_name so nobody's name
--    disappears from the form on first open. Splits on the first space.
-- ---------------------------------------------------------------------------
update public.profiles
   set first_name = nullif(split_part(trim(full_name), ' ', 1), ''),
       last_name  = nullif(trim(substr(trim(full_name),
                        length(split_part(trim(full_name), ' ', 1)) + 1)), '')
 where full_name is not null
   and first_name is null
   and last_name is null;

-- ---------------------------------------------------------------------------
-- 3) `avatars` storage bucket — public read, uploads namespaced by uid.
--
-- Same shape as org-logos/course-images (migration 20260807): the object name
-- must start with the uploader's uid, which is what the WITH CHECK enforces.
-- Public read is required because <Image> fetches the URL with no auth header.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars_read_all" on storage.objects;
create policy "avatars_read_all" on storage.objects
  for select to public using (bucket_id = 'avatars');

drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- While we are in storage: migration 20260807 created read/insert/update
-- policies for org-logos and course-images but no DELETE policy, so every
-- deleteImage() call in lib/storage.ts has been failing silently (it catches
-- and ignores). Add the missing owner-scoped deletes so removing a logo or a
-- course image actually removes the object instead of orphaning it.
drop policy if exists "org_logos_delete_own" on storage.objects;
create policy "org_logos_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'org-logos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "course_images_delete_own" on storage.objects;
create policy "course_images_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'course-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- 4) Privacy setting #1 — "profile visible to other logged-in users".
--
-- Migration 20260821 left profiles SELECT as `to authenticated using (true)`
-- and flagged learner-to-learner PII as the remaining gap. This closes it and
-- makes the toggle mean something rather than being a stored preference with
-- no enforcement.
--
-- Four ways a row stays readable:
--   a) it is your own row;
--   b) role = 'provider'   — org profiles are public-facing by design and are
--      joined by api/courses.ts (provider_name) and getPublicOrgProfile();
--   c) the learner left profile_public on (the default);
--   d) you are a Learning Partner and this learner registered for one of your
--      courses — the enrollment dashboard and the report export must keep
--      working even for a learner who hid their public profile.
-- ---------------------------------------------------------------------------
drop policy if exists "profiles_select_all" on public.profiles;
drop policy if exists "profiles_select_scoped" on public.profiles;
create policy "profiles_select_scoped" on public.profiles
  for select to authenticated
  using (
    auth.uid() = id
    or role = 'provider'
    or coalesce(profile_public, true)
    or exists (
      select 1
      from public.registrations r
      join public.courses c on c.id = r.course_id
      where r.student_id = profiles.id
        and c.provider_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 5) Public profile reader + privacy setting #2 — "show my enrolled courses".
--
-- SECURITY DEFINER so both privacy flags are enforced in exactly one auditable
-- place instead of being spread across RLS + client filtering. Returns
-- { ok:false, private:true } for a hidden profile so the viewer screen can say
-- "this learner keeps their profile private" rather than "not found".
--
-- Only 'registered' and 'completed' enrollments are ever exposed: a pending
-- request is a private intention, not an achievement.
-- ---------------------------------------------------------------------------
create or replace function public.get_public_learner_profile(p_user_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p       public.profiles%rowtype;
  v_courses json;
  v_is_me   boolean;
begin
  if auth.uid() is null then
    return json_build_object('ok', false, 'error', 'Not signed in.');
  end if;

  select * into v_p from public.profiles where id = p_user_id;
  if not found then
    return json_build_object('ok', false, 'error', 'Profile not found.');
  end if;

  v_is_me := (auth.uid() = p_user_id);

  if not v_is_me and not coalesce(v_p.profile_public, true) then
    return json_build_object(
      'ok', false, 'private', true,
      'error', 'This learner keeps their profile private.'
    );
  end if;

  if v_is_me or coalesce(v_p.show_enrolled_courses, false) then
    select coalesce(
             json_agg(
               json_build_object(
                 'id',         c.id,
                 'title',      c.title,
                 'category',   c.category,
                 'start_date', c.start_date,
                 'city',       c.city,
                 'status',     r.status
               ) order by r.registered_at desc
             ), '[]'::json)
      into v_courses
      from public.registrations r
      join public.courses c on c.id = r.course_id
     where r.student_id = p_user_id
       and r.status in ('registered', 'completed');
  else
    v_courses := null;   -- null = hidden, [] = opted in but nothing yet
  end if;

  return json_build_object(
    'ok', true,
    'is_me', v_is_me,
    'profile', json_build_object(
      'id',              v_p.id,
      'full_name',       v_p.full_name,
      'first_name',      v_p.first_name,
      'last_name',       v_p.last_name,
      'headline',        v_p.headline,
      'bio',             v_p.bio,
      'avatar_url',      v_p.avatar_url,
      'website_url',     v_p.website_url,
      'twitter_handle',  v_p.twitter_handle,
      'facebook_handle', v_p.facebook_handle,
      'linkedin_handle', v_p.linkedin_handle,
      'youtube_handle',  v_p.youtube_handle,
      'created_at',      v_p.created_at
    ),
    'courses', v_courses
  );
end;
$$;

grant execute on function public.get_public_learner_profile(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) Verify. Read the output rather than assuming success.
-- ---------------------------------------------------------------------------

-- Expect 12 rows.
select '1. new profile columns' as step, column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
  and column_name in (
    'first_name','last_name','headline','bio','avatar_url','website_url',
    'twitter_handle','facebook_handle','linkedin_handle','youtube_handle',
    'profile_public','show_enrolled_courses')
order by column_name;

-- Expect one row: avatars, public = true.
select '2. avatars bucket' as step, id, public
from storage.buckets where id = 'avatars';

-- Expect 4 delete policies: avatars, course-images, org-logos (+ any others).
select '3. storage delete policies' as step, policyname, cmd
from pg_policies
where schemaname = 'storage' and tablename = 'objects' and cmd = 'DELETE'
order by policyname;

-- Expect exactly one SELECT policy on profiles, named profiles_select_scoped,
-- roles = {authenticated}.
select '4. profiles select policy' as step, policyname, cmd, roles, qual
from pg_policies
where schemaname = 'public' and tablename = 'profiles' and cmd = 'SELECT';

-- Expect one row.
select '5. reader rpc' as step, proname,
       pg_get_function_identity_arguments(oid) as args, prosecdef as security_definer
from pg_proc
where proname = 'get_public_learner_profile' and pronamespace = 'public'::regnamespace;

-- Sanity: your own profile must still be readable through the new policy.
select '6. can read own profile' as step, count(*) = 1 as ok
from public.profiles where id = auth.uid();
