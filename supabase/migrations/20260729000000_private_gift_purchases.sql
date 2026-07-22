-- Private gift purchases: keep a gift's spend hidden from its recipient.
--
-- A gift's agreed budget is shared — both partners set it together, and it still
-- feeds the derived Gifts budget line and the pay splits unchanged. What is
-- private is the purchases logged against a gift and the spent/remaining they
-- derive, so a surprise is not spoiled for the person receiving it.
--
-- Privacy keys on the recipient being a household member. A gift_recipient can be
-- linked to a member via member_id: when set, that recipient IS that member, and
-- the purchases against their gift budgets are hidden from them (the recipient)
-- while staying visible to the buyer — any other member. An unlinked recipient
-- (member_id null) is an external person and stays fully shared, as before.

-- ── gift_recipient: optional link to a household member ──────────────────────

alter table public.gift_recipient
  add column member_id uuid,
  add constraint gift_recipient_member_id_household_id_fkey
    foreign key (member_id, household_id)
    references public.members (id, household_id) on delete set null (member_id);
comment on column public.gift_recipient.member_id is 'When set, this recipient is that household member and the purchases against their gift budgets are hidden from them; null is an external person, fully shared.';

-- ── Helper: gift budgets whose recipient is the current member ───────────────
--
-- The gift_budget ids the caller must not see purchases for — those whose
-- recipient is linked to one of the caller's own members. SECURITY DEFINER to
-- resolve the recipient links past table RLS without recursing through the
-- gift_purchase policies, mirroring visible_balance_account_ids.
create function public.hidden_gift_budget_ids_for_current_member()
returns setof uuid
language sql
security definer
set search_path = ''
stable
as $$
  select gb.id
  from public.gift_budget gb
  join public.gift_recipient gr
    on gr.id = gb.recipient_id and gr.household_id = gb.household_id
  where gr.member_id in (select public.current_member_ids());
$$;

revoke execute on function public.hidden_gift_budget_ids_for_current_member() from public;
grant execute on function public.hidden_gift_budget_ids_for_current_member() to authenticated;

-- ── gift_purchase: hide a member's own-gift purchases from them ───────────────
--
-- The blanket "household members manage" policy is replaced by per-command
-- policies gated on the hidden set: a member can read, change, or log a purchase
-- for any of the household's gifts except one whose recipient is themselves. The
-- recipient/occasion/budget tables keep their shared blanket policies — the
-- agreed budget is shared, and a recipient may see their own budgeted amount.

drop policy "household members manage gift purchases" on public.gift_purchase;

create policy "household members read others' gift purchases" on public.gift_purchase
  for select to authenticated
  using (
    household_id in (select public.household_ids_for_current_user())
    and gift_budget_id not in (select public.hidden_gift_budget_ids_for_current_member())
  );

create policy "household members insert others' gift purchases" on public.gift_purchase
  for insert to authenticated
  with check (
    household_id in (select public.household_ids_for_current_user())
    and gift_budget_id not in (select public.hidden_gift_budget_ids_for_current_member())
  );

create policy "household members update others' gift purchases" on public.gift_purchase
  for update to authenticated
  using (
    household_id in (select public.household_ids_for_current_user())
    and gift_budget_id not in (select public.hidden_gift_budget_ids_for_current_member())
  )
  with check (
    household_id in (select public.household_ids_for_current_user())
    and gift_budget_id not in (select public.hidden_gift_budget_ids_for_current_member())
  );

create policy "household members delete others' gift purchases" on public.gift_purchase
  for delete to authenticated
  using (
    household_id in (select public.household_ids_for_current_user())
    and gift_budget_id not in (select public.hidden_gift_budget_ids_for_current_member())
  );
