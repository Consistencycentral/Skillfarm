-- SkillFarm: optional theatre-style seat preference for batch registration.
-- This is intentionally a preference, not a capacity reservation. The existing
-- approval RPC remains the authority for capacity; providers can confirm or
-- change the seat when approving a request. No production data is deleted.
alter table public.registrations
  add column if not exists preferred_seat_number integer;

alter table public.registrations
  drop constraint if exists registrations_preferred_seat_check;
alter table public.registrations
  add constraint registrations_preferred_seat_check
  check (preferred_seat_number is null or preferred_seat_number > 0);

create index if not exists registrations_batch_preferred_seat_idx
  on public.registrations(batch_id, preferred_seat_number)
  where preferred_seat_number is not null;

-- Existing registration RPC remains authoritative. This helper lets the UI
-- store a preferred seat without granting learners direct UPDATE access.
create or replace function public.set_preferred_seat(p_reg_id uuid, p_seat_number integer)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg public.registrations%rowtype;
  v_batch public.batches%rowtype;
begin
  if auth.uid() is null then return json_build_object('ok', false, 'error', 'Not signed in.'); end if;
  select * into v_reg from public.registrations where id = p_reg_id and student_id = auth.uid() for update;
  if not found then return json_build_object('ok', false, 'error', 'Registration not found.'); end if;
  select * into v_batch from public.batches where id = v_reg.batch_id for update;
  if not found then return json_build_object('ok', false, 'error', 'Batch not found.'); end if;
  if p_seat_number is null or p_seat_number < 1 or p_seat_number > v_batch.seats_total then
    return json_build_object('ok', false, 'error', 'Seat is outside this batch capacity.');
  end if;
  update public.registrations set preferred_seat_number = p_seat_number where id = v_reg.id;
  return json_build_object('ok', true, 'preferred_seat_number', p_seat_number);
end;
$$;

grant execute on function public.set_preferred_seat(uuid, integer) to authenticated;
