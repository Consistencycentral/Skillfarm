-- ===========================================================================
-- SkillFarm — public catalog for the web landing + shareable web pages.
--
-- The 20260821 hardening made `courses`/`profiles` readable by `authenticated`
-- only (P0.5: the anon key ships in the APK, so full reads leaked names +
-- phone numbers). The shared-course and shared-organization web pages need an
-- anonymous read — these two views are the deliberate, narrow exception:
--
--   public_courses : the columns the landing page + public course detail
--                    screen render. Marketing content only.
--                    EXCLUDED: contact_phone, any learner data.
--   public_orgs    : the columns the public organization page renders.
--                    EXCLUDED: org_email, org_phone (partners are contacted
--                    from inside the app, by signed-in learners).
--
-- Both views are owned by postgres (security_invoker = false), so they read
-- through table RLS — that is exactly why the column lists above are the
-- security boundary. Keep them in sync with api/landing.ts and re-check the
-- EXCLUDED lists if you ever add columns.
--
-- Run once in the Supabase SQL Editor. Idempotent.
-- ===========================================================================

-- ---------------------------------------------------------------
-- 1) public_courses — landing + /course/<id> for anonymous visitors
-- ---------------------------------------------------------------
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
left join public.profiles p on p.id = c.provider_id
where p.is_active is null or p.is_active = true;   -- inactive partners stay dark

grant select on public.public_courses to anon;
grant select on public.public_courses to authenticated;

-- ---------------------------------------------------------------
-- 2) public_orgs — /org/<id> for anonymous visitors, plus the trainer
--    list the OrganizationCard shows (aggregated into one JSON column).
-- ---------------------------------------------------------------
create or replace view public.public_orgs
with (security_invoker = false) as
select
  p.id,
  p.full_name,
  p.org_name,
  p.org_logo_url,
  p.org_images,
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
where (p.is_active is null or p.is_active = true)
group by p.id;

grant select on public.public_orgs to anon;
grant select on public.public_orgs to authenticated;

-- ---------------------------------------------------------------
-- 3) Verify (read the output):
-- ---------------------------------------------------------------
-- Expect both views to appear with the EXCLUDED columns NOT present:
--   public_courses -> no contact_phone
--   public_orgs    -> no org_email / org_phone
-- select column_name from information_schema.columns
--  where table_schema='public' and table_name='public_courses' order by 1;
-- select column_name from information_schema.columns
--  where table_schema='public' and table_name='public_orgs' order by 1;
