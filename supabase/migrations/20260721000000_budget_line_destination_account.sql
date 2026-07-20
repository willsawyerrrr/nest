-- Route a budget line to the account or Up saver that funds it.
--
-- A non-Savings/Investments line points at exactly one account (in practice a
-- synced Up saver or the main transaction account); the Splits tab sums each
-- account's routed lines into the fortnightly pay split to configure in Up.
-- Savings/Investments lines carry no destination — they already fund a goal, and
-- the goal's linked_account_id supplies the route — so the check bars a
-- destination on those two groups, keeping one source of destination per line.
-- The composite foreign key on (id, household_id) keeps the reference within the
-- household, and deleting the account clears the link, mirroring goal_id and
-- savings_goal.linked_account_id.

alter table public.budget_line
  add column destination_account_id uuid,
  add constraint budget_line_destination_account_id_household_id_fkey
    foreign key (destination_account_id, household_id)
    references public.accounts (id, household_id) on delete set null (destination_account_id);

alter table public.budget_line add constraint budget_line_destination_group check (
  destination_account_id is null or line_group not in ('savings', 'investments')
);

comment on column public.budget_line.destination_account_id is 'Account (a synced Up saver or the transaction account) that funds this line; only non-Savings/Investments lines may set it, since those route via their goal''s linked account.';
