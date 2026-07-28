-- Whether an inflow is ordinary time earnings, the base employer super accrues on.
--
-- Salary and wages are ordinary time earnings (OTE). An allowance paid on top —
-- an on-call or standby payment, say — is assessable income the employer
-- withholds tax from, but no super guarantee accrues on it. The flag drives the
-- super side alone: a payslip's expected employer super is charged on the slip's
-- gross less every line drawing on an inflow that earns no super, and the annual
-- SG and percent-of-salary bases exclude those inflows too. Taxability is
-- untouched — a non-OTE inflow is still taxed in full.

alter table public.inflows
  add column attracts_super boolean not null default true;

comment on column public.inflows.attracts_super is 'Whether the inflow is ordinary time earnings the employer super guarantee accrues on; false for an allowance (e.g. on-call) that is taxed but earns no super.';
