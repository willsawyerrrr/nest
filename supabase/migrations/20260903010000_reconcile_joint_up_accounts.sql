-- Reconcile the household's JOINT Up-sourced accounts against what its members' tokens still report.
--
-- reconcile_up_accounts settles each member's individually-owned `source = 'up'`
-- accounts against that one member's token. A joint account (owned by neither
-- member) is visible through BOTH partners' tokens, so a single member's token
-- dropping it does not prove it was deleted in Up — that pass leaves joint
-- accounts alone.
--
-- This is the joint half. up-sync calls it once per household per run, but only
-- when every connected member of that household synced with a readable token,
-- passing the UNION of the Up account ids those tokens returned. Given that
-- union it applies the same three rules reconcile_up_accounts does, keyed on
-- `owner_member_id IS NULL` instead of a single member:
--   • an id the union no longer reports and nothing references is deleted
--     (its account_balance cascades);
--   • one still referenced by a savings goal, a budget line's funding account,
--     the household pay account, or a member's super link is kept and stamped
--     `deleted_from_source_at`, which the PWA shows as "deleted in Up";
--   • an account that reappears in the union in a later sync has the stamp cleared.
--
-- p_present_external_ids empty is a valid "no member reported any Up account"
-- result and reconciles the household's joint Up accounts all the way,
-- mirroring reconcile_up_accounts.

create function public.reconcile_joint_up_accounts(
  p_household_id uuid,
  p_present_external_ids text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Reported again by some member: clear any stamp a prior run left.
  update public.accounts a
    set deleted_from_source_at = null
  where a.household_id = p_household_id
    and a.owner_member_id is null
    and a.source = 'up'
    and a.deleted_from_source_at is not null
    and a.external_id = any(p_present_external_ids);

  -- Absent from every member's read but still referenced: keep it and stamp it.
  update public.accounts a
    set deleted_from_source_at = now()
  where a.household_id = p_household_id
    and a.owner_member_id is null
    and a.source = 'up'
    and a.deleted_from_source_at is null
    and a.external_id <> all(p_present_external_ids)
    and (
      exists (select 1 from public.savings_goal g where g.linked_account_id = a.id)
      or exists (select 1 from public.budget_line b where b.destination_account_id = a.id)
      or exists (select 1 from public.households h where h.pay_account_id = a.id)
      or exists (select 1 from public.super_profile s where s.linked_account_id = a.id)
    );

  -- Absent from every member's read and unreferenced: delete it; account_balance cascades.
  delete from public.accounts a
  where a.household_id = p_household_id
    and a.owner_member_id is null
    and a.source = 'up'
    and a.external_id <> all(p_present_external_ids)
    and not exists (select 1 from public.savings_goal g where g.linked_account_id = a.id)
    and not exists (select 1 from public.budget_line b where b.destination_account_id = a.id)
    and not exists (select 1 from public.households h where h.pay_account_id = a.id)
    and not exists (select 1 from public.super_profile s where s.linked_account_id = a.id);
end;
$$;

-- Like reconcile_up_accounts, the function is the only path service_role has to
-- delete from `accounts` — it runs as its owner, and service_role's own grants
-- stay select/insert/update (see docs/operations.md).
revoke execute on function public.reconcile_joint_up_accounts(uuid, text[]) from public;
grant execute on function public.reconcile_joint_up_accounts(uuid, text[]) to service_role;
