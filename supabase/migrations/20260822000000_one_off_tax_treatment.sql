-- How a taxable one-off payment is taxed, which is rarely at marginal rates alone.
--
-- Money paid once — severance, a bonus, leave cashed out when a job ends — is
-- assessed under concessions that depend on what the payment is FOR, not on how
-- large it is. A redundancy carries a tax-free amount that never enters
-- assessable income; a golden handshake carries none but is taxed at a capped
-- rate; leave paid out on a redundancy is assessable in full yet has the tax on
-- it capped. Taxing all three as ordinary salary overstates the liability on a
-- redundancy by thousands, so the payment states its own treatment and the FY
-- estimate models the concession that goes with it.
--
--   * `ordinary` — assessable in full at marginal rates. A bonus, a commission,
--     or back-pay: money that would have been salary had it arrived on time.
--   * `genuine_redundancy` — a redundancy payment. A tax-free amount computed
--     from completed years of service is excluded from assessable income
--     entirely; the excess is an employment termination payment, and being an
--     EXCLUDED payment it is capped by the ETP cap alone.
--   * `employment_termination` — an ETP that is not a genuine redundancy: a
--     golden handshake, or a payment in lieu of notice. A NON-EXCLUDED payment,
--     so its cap is the lesser of the ETP cap and the whole-of-income cap net of
--     the member's other taxable income.
--   * `unused_leave` — unused annual or long service leave paid out on a genuine
--     redundancy. Not an ETP: it is assessable in full, but the tax charged on it
--     is capped at a flat maximum rate.
--
-- The enum lands on its own because a new type cannot be referenced by DDL in the
-- same transaction that creates it; the column and its constraints follow in the
-- next migration.

-- `create type` takes no `if not exists`, so the type is guarded on its own
-- absence: everything else in this file is written to be re-runnable, and a type
-- that errored on a second pass would be the one thing that was not.
do $$
begin
  if to_regtype('public.one_off_tax_treatment') is null then
    create type public.one_off_tax_treatment as enum (
      'ordinary', 'genuine_redundancy', 'employment_termination', 'unused_leave'
    );
  end if;
end $$;

comment on type public.one_off_tax_treatment is 'The concession a taxable one-off payment is assessed under: ''ordinary'' assessable in full at marginal rates (a bonus, commission, or back-pay); ''genuine_redundancy'' a redundancy payment, whose tax-free amount computed from completed years of service is excluded from assessable income entirely and whose excess is an excluded ETP capped by the ETP cap alone; ''employment_termination'' an ETP that is not a genuine redundancy (a golden handshake, or a payment in lieu of notice), non-excluded and so capped at the lesser of the ETP cap and the whole-of-income cap net of the member''s other taxable income; ''unused_leave'' unused annual or long service leave paid out on a genuine redundancy, not an ETP but assessable in full with the tax charged on it capped at a flat maximum rate.';
