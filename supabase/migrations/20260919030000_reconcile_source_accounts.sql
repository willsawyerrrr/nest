-- Generalise reconcile_up_accounts to reconcile_source_accounts.
--
-- Same three-rule logic (clear a stale stamp on reappearance, stamp a
-- still-referenced account absent from this run, delete an absent and
-- unreferenced one), keyed on a `p_source` parameter instead of hardcoding
-- 'up', so redbark-sync's per-member reconcile shares the one RPC.
--
-- reconcile_joint_up_accounts stays Up-specific and is not generalised: a
-- Redbark connection is never joint (see redbark_connection's comment), so
-- there is no joint half for Redbark to share.

drop function public.reconcile_up_accounts(uuid, uuid, text[]);

create function public.reconcile_source_accounts(
  p_household_id uuid,
  p_owner_member_id uuid,
  p_source public.ledger_source,
  p_present_external_ids text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Reported again: it is not deleted-in-source, so clear any stamp a prior run left.
  update public.accounts a
    set deleted_from_source_at = null
  where a.household_id = p_household_id
    and a.owner_member_id = p_owner_member_id
    and a.source = p_source
    and a.deleted_from_source_at is not null
    and a.external_id = any(p_present_external_ids);

  -- Absent now but still referenced: keep it and stamp it for the PWA to prompt on.
  update public.accounts a
    set deleted_from_source_at = now()
  where a.household_id = p_household_id
    and a.owner_member_id = p_owner_member_id
    and a.source = p_source
    and a.deleted_from_source_at is null
    and a.external_id <> all(p_present_external_ids)
    and (
      exists (select 1 from public.savings_goal g where g.linked_account_id = a.id)
      or exists (select 1 from public.budget_line b where b.destination_account_id = a.id)
      or exists (select 1 from public.households h where h.pay_account_id = a.id)
      or exists (select 1 from public.super_profile s where s.linked_account_id = a.id)
    );

  -- Absent now and unreferenced: delete it; account_balance cascades.
  delete from public.accounts a
  where a.household_id = p_household_id
    and a.owner_member_id = p_owner_member_id
    and a.source = p_source
    and a.external_id <> all(p_present_external_ids)
    and not exists (select 1 from public.savings_goal g where g.linked_account_id = a.id)
    and not exists (select 1 from public.budget_line b where b.destination_account_id = a.id)
    and not exists (select 1 from public.households h where h.pay_account_id = a.id)
    and not exists (select 1 from public.super_profile s where s.linked_account_id = a.id);
end;
$$;

comment on function public.reconcile_source_accounts(uuid, uuid, public.ledger_source, text[])
  is 'Reconciles one member''s individually-owned accounts of the given source against the external ids that source''s sync returned this run; a sync calls it once per member after its account upsert, and a failed or absent credential read reconciles nothing (an empty list is a valid "this member has no accounts on this source" result). An account no longer reported and referenced by nothing is deleted (its account_balance cascades); one still referenced by a savings goal, a budget line''s funding account, the household pay account, or a member''s super link is kept and stamped `deleted_from_source_at`; an account that reappears in a later run has the stamp cleared. Generalises reconcile_up_accounts (source hardcoded to ''up'') to take source as a parameter, so up-sync and redbark-sync share this RPC; reconcile_joint_up_accounts remains Up-specific, since a Redbark connection is never joint.';

revoke execute on function public.reconcile_source_accounts(uuid, uuid, public.ledger_source, text[]) from public;
grant execute on function public.reconcile_source_accounts(uuid, uuid, public.ledger_source, text[]) to service_role;
