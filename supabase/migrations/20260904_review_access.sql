-- SkillFarm: authenticated review access
-- Client requirement: signed-in users may rate/comment without an approved registration.
-- Course-owner self-review remains blocked by the application UI; ownership can also be
-- enforced in a later policy if the production schema exposes provider ownership directly.

alter table public.reviews enable row level security;

drop policy if exists "reviews_insert_registered" on public.reviews;
drop policy if exists "reviews_insert_authenticated" on public.reviews;

create policy "reviews_insert_authenticated" on public.reviews
  for insert to authenticated
  with check (learner_id = auth.uid());
