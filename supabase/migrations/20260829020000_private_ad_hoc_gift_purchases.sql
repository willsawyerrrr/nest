-- Extend gift-purchase privacy to ad hoc purchases.
--
-- gift_purchase's four policies (20260729000000_private_gift_purchases.sql)
-- gate on `gift_budget_id not in (select hidden_gift_budget_ids_for_current_member())`.
-- gift_budget_id is now nullable (20260829000000) — an ad hoc purchase counts
-- against the household's discretionary buffer instead — and `null not in (...)`
-- evaluates to unknown, which the `using` / `with check` clauses treat as false:
-- every ad hoc purchase would be invisible to, and unwritable by, every member.
--
-- The policies are rewritten to branch on which kind of purchase a row is: a
-- budget-linked purchase (gift_budget_id not null) keeps the existing check
-- unchanged; an ad hoc purchase (gift_budget_id null) is instead gated on its own
-- optional recipient tag, hidden only when that recipient links to the caller's
-- own member — the same privacy a budget-linked purchase gets from its gift
-- budget's recipient, applied to the tag instead of the budget.

-- ── Helper: gift recipients linked to the current member ─────────────────────
--
-- The gift_recipient ids the caller must not see ad hoc purchases tagged with —
-- those linked to one of the caller's own members. SECURITY DEFINER to resolve
-- the link past table RLS without recursing through the gift_purchase policies,
-- mirroring hidden_gift_budget_ids_for_current_member.

create function public.hidden_gift_recipient_ids_for_current_member()
returns setof uuid
language sql
security definer
set search_path = ''
stable
as $$
  select gr.id
  from public.gift_recipient gr
  where gr.member_id in (select public.current_member_ids());
$$;

revoke execute on function public.hidden_gift_recipient_ids_for_current_member() from public;
grant execute on function public.hidden_gift_recipient_ids_for_current_member() to authenticated;

-- ── gift_purchase: branch per purchase kind ───────────────────────────────────

drop policy "household members read others' gift purchases" on public.gift_purchase;
drop policy "household members insert others' gift purchases" on public.gift_purchase;
drop policy "household members update others' gift purchases" on public.gift_purchase;
drop policy "household members delete others' gift purchases" on public.gift_purchase;

create policy "household members read others' gift purchases" on public.gift_purchase
  for select to authenticated
  using (
    household_id in (select public.household_ids_for_current_user())
    and (
      (gift_budget_id is not null
        and gift_budget_id not in (select public.hidden_gift_budget_ids_for_current_member()))
      or (gift_budget_id is null
        and (recipient_id is null
          or recipient_id not in (select public.hidden_gift_recipient_ids_for_current_member())))
    )
  );

create policy "household members insert others' gift purchases" on public.gift_purchase
  for insert to authenticated
  with check (
    household_id in (select public.household_ids_for_current_user())
    and (
      (gift_budget_id is not null
        and gift_budget_id not in (select public.hidden_gift_budget_ids_for_current_member()))
      or (gift_budget_id is null
        and (recipient_id is null
          or recipient_id not in (select public.hidden_gift_recipient_ids_for_current_member())))
    )
  );

create policy "household members update others' gift purchases" on public.gift_purchase
  for update to authenticated
  using (
    household_id in (select public.household_ids_for_current_user())
    and (
      (gift_budget_id is not null
        and gift_budget_id not in (select public.hidden_gift_budget_ids_for_current_member()))
      or (gift_budget_id is null
        and (recipient_id is null
          or recipient_id not in (select public.hidden_gift_recipient_ids_for_current_member())))
    )
  )
  with check (
    household_id in (select public.household_ids_for_current_user())
    and (
      (gift_budget_id is not null
        and gift_budget_id not in (select public.hidden_gift_budget_ids_for_current_member()))
      or (gift_budget_id is null
        and (recipient_id is null
          or recipient_id not in (select public.hidden_gift_recipient_ids_for_current_member())))
    )
  );

create policy "household members delete others' gift purchases" on public.gift_purchase
  for delete to authenticated
  using (
    household_id in (select public.household_ids_for_current_user())
    and (
      (gift_budget_id is not null
        and gift_budget_id not in (select public.hidden_gift_budget_ids_for_current_member()))
      or (gift_budget_id is null
        and (recipient_id is null
          or recipient_id not in (select public.hidden_gift_recipient_ids_for_current_member())))
    )
  );
