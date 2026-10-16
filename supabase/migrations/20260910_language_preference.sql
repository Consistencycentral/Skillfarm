begin;
alter table public.profiles add column if not exists preferred_language text;
alter table public.profiles drop constraint if exists profiles_preferred_language_check;
alter table public.profiles add constraint profiles_preferred_language_check
check (preferred_language is null or preferred_language in (
  'en','as','bn','brx','doi','gu','hi','kn','ks','kok','mai','ml','mni','mr','ne','or','pa','sa','sat','sd','ta','te','ur'
));
create index if not exists profiles_preferred_language_idx on public.profiles(preferred_language);
update public.profiles set preferred_language='en' where preferred_language is null;
notify pgrst, 'reload schema';
commit;
