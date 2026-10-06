-- Every household member has exactly one spending allowance, and it is permanent.
--
-- An allowance is created with its member (at zero until set), removed only when
-- the member or household is, and edited only in its amount, cadence, and funding
-- account. Its member and household are fixed. The schema enforces this, so no
-- client path can add a second allowance, delete one, or reassign one.

-- ── A zero allowance is a valid, unset allowance ─────────────────────────────

alter table public.member_allowance
  drop constraint member_allowance_amount_cents_check,
  add constraint member_allowance_amount_cents_check check (amount_cents >= 0);

comment on table public.member_allowance is 'A household member''s permanent discretionary spending allowance: an amount on a frequency that is the Discretionary outgoing for that person, zero until set. Created with the member and removed only with the member. Budget lines drawn from it count against it, not on top of it. A budgeting envelope only; money stays pooled.';

-- ── Backfill: every existing member gets an allowance ────────────────────────

insert into public.member_allowance (household_id, member_id, amount_cents, frequency)
  select household_id, id, 0, 'fortnightly' from public.members
  on conflict (member_id, household_id) do nothing;

-- ── Auto-create a member's allowance on insert ───────────────────────────────
--
-- SECURITY DEFINER so it bypasses the table's grants regardless of the caller;
-- members are inserted through the SECURITY DEFINER onboarding and
-- join_household RPCs, and this single trigger covers every path.
create function public.add_member_allowance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.member_allowance (household_id, member_id, amount_cents, frequency)
    values (new.household_id, new.id, 0, 'fortnightly')
    on conflict (member_id, household_id) do nothing;
  return new;
end;
$$;
comment on function public.add_member_allowance() is 'Creates the zero spending allowance of a newly inserted household member.';

create trigger add_allowance after insert on public.members
  for each row execute function public.add_member_allowance();

-- ── Guard: an allowance outlives nothing but its member ──────────────────────
--
-- A delete is refused while the member and household still exist; the member
-- and household foreign-key cascades remove the row once they are gone.
create function public.prevent_member_allowance_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.households where id = old.household_id)
     and exists (select 1 from public.members where id = old.member_id) then
    raise exception 'a member''s spending allowance cannot be deleted; change its amount instead'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;
comment on function public.prevent_member_allowance_delete() is 'Rejects deleting a spending allowance while its member exists.';

create trigger prevent_allowance_delete before delete on public.member_allowance
  for each row execute function public.prevent_member_allowance_delete();

-- ── Guard: an allowance cannot be reassigned ─────────────────────────────────

create function public.prevent_member_allowance_reassign()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'a spending allowance cannot be moved to another member or household'
    using errcode = 'check_violation';
end;
$$;
comment on function public.prevent_member_allowance_reassign() is 'Rejects changing the member or household a spending allowance belongs to.';

create trigger prevent_allowance_reassign before update of member_id, household_id on public.member_allowance
  for each row
  when (old.member_id is distinct from new.member_id or old.household_id is distinct from new.household_id)
  execute function public.prevent_member_allowance_reassign();

-- ── Privileges and policies: read and edit, never create or delete ───────────

drop policy "household members manage member allowances" on public.member_allowance;

create policy "household members read member allowances" on public.member_allowance
  for select to authenticated
  using (household_id in (select public.household_ids_for_current_user()));

create policy "household members edit member allowances" on public.member_allowance
  for update to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));

revoke insert, update, delete on public.member_allowance from authenticated;
grant update (amount_cents, frequency, interval_count, destination_account_id)
  on public.member_allowance to authenticated;
