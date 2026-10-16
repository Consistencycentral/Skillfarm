-- SkillFarm theatre-seat integrity fix.
-- Apply this migration to persist exact seat assignments and make registration batch-scoped.
-- The app remains backward-compatible when this migration is not yet applied.

alter table public.registrations add column if not exists preferred_seat_number integer;

alter table public.registrations drop constraint if exists registrations_preferred_seat_check;
alter table public.registrations add constraint registrations_preferred_seat_check check (preferred_seat_number is null or preferred_seat_number > 0);

create or replace function public.get_batch_booked_seats(p_batch_id uuid)
returns json language sql security definer set search_path=public as $$
  select coalesce(json_agg(preferred_seat_number order by preferred_seat_number), '[]'::json)
  from public.registrations
  where batch_id=p_batch_id and preferred_seat_number is not null
    and status in ('pending','registered','completed');
$$;
grant execute on function public.get_batch_booked_seats(uuid) to authenticated;
