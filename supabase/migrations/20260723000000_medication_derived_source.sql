-- Medication as a second derived-budget source.
--
-- Adds the `medication` value to the `budget_derived_source` enum so a budget
-- line's amount can be rolled up from the medication tracker (the planned second
-- consumer, after gifts). Postgres forbids using a newly added enum value in the
-- same transaction that adds it, and Supabase runs each migration file in its own
-- transaction, so the value is added here alone; the `medication` table and the
-- lines that reference the value land in a later migration.
alter type public.budget_derived_source add value 'medication';
