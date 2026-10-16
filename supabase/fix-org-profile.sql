-- ===========================================================================
-- SkillFarm — Organization profile migration
-- Run ONCE in Supabase SQL Editor.
-- Adds org profile fields to `profiles` + an is_active toggle for Learning
-- Partners (inactive partners are hidden from learners browsing courses).
-- Safe to re-run (idempotent — uses IF NOT EXISTS).
-- ===========================================================================

-- ---------------------------------------------------------------
-- 1) Add organization columns to profiles (Learning Partner profile)
-- ---------------------------------------------------------------
alter table profiles
  add column if not exists org_name text,
  add column if not exists org_logo_url text,
  add column if not exists org_about text,
  add column if not exists org_year_established int,
  add column if not exists org_type text,
  add column if not exists org_registration_number text,
  add column if not exists org_website text,
  add column if not exists org_email text,
  add column if not exists org_phone text,
  add column if not exists org_address text,
  add column if not exists org_maps_url text,
  add column if not exists org_languages text,
  add column if not exists is_active boolean not null default true;

-- ---------------------------------------------------------------
-- 2) RLS: anyone (logged in) can READ the org profile fields so learners
--    see them on the course detail / provider page.
-- ---------------------------------------------------------------
-- (profiles already has a "profiles read all" select policy from schema.sql.)

-- ---------------------------------------------------------------
-- 3) Hide inactive Learning Partners from learners.
--    We add a second read policy so learners only see active providers'
--    courses. (Existing providers can still see their own rows.)
--    NB: this is enforced at the courses level via a view below.
-- ---------------------------------------------------------------

-- A secure view of courses that hides courses from inactive providers,
-- for use by learners. Providers themselves still read/write `courses` directly.
drop view if exists public.courses_visible;
create or replace view public.courses_visible as
  select c.*
  from public.courses c
  join public.profiles p on p.id = c.provider_id
  where p.is_active = true or c.provider_id = auth.uid();

grant select on public.courses_visible to authenticated;

-- >>> Confirm migration
select '>>> org columns added:' as info, count(*) as n
from information_schema.columns
where table_name = 'profiles'
  and column_name like 'org_%';
