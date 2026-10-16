-- SkillFarm 1.6.5 onboarding compatibility repair
-- Safe to run repeatedly in Supabase SQL Editor.
alter table public.profiles add column if not exists onboarding_complete boolean not null default false;
update public.profiles set onboarding_complete = true where onboarding_complete is null;
