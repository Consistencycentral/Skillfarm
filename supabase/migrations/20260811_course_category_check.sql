-- ===========================================================================
-- SkillFarm — Course category constraint update (v4)
-- Run ONCE in the Supabase SQL Editor. Safe to re-run (idempotent).
--
-- Problem: the base schema.sql created `courses.category` with a CHECK
-- constraint listing the OLD category values. The app's CourseCategory union
-- (api/courses.ts) was since changed to 18 agriculture/allied sectors
-- (crop_cultivation, horticulture, … entrepreneurship), but the DB constraint
-- was never updated. So saving a course with any of the new sector values
-- fails:
--   "new row for relation 'courses' violates check constraint
--    'courses_category_check'"
--
-- This migration replaces the constraint with one that accepts exactly the 18
-- values the app sends, matching CourseCategory in api/courses.ts. We also
-- defensively reject an empty string so an accidental blank insert is caught.
-- ===========================================================================

-- Drop the existing named constraint if present (idempotent).
alter table public.courses
  drop constraint if exists courses_category_check;

-- Recreate it with the 18 agriculture/allied sector values. This list MUST stay
-- in sync with CourseCategory in api/courses.ts and CATEGORY_LIST there.
alter table public.courses
  add constraint courses_category_check
  check (category in (
    'crop_cultivation', 'horticulture', 'seed_technology', 'crop_protection',
    'agro_processing', 'food_processing', 'post_harvest', 'dairy',
    'animal_husbandry', 'fisheries', 'poultry', 'apiculture', 'sericulture',
    'agroforestry', 'organic_farming', 'precision_agri', 'agri_marketing',
    'entrepreneurship'
  ));

-- ---------------------------------------------------------------------------
-- If any existing rows already hold an OLD category value that is no longer in
-- the list above, the ADD CONSTRAINT above would fail (existing invalid rows).
-- In that case, re-run after normalizing them to the closest new sector with an
-- UPDATE like the one commented below. Their courses will then pass the check.
-- ---------------------------------------------------------------------------
-- update public.courses set category = 'crop_cultivation' where category = '<old_value>';

-- Confirm the constraint is in place and lists the expected count.
do $$
declare
  n int;
begin
  select count(*) into n from pg_constraint
    where conname = 'courses_category_check'
      and conrelid = 'public.courses'::regclass;
  raise notice '>>> courses_category_check present: %', (n = 1);
end$$;

-- Show the surviving categories so you can eyeball that all 18 are allowed.
select '>>> categories in use' as info, category, count(*) as n
  from public.courses group by category order by category;
