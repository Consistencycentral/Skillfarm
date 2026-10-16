-- ===========================================================================
-- SkillFarm — Storage buckets ONLY (creates org-logos + course-images).
-- Run this in the Supabase SQL Editor if the main migration created the
-- tables/columns but the buckets came back empty (listBuckets -> none).
-- Idempotent.
-- ===========================================================================

-- Buckets (public read, authenticated upload namespaced by uid).
insert into storage.buckets (id, name, public)
values ('org-logos', 'org-logos', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('course-images', 'course-images', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- org-logos policies (public read; authenticated upload/update under own uid)
-- ---------------------------------------------------------------------------
drop policy if exists "org_logos_read_all" on storage.objects;
create policy "org_logos_read_all" on storage.objects
  for select to public using (bucket_id = 'org-logos');

drop policy if exists "org_logos_insert_own" on storage.objects;
create policy "org_logos_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'org-logos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "org_logos_update_own" on storage.objects;
create policy "org_logos_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'org-logos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'org-logos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- course-images policies
-- ---------------------------------------------------------------------------
drop policy if exists "course_images_read_all" on storage.objects;
create policy "course_images_read_all" on storage.objects
  for select to public using (bucket_id = 'course-images');

drop policy if exists "course_images_insert_own" on storage.objects;
create policy "course_images_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'course-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "course_images_update_own" on storage.objects;
create policy "course_images_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'course-images' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'course-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- Confirm.
select id, name, public from storage.buckets
where id in ('org-logos','course-images')
order by id;
