-- SkillFarm final review access guard
-- Signed-in users may review any course, except the Learning Partner who owns it.
-- Safe to re-run after the earlier review-access migration.
begin;

alter table public.reviews enable row level security;

drop policy if exists "reviews_insert_authenticated" on public.reviews;
drop policy if exists "reviews_insert_registered" on public.reviews;

create policy "reviews_insert_authenticated" on public.reviews
  for insert to authenticated
  with check (
    learner_id = auth.uid()
    and not exists (
      select 1
      from public.courses c
      where c.id = course_id
        and c.provider_id = auth.uid()
    )
  );

notify pgrst, 'reload schema';
commit;
