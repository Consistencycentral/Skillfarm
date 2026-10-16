-- ===========================================================================
-- SkillFarm — THE FIX for "Could not load course / no longer listed"
-- on shared course + org links (Bug 3).
--
-- Run once in the Supabase SQL Editor. Idempotent.
--
-- WHY ROWS VANISHED FROM public_courses
-- -------------------------------------
-- The view's WHERE clause filters on profiles.is_active, and providers created
-- BEFORE the org-profile migration have is_active = true only because that
-- migration defaulted the column. If a provider row was later created WITHOUT
-- going through the toggle (e.g. by an app signup whose profile insert didn't
-- set is_active, or by a trigger) it can end up NULL — and
--   where is_active is null or is_active = true
-- *should* keep those visible... unless the profile row is missing entirely,
-- which the LEFT JOIN turns into NULL anyway (fine), or the view was created
-- as INNER-join style by an older edit. The robust fix below therefore:
--   1. recreates public_courses with a LEFT JOIN and an explicit, commented
--      visibility rule,
--   2. recreates public_orgs the same way,
--   3. re-grants SELECT to anon + authenticated,
--   4. bumps PostgREST's schema cache so the change is visible immediately.
--
-- It also includes a ONE-LINE data repair for the most common data bug:
-- partner rows with is_active left NULL. The column's default is true, so
-- normalizing NULL -> true matches what the app's toggle UI shows.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0) Data repair: normalize is_active. NULL reads as "never touched the
--    switch" — the org-profile UI displays that as Active, so make the data
--    say what the UI means.
-- ---------------------------------------------------------------------------
update public.profiles
   set is_active = true
 where is_active is null;

-- ---------------------------------------------------------------------------
-- 1) public_courses — full marketing column set, active partners only.
--    NOTE: contact_phone is deliberately NOT here (never public).
-- ---------------------------------------------------------------------------
create or replace view public.public_courses
with (security_invoker = false) as
select
  c.id,
  c.provider_id,
  c.title,
  c.description,
  c.category,
  c.address,
  c.city,
  c.state,
  c.start_date,
  c.duration_weeks,
  c.seats_total,
  c.seats_filled,
  c.fee,
  c.discount,
  c.image_url,
  c.images,
  c.learning_outcomes,
  c.agenda,
  c.batch_timings,
  c.registration_deadline,
  c.language,
  c.certificate_available,
  c.eligibility,
  c.created_at,
  p.full_name as provider_name
from public.courses c
inner join public.profiles p on p.id = c.provider_id
where coalesce(p.is_active, true) = true;   -- inactive partners stay dark

grant select on public.public_courses to anon;
grant select on public.public_courses to authenticated;

-- ---------------------------------------------------------------------------
-- 2) public_orgs — org profile minus email/phone, trainers aggregated.
-- ---------------------------------------------------------------------------
create or replace view public.public_orgs
with (security_invoker = false) as
select
  p.id,
  p.full_name,
  p.org_name,
  p.org_logo_url,
  p.org_about,
  p.org_year_established,
  p.org_type,
  p.org_registration_number,
  p.org_website,
  p.org_address,
  p.org_maps_url,
  p.org_languages,
  p.org_sectors,
  coalesce(
    json_agg(
      json_build_object(
        'name', t.name,
        'qualification', t.qualification,
        'experience', t.experience,
        'expertise', t.expertise
      ) order by t.created_at
    ) filter (where t.id is not null),
    '[]'::json
  ) as trainers
from public.profiles p
left join public.trainers t on t.provider_id = p.id
where coalesce(p.is_active, true) = true
group by p.id;

grant select on public.public_orgs to anon;
grant select on public.public_orgs to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Refresh PostgREST's cached schema so the API sees the new view shapes
--    immediately (otherwise it serves the old shape until the project idles).
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 4) Verify — read the output, don't assume.
-- ---------------------------------------------------------------------------
-- 4a) Courses and their visibility through the view:
select
  c.title,
  p.full_name as partner,
  p.is_active,
  (select count(*) from public.public_courses v where v.id = c.id) as visible_to_public
from public.courses c
left join public.profiles p on p.id = c.provider_id
order by c.created_at desc;

-- Expect: every course you want shared shows visible_to_public = 1.
-- A 0 means that partner is inactive (is_active = false) — flip the switch in
-- the org profile in the app, or: update public.profiles set is_active = true
-- where id = '<provider id>';

-- 4b) The exact URL test, using the first course id:
-- select 'https://skillfarm.netlify.app/course/' || id as test_url
-- from public.public_courses limit 1;
