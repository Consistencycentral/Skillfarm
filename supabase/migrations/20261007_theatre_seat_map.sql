-- Theatre-style seat status. Safe to apply on existing SkillFarm data.
-- Pending/registered/completed seats are treated as booked so learners never pick an already requested seat.
create or replace function public.get_batch_booked_seats(p_batch_id uuid)
returns json
language sql
security definer
set search_path = public
as $$
  select coalesce(json_agg(preferred_seat_number order by preferred_seat_number), '[]'::json)
  from public.registrations
  where batch_id = p_batch_id
    and preferred_seat_number is not null
    and status in ('pending','registered','completed');
$$;

grant execute on function public.get_batch_booked_seats(uuid) to anon, authenticated;
