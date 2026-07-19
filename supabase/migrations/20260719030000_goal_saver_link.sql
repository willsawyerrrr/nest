-- Link a savings goal to an Up saver account.
--
-- A goal may point at one of the household's accounts (in practice a synced Up
-- saver); when set, its current balance is read from that account's synced
-- `balance_cents` instead of the manually entered `current_balance_cents`. The
-- link is nullable, and the composite foreign key on (id, household_id) keeps it
-- within the same household — the same cross-household guard the budget-line →
-- goal link already uses. Deleting the account clears the link.

alter table public.savings_goal
  add column linked_account_id uuid,
  add constraint savings_goal_linked_account_id_household_id_fkey
    foreign key (linked_account_id, household_id)
    references public.accounts (id, household_id) on delete set null (linked_account_id);

comment on column public.savings_goal.linked_account_id is 'Optional account (a synced Up saver) whose balance_cents supplies this goal''s current balance; null when the balance is entered manually.';
