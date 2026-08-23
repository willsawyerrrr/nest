-- Unassigned gift purchases: logged before a recipient and occasion (or the
-- ad hoc buffer) are decided.
--
-- A gift_purchase used to always count against exactly one of a gift_budget or
-- the household's discretionary buffer. That leaves no way to log a
-- purpose-less purchase -- wrapping paper, gift bags, stocking fillers bought
-- throughout the year with no recipient in mind yet -- without either
-- inventing a placeholder gift budget or folding it into the discretionary
-- buffer, which is itself a planned amount for genuinely unplanned occasions,
-- not a staging area for purchases still awaiting a decision.
--
-- A purchase may now count against neither: gift_budget_id and
-- gift_discretionary_budget_id both null. It reads and writes exactly like any
-- other purchase -- RLS's existing `gift_budget_id is null` branch
-- (20260829020000_private_ad_hoc_gift_purchases.sql) already covers it, gated
-- on the same recipient tag, which stays null here (gift_purchase_recipient_
-- requires_discretionary still limits the tag to a discretionary-budget
-- purchase). The only rule that changes is that a purchase may no longer count
-- against both a gift_budget and the buffer at once.

alter table public.gift_purchase
  drop constraint gift_purchase_budget_xor_discretionary;

alter table public.gift_purchase
  add constraint gift_purchase_budget_not_both
    check (not (gift_budget_id is not null and gift_discretionary_budget_id is not null));

comment on column public.gift_purchase.gift_budget_id is 'The gift budget this purchase counts against; null for an ad hoc purchase against the household''s discretionary buffer, or an unassigned purchase awaiting either (gift_purchase_budget_not_both).';
comment on column public.gift_purchase.gift_discretionary_budget_id is 'The household''s discretionary gift buffer this ad hoc purchase counts against; null for a purchase linked to a gift_budget instead, or an unassigned purchase awaiting either (gift_purchase_budget_not_both).';
