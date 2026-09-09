-- Revoke the service_role reads on the breakdown and gift tables.
--
-- 20260915000000 granted service_role select on breakdown, breakdown_item,
-- gift_budget, gift_recipient, and gift_discretionary_budget because
-- `_shared/householdBuffer/` re-derived the breakdown- and gift-derived
-- budget-line amounts client-side, mirroring the PWA.
--
-- The loader stops re-deriving: the `reconcile_derived_lines` triggers already
-- keep every derived line's `amount_cents` (annual, whole cents, via
-- `reconcile_annual_cents` which mirrors `normalize.ts`'s `annualCents`) and
-- `frequency = 'annual'` canonical in `budget_line`, so the buffer reads the row
-- straight and needs none of these five tables. The database is the sole
-- authority for the derived amounts; the evaluator trusts it.

revoke select on
  public.breakdown,
  public.breakdown_item,
  public.gift_budget,
  public.gift_recipient,
  public.gift_discretionary_budget
  from service_role;
