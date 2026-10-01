-- Any member of a household sets a co-member's date of birth.
--
-- `tax_profile` and `help_debt` are household-wide CRUD, but `members` rows are
-- updatable only by their own user (`members update own profile`), so a
-- co-member's date of birth could not be written. Row-level security cannot scope
-- an update to one column, and widening the policy would expose `name` and
-- `email`, so the date of birth is written through a function that checks
-- household membership and touches nothing else. The direct column grant is
-- dropped so the function is the only write path.

revoke update (date_of_birth) on public.members from authenticated;

create function public.set_member_date_of_birth(p_member_id uuid, p_date_of_birth date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.members
    set date_of_birth = p_date_of_birth
    where id = p_member_id
      and household_id in (select public.household_ids_for_current_user());

  if not found then
    raise exception 'member not found in the caller''s household';
  end if;
end;
$$;

comment on function public.set_member_date_of_birth(uuid, date) is 'Sets (or clears, when null) the date of birth of any member of one of the caller''s households; the only client write path to `members.date_of_birth`.';

revoke execute on function public.set_member_date_of_birth(uuid, date) from public;
grant execute on function public.set_member_date_of_birth(uuid, date) to authenticated;
