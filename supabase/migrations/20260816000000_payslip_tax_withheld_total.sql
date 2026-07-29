-- State that a payslip's withheld figures are the slip's tax total, STSL included.
--
-- An Australian slip withholds two amounts under one TAX section: PAYG income
-- tax and an STSL (study and training support loan) component that pays down
-- HELP. A real fortnight prints PAYG $1,416.00 and STSL $434.00 over a total of
-- $1,850.00, and net pay reconciles against the total ($5,495.50 gross less
-- $1,850.00 leaves $3,645.50).
--
-- The total is the figure these columns hold. The tax estimate's liability
-- already carries the compulsory HELP repayment, and the balance it reports is
-- that liability less the summed withheld, so recording the PAYG line alone
-- overstates the amount owing by every dollar of STSL withheld. Saying "PAYG"
-- and nothing more left a member typing the $1,416.00 line and the extractor
-- reading the $1,850.00 total, only one of them right.

comment on column public.payslip.tax_withheld_cents is
  'Total tax withheld for the period — the slip''s tax total, PAYG income tax plus any STSL study-loan component, not the PAYG line alone. The tax estimate''s liability includes the compulsory HELP repayment the STSL pays, so only the total nets against it. Zero when nothing was withheld.';

comment on column public.payslip.ytd_tax_withheld_cents is
  'Year-to-date total tax withheld as printed on the slip, on the same basis as tax_withheld_cents (PAYG plus any STSL component); null when not entered.';
