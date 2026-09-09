-- Assertions that service_role has NO access to the breakdown and gift tables.
--
-- The household-buffer loader (`_shared/householdBuffer.ts`, used by `notify-eval`
-- and `intent-summary`) reads `budget_line` straight — the reconcile triggers
-- keep the breakdown- and gift-derived lines canonical — so it never touches
-- `breakdown`, `breakdown_item`, `gift_budget`, `gift_recipient`, or
-- `gift_discretionary_budget`. service_role must not be able to either: a future
-- read path that needs one adds its grant deliberately.
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
    assert not has_table_privilege('service_role', 'public.' || t, 'select'),
      format('service_role must not select public.%s (the buffer reads budget_line straight)', t);
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
