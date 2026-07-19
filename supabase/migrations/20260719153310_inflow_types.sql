-- Inflow types: broaden the non-taxable set beyond reimbursement so a non-taxable
-- inflow can be labelled by its kind (hobby income, gift). These are reporting
-- labels only; taxability, not type, decides whether an inflow is taxed. New enum
-- values can't be referenced by DDL in the transaction that adds them, so this
-- migration only extends the enum.

alter type public.inflow_type add value if not exists 'hobby';
alter type public.inflow_type add value if not exists 'gift';

comment on column public.inflows.amount_cents is 'Gross amount per frequency period, for every type except wage.';
