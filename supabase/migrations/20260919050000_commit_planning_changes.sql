-- Applies a planning-mode sandbox's held edits to the real inflows, budget_line,
-- and savings_goal tables in one transaction, so a save either lands every held
-- create/update/delete across all three tables or none of it does. Without this,
-- committing the three tables as separate PostgREST calls could land some and
-- fail others, leaving the household's real data and its still-active sandbox
-- disagreeing about what was actually saved.
--
-- SECURITY INVOKER (the default): the caller is the PWA under its own JWT, so the
-- household policies on each table gate every statement here exactly as they gate
-- a direct write. Nothing is elevated; the transaction is the only thing bought.
--
-- An update patch is a JSON object keyed by row id, each value itself an object
-- of only the columns that row's edit touched — the same shape the client holds
-- in its sandbox. A column absent from a patch is left exactly as stored; the
-- `patch ? 'column'` checks below are what make that distinction, since a plain
-- `coalesce` cannot tell an absent key from one explicitly set to JSON null.

create function public.commit_planning_changes(
  p_inflow_creates jsonb default '[]'::jsonb,
  p_inflow_updates jsonb default '{}'::jsonb,
  p_inflow_deletes uuid[] default '{}',
  p_budget_line_creates jsonb default '[]'::jsonb,
  p_budget_line_updates jsonb default '{}'::jsonb,
  p_budget_line_deletes uuid[] default '{}',
  p_savings_goal_creates jsonb default '[]'::jsonb,
  p_savings_goal_updates jsonb default '{}'::jsonb,
  p_savings_goal_deletes uuid[] default '{}'
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  -- Inflows -------------------------------------------------------------

  insert into public.inflows (
    id, household_id, member_id, name, type, schedule, amount_cents,
    hourly_rate_cents, hours_per_period, taxable, interval_count, starts_on,
    ends_on, attracts_super, pay_schedule, pay_interval_count,
    arrives_every_pay_period, paid_on, one_off_tax_treatment, years_of_service,
    is_joint, member_split_percent, pay_anchor_date
  )
  select
    (row_data ->> 'id')::uuid,
    (row_data ->> 'household_id')::uuid,
    nullif(row_data ->> 'member_id', '')::uuid,
    row_data ->> 'name',
    (row_data ->> 'type')::public.inflow_type,
    nullif(row_data ->> 'schedule', '')::public.frequency,
    nullif(row_data ->> 'amount_cents', '')::bigint,
    nullif(row_data ->> 'hourly_rate_cents', '')::bigint,
    nullif(row_data ->> 'hours_per_period', '')::numeric,
    coalesce((row_data ->> 'taxable')::boolean, true),
    nullif(row_data ->> 'interval_count', '')::integer,
    nullif(row_data ->> 'starts_on', '')::date,
    nullif(row_data ->> 'ends_on', '')::date,
    coalesce((row_data ->> 'attracts_super')::boolean, true),
    nullif(row_data ->> 'pay_schedule', '')::public.frequency,
    nullif(row_data ->> 'pay_interval_count', '')::integer,
    coalesce((row_data ->> 'arrives_every_pay_period')::boolean, true),
    nullif(row_data ->> 'paid_on', '')::date,
    nullif(row_data ->> 'one_off_tax_treatment', '')::public.one_off_tax_treatment,
    nullif(row_data ->> 'years_of_service', '')::integer,
    coalesce((row_data ->> 'is_joint')::boolean, false),
    nullif(row_data ->> 'member_split_percent', '')::integer,
    nullif(row_data ->> 'pay_anchor_date', '')::date
  from jsonb_array_elements(p_inflow_creates) as row_data;

  update public.inflows i set
    member_id = case when patch ? 'member_id'
      then nullif(patch ->> 'member_id', '')::uuid else i.member_id end,
    name = case when patch ? 'name' then patch ->> 'name' else i.name end,
    type = case when patch ? 'type'
      then (patch ->> 'type')::public.inflow_type else i.type end,
    schedule = case when patch ? 'schedule'
      then nullif(patch ->> 'schedule', '')::public.frequency else i.schedule end,
    amount_cents = case when patch ? 'amount_cents'
      then nullif(patch ->> 'amount_cents', '')::bigint else i.amount_cents end,
    hourly_rate_cents = case when patch ? 'hourly_rate_cents'
      then nullif(patch ->> 'hourly_rate_cents', '')::bigint else i.hourly_rate_cents end,
    hours_per_period = case when patch ? 'hours_per_period'
      then nullif(patch ->> 'hours_per_period', '')::numeric else i.hours_per_period end,
    taxable = case when patch ? 'taxable'
      then (patch ->> 'taxable')::boolean else i.taxable end,
    interval_count = case when patch ? 'interval_count'
      then nullif(patch ->> 'interval_count', '')::integer else i.interval_count end,
    starts_on = case when patch ? 'starts_on'
      then nullif(patch ->> 'starts_on', '')::date else i.starts_on end,
    ends_on = case when patch ? 'ends_on'
      then nullif(patch ->> 'ends_on', '')::date else i.ends_on end,
    attracts_super = case when patch ? 'attracts_super'
      then (patch ->> 'attracts_super')::boolean else i.attracts_super end,
    pay_schedule = case when patch ? 'pay_schedule'
      then nullif(patch ->> 'pay_schedule', '')::public.frequency else i.pay_schedule end,
    pay_interval_count = case when patch ? 'pay_interval_count'
      then nullif(patch ->> 'pay_interval_count', '')::integer else i.pay_interval_count end,
    arrives_every_pay_period = case when patch ? 'arrives_every_pay_period'
      then (patch ->> 'arrives_every_pay_period')::boolean else i.arrives_every_pay_period end,
    paid_on = case when patch ? 'paid_on'
      then nullif(patch ->> 'paid_on', '')::date else i.paid_on end,
    one_off_tax_treatment = case when patch ? 'one_off_tax_treatment'
      then nullif(patch ->> 'one_off_tax_treatment', '')::public.one_off_tax_treatment
      else i.one_off_tax_treatment end,
    years_of_service = case when patch ? 'years_of_service'
      then nullif(patch ->> 'years_of_service', '')::integer else i.years_of_service end,
    is_joint = case when patch ? 'is_joint'
      then (patch ->> 'is_joint')::boolean else i.is_joint end,
    member_split_percent = case when patch ? 'member_split_percent'
      then nullif(patch ->> 'member_split_percent', '')::integer else i.member_split_percent end,
    pay_anchor_date = case when patch ? 'pay_anchor_date'
      then nullif(patch ->> 'pay_anchor_date', '')::date else i.pay_anchor_date end
  from jsonb_each(p_inflow_updates) as u(row_id, patch)
  where i.id = u.row_id::uuid;

  delete from public.inflows where id = any(p_inflow_deletes);

  -- Budget lines ----------------------------------------------------------
  -- Planning mode never sandboxes a derived line (breakdown_id set or
  -- is_gift_line true) — the client disables editing those while active — but
  -- nothing here depends on that; a patch or create simply carries whatever
  -- columns the client sent.

  insert into public.budget_line (
    id, household_id, line_group, name, amount_cents, frequency, goal_id,
    interval_count, destination_account_id, breakdown_id,
    gift_recipient_member_id, is_gift_line
  )
  select
    (row_data ->> 'id')::uuid,
    (row_data ->> 'household_id')::uuid,
    (row_data ->> 'line_group')::public.budget_group,
    row_data ->> 'name',
    (row_data ->> 'amount_cents')::bigint,
    (row_data ->> 'frequency')::public.frequency,
    nullif(row_data ->> 'goal_id', '')::uuid,
    nullif(row_data ->> 'interval_count', '')::integer,
    nullif(row_data ->> 'destination_account_id', '')::uuid,
    nullif(row_data ->> 'breakdown_id', '')::uuid,
    nullif(row_data ->> 'gift_recipient_member_id', '')::uuid,
    coalesce((row_data ->> 'is_gift_line')::boolean, false)
  from jsonb_array_elements(p_budget_line_creates) as row_data;

  update public.budget_line b set
    line_group = case when patch ? 'line_group'
      then (patch ->> 'line_group')::public.budget_group else b.line_group end,
    name = case when patch ? 'name' then patch ->> 'name' else b.name end,
    amount_cents = case when patch ? 'amount_cents'
      then nullif(patch ->> 'amount_cents', '')::bigint else b.amount_cents end,
    frequency = case when patch ? 'frequency'
      then (patch ->> 'frequency')::public.frequency else b.frequency end,
    goal_id = case when patch ? 'goal_id'
      then nullif(patch ->> 'goal_id', '')::uuid else b.goal_id end,
    interval_count = case when patch ? 'interval_count'
      then nullif(patch ->> 'interval_count', '')::integer else b.interval_count end,
    destination_account_id = case when patch ? 'destination_account_id'
      then nullif(patch ->> 'destination_account_id', '')::uuid else b.destination_account_id end,
    breakdown_id = case when patch ? 'breakdown_id'
      then nullif(patch ->> 'breakdown_id', '')::uuid else b.breakdown_id end,
    gift_recipient_member_id = case when patch ? 'gift_recipient_member_id'
      then nullif(patch ->> 'gift_recipient_member_id', '')::uuid else b.gift_recipient_member_id end,
    is_gift_line = case when patch ? 'is_gift_line'
      then (patch ->> 'is_gift_line')::boolean else b.is_gift_line end
  from jsonb_each(p_budget_line_updates) as u(row_id, patch)
  where b.id = u.row_id::uuid;

  delete from public.budget_line where id = any(p_budget_line_deletes);

  -- Savings goals -----------------------------------------------------------

  insert into public.savings_goal (
    id, household_id, name, target_amount_cents, target_date,
    current_balance_cents, linked_account_id, annual_interest_bps,
    queue_position, planned_contribution_cents
  )
  select
    (row_data ->> 'id')::uuid,
    (row_data ->> 'household_id')::uuid,
    row_data ->> 'name',
    (row_data ->> 'target_amount_cents')::bigint,
    nullif(row_data ->> 'target_date', '')::date,
    coalesce((row_data ->> 'current_balance_cents')::bigint, 0),
    nullif(row_data ->> 'linked_account_id', '')::uuid,
    nullif(row_data ->> 'annual_interest_bps', '')::integer,
    nullif(row_data ->> 'queue_position', '')::integer,
    nullif(row_data ->> 'planned_contribution_cents', '')::bigint
  from jsonb_array_elements(p_savings_goal_creates) as row_data;

  update public.savings_goal g set
    name = case when patch ? 'name' then patch ->> 'name' else g.name end,
    target_amount_cents = case when patch ? 'target_amount_cents'
      then nullif(patch ->> 'target_amount_cents', '')::bigint else g.target_amount_cents end,
    target_date = case when patch ? 'target_date'
      then nullif(patch ->> 'target_date', '')::date else g.target_date end,
    current_balance_cents = case when patch ? 'current_balance_cents'
      then nullif(patch ->> 'current_balance_cents', '')::bigint else g.current_balance_cents end,
    linked_account_id = case when patch ? 'linked_account_id'
      then nullif(patch ->> 'linked_account_id', '')::uuid else g.linked_account_id end,
    annual_interest_bps = case when patch ? 'annual_interest_bps'
      then nullif(patch ->> 'annual_interest_bps', '')::integer else g.annual_interest_bps end,
    queue_position = case when patch ? 'queue_position'
      then nullif(patch ->> 'queue_position', '')::integer else g.queue_position end,
    planned_contribution_cents = case when patch ? 'planned_contribution_cents'
      then nullif(patch ->> 'planned_contribution_cents', '')::bigint else g.planned_contribution_cents end
  from jsonb_each(p_savings_goal_updates) as u(row_id, patch)
  where g.id = u.row_id::uuid;

  delete from public.savings_goal where id = any(p_savings_goal_deletes);
end;
$$;

comment on function public.commit_planning_changes(
  jsonb, jsonb, uuid[], jsonb, jsonb, uuid[], jsonb, jsonb, uuid[]
) is 'Applies a planning-mode sandbox''s held creates, updates, and deletes across inflows, budget_line, and savings_goal in a single transaction. Runs as the caller, so household RLS gates every statement.';

revoke execute on function public.commit_planning_changes(
  jsonb, jsonb, uuid[], jsonb, jsonb, uuid[], jsonb, jsonb, uuid[]
) from public;
grant execute on function public.commit_planning_changes(
  jsonb, jsonb, uuid[], jsonb, jsonb, uuid[], jsonb, jsonb, uuid[]
) to authenticated;
