-- Private gift transactions: withhold a claimed gift's card spend from its
-- recipient.
--
-- The property: a transaction the household has claimed as a gift for you is
-- withheld from you. Whichever account paid for it, your candidate inbox cannot
-- spoil the surprise — you are never handed the merchant or the amount of your
-- own present. The buyer keeps seeing both the transaction and the purchase.
--
-- Two rules already cover part of this. Purchases against a member's own gifts
-- are hidden from them (20260729000000_private_gift_purchases.sql), and a
-- transaction on a co-member's own spending account is outside their
-- balance-visible set (20260722120000_account_balance_privacy.sql), so a gift
-- bought on the buyer's own card never reaches the recipient at all. Spend on
-- the shared (2Up) account falls between the two: the transaction sits on an
-- account both partners see, while the purchase claiming it is hidden from the
-- recipient — so the recipient's inbox would go on offering the transaction as
-- an unclaimed candidate, amount and merchant included.

-- ── Helper: the transactions behind the caller's own gifts' purchases ─────────
--
-- SECURITY DEFINER precisely because the caller cannot read those gift_purchase
-- rows: they are the rows the gift_purchase policies hide from them, so the link
-- has to be resolved past that RLS. Mirrors
-- hidden_gift_budget_ids_for_current_member. Skipping the null transaction_ids
-- (a hand-entered purchase) is load-bearing: the policies below test the set with
-- `not in`, which a null member would collapse to no visible transaction at all.

create function public.hidden_gift_transaction_ids_for_current_member()
returns setof uuid
language sql
security definer
set search_path = ''
stable
as $$
  select gp.transaction_id
  from public.gift_purchase gp
  where gp.gift_budget_id in (select public.hidden_gift_budget_ids_for_current_member())
    and gp.transaction_id is not null;
$$;

revoke execute on function public.hidden_gift_transaction_ids_for_current_member() from public;
grant execute on function public.hidden_gift_transaction_ids_for_current_member() to authenticated;

-- ── transactions: exclude the rows claimed as the caller's own gifts ─────────
--
-- The new predicate joins the balance-visible gate rather than replacing it, so
-- every non-gift transaction keeps exactly the privacy it had: a row is the
-- caller's to see when its account's balance is theirs to see AND it is not the
-- spend behind one of their own gifts.
--
-- SELECT, UPDATE, and DELETE carry the predicate; INSERT does not, and neither
-- `with check` clause does. The set is keyed on a transaction's id: no write can
-- change it, and a row being inserted cannot yet be named by any purchase, so a
-- `with check` test would be a tautology. The `using` clauses are what matter —
-- on UPDATE and DELETE they also govern `returning`, which would otherwise hand
-- the withheld row straight back to its recipient.
--
-- Nothing legitimate is blocked. Clients only read this table; the household's
-- inbox writes go to gift_purchase and gift_transaction_dismissal. up-sync
-- writes transactions through sync_up_gift_transactions, a SECURITY DEFINER
-- function that runs as its owner and so is not constrained by these policies at
-- all — it upserts, prunes, and re-prices a claimed transaction unaffected.

drop policy "household members read visible-balance transactions" on public.transactions;

create policy "household members read visible-balance transactions" on public.transactions
  for select to authenticated
  using (
    household_id in (select public.household_ids_for_current_user())
    and account_id in (select public.visible_balance_account_ids())
    and id not in (select public.hidden_gift_transaction_ids_for_current_member())
  );

drop policy "household members update visible-balance transactions" on public.transactions;

create policy "household members update visible-balance transactions" on public.transactions
  for update to authenticated
  using (
    household_id in (select public.household_ids_for_current_user())
    and account_id in (select public.visible_balance_account_ids())
    and id not in (select public.hidden_gift_transaction_ids_for_current_member())
  )
  with check (
    household_id in (select public.household_ids_for_current_user())
    and account_id in (select public.visible_balance_account_ids())
  );

drop policy "household members delete visible-balance transactions" on public.transactions;

create policy "household members delete visible-balance transactions" on public.transactions
  for delete to authenticated
  using (
    household_id in (select public.household_ids_for_current_user())
    and account_id in (select public.visible_balance_account_ids())
    and id not in (select public.hidden_gift_transaction_ids_for_current_member())
  );
