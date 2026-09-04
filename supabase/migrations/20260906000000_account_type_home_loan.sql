-- A home-loan account synced from Up is a net-worth liability, not just another
-- "other" account, so the account type enum gains a value of its own. A newly
-- added enum value cannot be referenced in the same transaction that adds it, so
-- the `account_directory` view that filters on it is recreated in the following
-- migration.

alter type public.account_type add value if not exists 'home_loan';
