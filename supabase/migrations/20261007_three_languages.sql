-- SkillFarm: restrict account language preference to the three supported languages.
begin;
alter table public.profiles drop constraint if exists profiles_preferred_language_check;
alter table public.profiles add constraint profiles_preferred_language_check
check (preferred_language is null or preferred_language in ('en','ta','hi'));
update public.profiles set preferred_language='en'
where preferred_language is null or preferred_language not in ('en','ta','hi');
notify pgrst, 'reload schema';
commit;
