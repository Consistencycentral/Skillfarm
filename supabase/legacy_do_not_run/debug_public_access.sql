-- ===========================================================================
-- SkillFarm — DEBUG WHY THE SHARED COURSE LINK SAYS "no longer listed"
--
-- Paste the whole file into the Supabase SQL Editor and RUN. It is read-only —
-- it changes nothing. Read the output top to bottom; each section names the
-- conclusion to draw. Then run the FIX section at the bottom of this file
-- (public-catalog-fix.sql) or the specific statement the diagnosis points to.
-- ===========================================================================

-- 1) How many courses exist AT ALL (owner's view — sees every row)?
select count(*) as total_courses from public.courses;

-- 2) The join chain the public view relies on, with the filter that can drop
--    rows highlighted. A course disappears from public_courses when:
--      - its partner row is missing            (provider_id dangling)
--      - profiles.is_active = false            (partner toggled inactive)
--      - org profile never filled in / deleted
select
  c.id,
  c.title,
  c.provider_id,
  p.id          as profile_row_exists,
  p.full_name,
  p.is_active,                 -- FALSE here = that's why it's hidden
  p.org_name
from public.courses c
left join public.profiles p on p.id = c.provider_id
order by c.created_at desc;

-- 3) Exactly what an anonymous visitor sees through the view (should match the
--    "courses (N)" number on the landing page):
select count(*) as anon_visible_courses from public.public_courses;

-- 4) Same check for organizations:
select count(*) as anon_visible_orgs from public.public_orgs;
select id, org_name, full_name, is_active
from public.profiles
where role = 'provider';

-- 5) Is the view itself the NEW definition? (provider_id + images must appear;
--    if they don't, the updated public_catalog.sql was never run.)
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'public_courses'
order by ordinal_position;

-- 6) Do the anon grants exist? Both rows must say YES for the web (anon role)
--    to read at all:
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('public_courses', 'public_orgs')
  and grantee in ('anon', 'authenticated')
order by table_name, grantee;
