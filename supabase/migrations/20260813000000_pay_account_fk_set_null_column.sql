-- Deleting the designated pay account clears the designation and keeps the household.
--
-- households_pay_account_id_fkey is a composite reference on
-- (pay_account_id, id) → accounts (id, household_id), so its referencing columns
-- include households.id — the primary key. A set-null action without a column
-- list applies to every referencing column, which would null the primary key too
-- and abort the delete on a not-null violation. Naming pay_account_id, as every
-- other composite set-null foreign key here does, confines the action to the
-- designation: removing the account the household is paid into leaves the
-- household intact with no pay account designated.

alter table public.households
  drop constraint households_pay_account_id_fkey,
  add constraint households_pay_account_id_fkey
    foreign key (pay_account_id, id)
    references public.accounts (id, household_id) on delete set null (pay_account_id);
