-- Reword deduction_group's comments to say what it actually covers.
--
-- A group is not only a recurring subscription: a one-off trip claimed across
-- several receipts groups the same way, each payment its own deduction, the
-- group only a name and a total over them. The column comments said
-- "recurring" and "subscription" throughout, which reads as a scope the table
-- never enforced — nothing here requires a cadence, only more than one payment.

comment on table public.deduction_group is 'A named set of a member''s deductions for one financial year — the many payments of one expense claimed more than once, totalled for display. Grouping is presentational: each deduction underneath is claimed in its own right.';
comment on column public.deduction_group.name is 'What this group of deductions is called, e.g. "Adobe Creative Cloud" or "Bali conference trip"; shown on the collapsed group row.';
comment on column public.deduction_group.financial_year is 'AU financial year the group''s payments are claimed in, labelled by the ending year. An expense whose payments span 30 June is one group per year.';
