-- SkillFarm client visibility + organization gallery
-- Run after 20260903, 20260904 and 20260905 migrations. Safe to re-run.
begin;

alter table public.profiles
  add column if not exists org_images text[] not null default '{}';

-- Rebuild the anonymous-safe organization view with the new gallery field.
create or replace view public.public_orgs
with (security_invoker = false) as
select
  p.id, p.full_name, p.org_name, p.org_logo_url, p.org_images, p.org_about,
  p.org_year_established, p.org_type, p.org_registration_number, p.org_website,
  p.org_address, p.org_maps_url, p.org_languages, p.org_sectors,
  coalesce(json_agg(
    json_build_object(
      'name', t.name, 'qualification', t.qualification,
      'experience', t.experience, 'expertise', t.expertise
    ) order by t.created_at
  ) filter (where t.id is not null), '[]'::json) as trainers
from public.profiles p
left join public.trainers t on t.provider_id = p.id
where (p.is_active is null or p.is_active = true)
group by p.id;

grant select on public.public_orgs to anon;
grant select on public.public_orgs to authenticated;

-- Make PostgREST immediately see the registrations -> batches FK after the
-- multi-batch migration. This is the relationship used by My Seats.
notify pgrst, 'reload schema';

commit;
