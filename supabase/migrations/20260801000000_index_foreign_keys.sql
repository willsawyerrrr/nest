-- Index the foreign keys the schema declares that lack a supporting index.
--
-- Every table carries composite (id, household_id) uniqueness and RLS keyed on
-- household_id, so each foreign key is indexed on its own composite
-- (fk_col, household_id): the leading fk_col serves cascade deletes and joins
-- across the reference, while the trailing household_id keeps the index aligned
-- with the tenancy boundary. households has no household_id, so its lone foreign
-- key is indexed on the column alone.

create index on public.households (pay_account_id);
create index on public.categories (parent_id, household_id);
create index on public.accounts (owner_member_id, household_id);
create index on public.transactions (member_id, household_id);
create index on public.savings_goal (linked_account_id, household_id);
create index on public.budget_line (goal_id, household_id);
create index on public.budget_line (destination_account_id, household_id);
create index on public.budget_line (breakdown_id, household_id);
create index on public.super_profile (linked_account_id, household_id);
create index on public.super_contribution (contributor_member_id, household_id);
create index on public.gift_recipient (member_id, household_id);
create index on public.gift_budget (occasion_id, household_id);
create index on public.breakdown_item (breakdown_id, household_id);
create index on public.equity_grant (member_id, household_id);
create index on public.pay_split (account_id, household_id);
