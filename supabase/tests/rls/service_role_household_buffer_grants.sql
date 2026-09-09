-- Assertions for the service_role grants the household-buffer loader needs.
--
-- `_shared/householdBuffer/bundle.ts` (`loadBudgetSummaryBundle`) runs on a
-- service-role client in both `notify-eval` and `intent-summary` and reads the
-- breakdown and gift tables to re-derive budget-line amounts. service_role must
-- be able to select each of them — and only select, never write — while the
-- household's own `authenticated` management grants stay intact.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

do $$
declare
  t text;
begin
  foreach t in array array[
    'breakdown', 'breakdown_item', 'gift_budget', 'gift_recipient',
    'gift_discretionary_budget'
  ] loop
    assert has_table_privilege('service_role', 'public.' || t, 'select'),
      format('service_role should select public.%s (the household-buffer loader reads it)', t);
    assert not has_table_privilege('service_role', 'public.' || t, 'insert'),
      format('service_role must not insert public.%s', t);
    assert not has_table_privilege('service_role', 'public.' || t, 'update'),
      format('service_role must not update public.%s', t);
    assert not has_table_privilege('service_role', 'public.' || t, 'delete'),
      format('service_role must not delete public.%s', t);
    assert has_table_privilege('authenticated', 'public.' || t, 'select'),
      format('authenticated should still select public.%s', t);
    assert has_table_privilege('authenticated', 'public.' || t, 'delete'),
      format('authenticated should still manage public.%s', t);
  end loop;
end $$;

rollback;
