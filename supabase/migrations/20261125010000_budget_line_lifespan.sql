-- Budget item lifespan: every item has a start date and an optional retirement
-- date, and the household default item is dated.
--
-- An item is active on the local days [starts_on, retired_on): `starts_on` is
-- its first day, `retired_on` (exclusive) the first day it no longer applies.
-- Spend counts toward an item only within its lifespan: a rule or suggestion
-- targeting it matches only transactions posted inside it (falling through to
-- the next rule otherwise), a member choice is refused outside it (an existing
-- choice keeps pointing at the item), and the default in force at a
-- transaction's posting resolves to Not budgeted on a day its item is inactive.
--
-- Retiring is one-way (`retire_budget_line`): a retired item never returns, its
-- rules stop at its retirement, and its past spend keeps counting toward it. An
-- item with counted spend can only be retired; one with none can be deleted.
-- `change_budget_line_from` retires an item on a date and starts a replacement
-- that carries its rules. Derived items (breakdown and gift lines) are owned by
-- the reconcile and are neither retired nor guarded on delete.

-- ── Helpers ────────────────────────────────────────────────────────────────────

-- Today in the household's timezone.
create function public.household_today(p_household_id uuid)
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone h.timezone)::date from public.households h where h.id = p_household_id;
$$;

-- The instant a local day starts in the household's timezone.
create function public.household_day_start(p_household_id uuid, p_day date)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select p_day::timestamp at time zone h.timezone from public.households h where h.id = p_household_id;
$$;

revoke execute on function public.household_today(uuid) from public;
revoke execute on function public.household_day_start(uuid, date) from public;

-- ── budget_line.starts_on / retired_on ─────────────────────────────────────────

alter table public.budget_line
  add column starts_on date,
  add column retired_on date;

-- Existing items start on the earlier of the day they were created and the
-- household's earliest transaction, so every transaction already synced stays
-- inside the lifespan of the items it counted toward.
update public.budget_line b
  set starts_on = least(
    (b.created_at at time zone h.timezone)::date,
    coalesce(
      (select min((t.posted_at at time zone h.timezone)::date) from public.transactions t where t.household_id = b.household_id),
      (b.created_at at time zone h.timezone)::date
    )
  )
  from public.households h
  where h.id = b.household_id;

alter table public.budget_line
  alter column starts_on set not null,
  add constraint budget_line_lifespan check (retired_on is null or retired_on > starts_on);

comment on column public.budget_line.starts_on is 'The first local day (household timezone) the item applies: it is in the plan and counts spend from this day. Defaults to today on insert; may be backdated or in the future.';
comment on column public.budget_line.retired_on is 'The first local day the item no longer applies (exclusive end), set once by retire_budget_line and never cleared; null while it is live. A retired item keeps the spend counted toward it before this day.';

-- A new item starts today in its household unless the write says otherwise:
-- the column default reads the caller's household, and the trigger covers a
-- write with no caller household (service role).
create function public.caller_household_today()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select public.household_today(hid) from public.household_ids_for_current_user() as hid limit 1;
$$;

revoke execute on function public.caller_household_today() from public;
grant execute on function public.caller_household_today() to authenticated, service_role;

alter table public.budget_line alter column starts_on set default public.caller_household_today();

create function public.default_budget_line_starts_on()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.starts_on is null then
    new.starts_on := public.household_today(new.household_id);
  end if;
  return new;
end;
$$;

create trigger default_budget_line_starts_on
  before insert on public.budget_line
  for each row execute function public.default_budget_line_starts_on();

-- `retired_on` is written only by retire_budget_line (which flags the
-- transaction) and is then fixed.
create function public.guard_budget_line_retired_on()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' and new.retired_on is not null)
    or (tg_op = 'UPDATE' and new.retired_on is distinct from old.retired_on
      and (old.retired_on is not null
        or coalesce(current_setting('nest.retiring_budget_line', true), '') <> new.id::text))
  then
    raise exception 'budget_line_retired_on_immutable' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger guard_budget_line_retired_on
  before insert or update of retired_on on public.budget_line
  for each row execute function public.guard_budget_line_retired_on();

revoke execute on function public.default_budget_line_starts_on() from public;
revoke execute on function public.guard_budget_line_retired_on() from public;

-- ── Allowance overdraw counts live items only ─────────────────────────────────

create or replace function public.prevent_allowance_overdraw_by_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowance bigint;
  v_drawn bigint;
  v_annual bigint :=
    public.reconcile_annual_cents(new.amount_cents, new.frequency, new.interval_count);
begin
  if new.retired_on is not null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.allowance_member_id is not distinct from new.allowance_member_id
     and v_annual <= public.reconcile_annual_cents(old.amount_cents, old.frequency, old.interval_count) then
    return new;
  end if;

  select public.reconcile_annual_cents(a.amount_cents, a.frequency, a.interval_count)
    into v_allowance
    from public.member_allowance a
    where a.member_id = new.allowance_member_id and a.household_id = new.household_id
    for update;
  if not found then
    return new;
  end if;

  select coalesce(sum(public.reconcile_annual_cents(b.amount_cents, b.frequency, b.interval_count)), 0)
    into v_drawn
    from public.budget_line b
    where b.allowance_member_id = new.allowance_member_id
      and b.household_id = new.household_id
      and b.retired_on is null
      and b.id <> new.id;

  if v_drawn + v_annual > coalesce(v_allowance, 0) then
    raise exception 'allowance_overdrawn' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
comment on function public.prevent_allowance_overdraw_by_line() is 'Rejects drawing a live budget line from an allowance when the annualised total drawn by its live lines would exceed the allowance.';

create or replace function public.prevent_allowance_overdraw_by_allowance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_drawn bigint;
begin
  select coalesce(sum(public.reconcile_annual_cents(b.amount_cents, b.frequency, b.interval_count)), 0)
    into v_drawn
    from public.budget_line b
    where b.allowance_member_id = new.member_id
      and b.household_id = new.household_id
      and b.retired_on is null;

  if v_drawn > public.reconcile_annual_cents(new.amount_cents, new.frequency, new.interval_count) then
    raise exception 'allowance_overdrawn' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
comment on function public.prevent_allowance_overdraw_by_allowance() is 'Rejects lowering an allowance below the annualised total its live lines already draw.';

-- ── household_default_budget_line: the default item over time ──────────────────
--
-- Each row names the default item from its local day `valid_from` until the
-- next row's; a null item is Not budgeted. Uncaught spend resolves to the row
-- in force on its local posting day.

create table public.household_default_budget_line (
  household_id uuid not null references public.households on delete cascade,
  valid_from date not null,
  budget_line_id uuid,
  created_at timestamptz not null default now(),
  primary key (household_id, valid_from),
  foreign key (budget_line_id, household_id)
    references public.budget_line (id, household_id) on delete set null (budget_line_id)
);
create index on public.household_default_budget_line (budget_line_id, household_id);

comment on table public.household_default_budget_line is 'The household default item over time: from local day valid_from until the next row, uncaught spend not from a member''s own account counts toward budget_line_id (null: Not budgeted). Written through set_household_default_budget_line and retire_budget_line.';

insert into public.household_default_budget_line (household_id, valid_from, budget_line_id)
  select h.id, b.starts_on, b.id
  from public.households h
  join public.budget_line b on b.id = h.default_budget_line_id;

alter table public.households drop column default_budget_line_id;

alter table public.household_default_budget_line enable row level security;

create policy "household members read the default item history" on public.household_default_budget_line
  for select to authenticated
  using (household_id in (select public.household_ids_for_current_user()));

revoke all on public.household_default_budget_line from anon, authenticated, service_role;
grant select on public.household_default_budget_line to authenticated;

-- The default row in force on a local day.
create function public.household_default_budget_line_on(p_household_id uuid, p_day date)
returns uuid
language sql
stable
set search_path = ''
as $$
  select d.budget_line_id
  from public.household_default_budget_line d
  where d.household_id = p_household_id and d.valid_from <= p_day
  order by d.valid_from desc
  limit 1;
$$;

revoke execute on function public.household_default_budget_line_on(uuid, date) from public;

-- Replaces the default from local day `p_from` on: rows from that day are
-- superseded and `p_budget_line_id` (null: Not budgeted) takes over.
create function public.write_household_default_budget_line(
  p_household_id uuid,
  p_from date,
  p_budget_line_id uuid
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_budget_line_id is not null and not exists (
    select 1 from public.budget_line b
    where b.id = p_budget_line_id
      and b.household_id = p_household_id
      and b.allowance_member_id is null
      and b.starts_on <= p_from
      and b.retired_on is null
  ) then
    raise exception 'default_budget_line_invalid' using errcode = 'check_violation';
  end if;

  delete from public.household_default_budget_line d
    where d.household_id = p_household_id and d.valid_from >= p_from;

  insert into public.household_default_budget_line (household_id, valid_from, budget_line_id)
    values (p_household_id, p_from, p_budget_line_id);
end;
$$;

revoke execute on function public.write_household_default_budget_line(uuid, date, uuid) from public;

drop function public.set_household_default_budget_line(uuid);

create function public.set_household_default_budget_line(p_budget_line_id uuid, p_from date default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
begin
  select hid into v_household_id
    from public.household_ids_for_current_user() as hid
    limit 1;

  if v_household_id is null then
    raise exception 'caller has no household';
  end if;

  perform public.write_household_default_budget_line(
    v_household_id, coalesce(p_from, public.household_today(v_household_id)), p_budget_line_id);
end;
$$;

comment on function public.set_household_default_budget_line(uuid, date) is 'Sets (or, with null, clears) the caller''s household default item from local day p_from (default today) on, superseding any later change: a live budget line of the household, not drawn from an allowance, started by p_from. Raises default_budget_line_invalid.';

revoke execute on function public.set_household_default_budget_line(uuid, date) from public;
grant execute on function public.set_household_default_budget_line(uuid, date) to authenticated;

-- ── Targets must be live ───────────────────────────────────────────────────────

-- Refuses a budget line that is retired on `p_on` (or, with `p_require_started`,
-- not yet started on it).
create function public.assert_budget_line_active(
  p_budget_line_id uuid,
  p_on date,
  p_require_started boolean
)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.budget_line b
    where b.id = p_budget_line_id
      and ((b.retired_on is not null and p_on >= b.retired_on)
        or (p_require_started and p_on < b.starts_on))
  ) then
    raise exception 'spend_target_inactive' using errcode = 'check_violation';
  end if;
end;
$$;

revoke execute on function public.assert_budget_line_active(uuid, date, boolean) from public;

create or replace function public.set_transaction_spend_target(
  p_transaction_id uuid,
  p_target_kind public.spend_target_kind,
  p_budget_line_id uuid default null,
  p_allowance_member_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx public.transactions;
begin
  select t.* into v_tx
    from public.transactions t
    where t.id = p_transaction_id
      and t.household_id in (select public.household_ids_for_current_user())
      and t.account_id in (select public.visible_balance_account_ids())
      and t.id not in (select public.hidden_gift_transaction_ids_for_current_member());

  if not found then
    raise exception 'transaction not found' using errcode = 'no_data_found';
  end if;

  if v_tx.kind = 'transfer' or (v_tx.external_category is null and v_tx.kind <> 'expense') then
    raise exception 'transaction_not_spend' using errcode = 'check_violation';
  end if;

  perform public.assert_spend_target(v_tx.household_id, p_target_kind, p_budget_line_id, p_allowance_member_id);
  if p_target_kind = 'budget_line' then
    perform public.assert_budget_line_active(
      p_budget_line_id,
      (v_tx.posted_at at time zone (select h.timezone from public.households h where h.id = v_tx.household_id))::date,
      true);
  end if;

  delete from public.transaction_allocation a where a.transaction_id = v_tx.id;

  insert into public.transaction_allocation (
    household_id, transaction_id, target_kind, budget_line_id, allowance_member_id,
    amount_cents, origin, member_id
  ) values (
    v_tx.household_id, v_tx.id, p_target_kind, p_budget_line_id, p_allowance_member_id,
    -v_tx.amount_cents, 'member_choice',
    (select m.id from public.members m where m.household_id = v_tx.household_id and m.user_id = (select auth.uid()))
  );
end;
$$;

comment on function public.set_transaction_spend_target(uuid, public.spend_target_kind, uuid, uuid) is 'Sends the whole of a spend transaction the caller can see to a target (a budget line, the caller''s own allowance, or Not budgeted) as their choice, replacing any choice or suggestion. Raises no_data_found for a transaction the caller cannot see, transaction_not_spend for a transfer or uncategorised income, spend_target_invalid for a target they may not use, spend_target_inactive for a budget line not started or already retired on the transaction''s local posting day.';

create or replace function public.create_spend_rule(
  p_target_kind public.spend_target_kind,
  p_budget_line_id uuid default null,
  p_allowance_member_id uuid default null,
  p_description_pattern text default null,
  p_description_match public.spend_rule_text_match default 'contains',
  p_up_category_ids text[] default null,
  p_account_ids uuid[] default null,
  p_amount_cents bigint default null,
  p_amount_min_cents bigint default null,
  p_amount_max_cents bigint default null,
  p_text_pattern text default null,
  p_apply_from date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_rule_id uuid;
  v_sort_order integer;
  v_from timestamptz;
begin
  select hid into v_household_id
    from public.household_ids_for_current_user() as hid
    limit 1;

  if v_household_id is null then
    raise exception 'caller has no household';
  end if;

  perform public.assert_spend_target(v_household_id, p_target_kind, p_budget_line_id, p_allowance_member_id);
  v_from := public.spend_rule_effective_from(v_household_id, p_apply_from);
  if p_target_kind = 'budget_line' then
    perform public.assert_budget_line_active(
      p_budget_line_id,
      (v_from at time zone (select h.timezone from public.households h where h.id = v_household_id))::date,
      false);
  end if;

  select coalesce(max(v.sort_order), -1) + 1 into v_sort_order
    from public.spend_rule_version v where v.household_id = v_household_id;

  insert into public.spend_rule (household_id, target_kind, budget_line_id, allowance_member_id)
    values (v_household_id, p_target_kind, p_budget_line_id, p_allowance_member_id)
    returning id into v_rule_id;

  perform public.write_spend_rule_version(
    v_rule_id, v_from, v_sort_order,
    p_description_pattern, p_description_match, p_up_category_ids, p_account_ids,
    p_amount_cents, p_amount_min_cents, p_amount_max_cents, p_text_pattern
  );

  return v_rule_id;
end;
$$;

comment on function public.create_spend_rule(public.spend_target_kind, uuid, uuid, text, public.spend_rule_text_match, text[], uuid[], bigint, bigint, bigint, text, date) is 'Creates a spend rule at the end of the household''s order, in force from now or from the start of local day p_apply_from. A rule matches a budget line''s spend only within the line''s lifespan. Returns its id. Raises spend_target_invalid, spend_target_inactive (a line retired by then), spend_rule_condition_required, spend_rule_amount_invalid, spend_rule_account_invalid, or spend_rule_apply_from_future.';

-- ── spend_resolution, with lifespans and the dated default ─────────────────────
--
-- `household_spend_resolution` resolves one household's spend, unmasked, with
-- or without the caller's `transactions` visibility. It is granted to no role:
-- `spend_resolution` reads it for the caller, and the delete guard reads it
-- household-wide.

create function public.household_spend_resolution(
  p_household_id uuid,
  p_visible_only boolean,
  p_start date default null,
  p_end date default null,
  p_transaction_ids uuid[] default null
)
returns table (
  transaction_id uuid,
  posted_at timestamptz,
  status public.transaction_status,
  target_kind public.spend_target_kind,
  budget_line_id uuid,
  allowance_member_id uuid,
  amount_cents bigint,
  reason public.spend_resolution_reason,
  rule_id uuid,
  rule_version integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with spend as (
    select
      t.id, t.household_id, t.account_id, t.posted_at, t.status, -t.amount_cents as spend_cents,
      t.description, t.external_category, t.up_message, t.up_note, t.notes,
      a.owner_member_id, (t.posted_at at time zone h.timezone)::date as posted_on
    from public.transactions t
    join public.households h on h.id = t.household_id
    join public.accounts a on a.id = t.account_id
    where t.household_id = p_household_id
      and (not p_visible_only or (
        t.account_id in (select public.visible_balance_account_ids())
        and t.id not in (select public.hidden_gift_transaction_ids_for_current_member())
      ))
      and t.kind <> 'transfer'
      and (t.external_category is not null or t.kind = 'expense')
      and (p_start is null or (t.posted_at at time zone h.timezone)::date >= p_start)
      and (p_end is null or (t.posted_at at time zone h.timezone)::date <= p_end)
      and (p_transaction_ids is null or t.id = any(p_transaction_ids))
  )
  select
    s.id, s.posted_at, s.status, al.target_kind, al.budget_line_id, al.allowance_member_id, al.amount_cents,
    al.origin::text::public.spend_resolution_reason, null::uuid, null::integer
  from spend s
  join public.transaction_allocation al on al.transaction_id = s.id and al.origin <> 'suggestion'
  union all
  select s.id, s.posted_at, s.status, f.target_kind, f.budget_line_id, f.allowance_member_id, s.spend_cents,
    f.reason, f.rule_id, f.rule_version
  from spend s
  cross join lateral (
    select * from (
      (
        select r.target_kind, r.budget_line_id, r.allowance_member_id,
          'rule'::public.spend_resolution_reason as reason, v.rule_id, v.version as rule_version, 1 as layer
        from public.spend_rule_version v
        join public.spend_rule r on r.id = v.rule_id
        left join public.budget_line b on b.id = r.budget_line_id
        where v.household_id = s.household_id
          and v.valid_from <= s.posted_at
          and (v.valid_until is null or s.posted_at < v.valid_until)
          and (b.id is null or (b.starts_on <= s.posted_on and (b.retired_on is null or s.posted_on < b.retired_on)))
          and (v.description_pattern is null or case v.description_match
            when 'equals' then lower(btrim(s.description)) = lower(v.description_pattern)
            else strpos(lower(s.description), lower(v.description_pattern)) > 0
          end)
          and (v.up_category_ids is null or s.external_category = any(v.up_category_ids))
          and (v.account_ids is null or s.account_id = any(v.account_ids))
          and (v.amount_cents is null or abs(s.spend_cents) = v.amount_cents)
          and (v.amount_min_cents is null or abs(s.spend_cents) >= v.amount_min_cents)
          and (v.amount_max_cents is null or abs(s.spend_cents) <= v.amount_max_cents)
          and (v.text_pattern is null
            or strpos(lower(coalesce(s.up_message, '')), lower(v.text_pattern)) > 0
            or strpos(lower(coalesce(s.up_note, '')), lower(v.text_pattern)) > 0
            or strpos(lower(coalesce(s.notes, '')), lower(v.text_pattern)) > 0)
        order by v.sort_order, r.created_at, r.id
        limit 1
      )
      union all
      select al.target_kind, al.budget_line_id, al.allowance_member_id,
        'suggestion'::public.spend_resolution_reason, null, null, 2
      from public.transaction_allocation al
      left join public.budget_line b on b.id = al.budget_line_id
      where al.transaction_id = s.id and al.origin = 'suggestion'
        and (b.id is null or (b.starts_on <= s.posted_on and (b.retired_on is null or s.posted_on < b.retired_on)))
      union all
      select
        case
          when s.owner_member_id is not null then 'allowance'
          when d.budget_line_id is not null then 'budget_line'
          else 'not_budgeted'
        end::public.spend_target_kind,
        case when s.owner_member_id is null then d.budget_line_id end,
        s.owner_member_id,
        'default'::public.spend_resolution_reason, null, null, 3
      from (
        select b.id as budget_line_id
        from (select public.household_default_budget_line_on(s.household_id, s.posted_on) as id) as dl
        left join public.budget_line b on b.id = dl.id
          and b.starts_on <= s.posted_on and (b.retired_on is null or s.posted_on < b.retired_on)
      ) as d
    ) as candidate
    order by candidate.layer
    limit 1
  ) as f
  where not exists (
    select 1 from public.transaction_allocation al
    where al.transaction_id = s.id and al.origin <> 'suggestion'
  );
$$;

revoke execute on function public.household_spend_resolution(uuid, boolean, date, date, uuid[]) from public;

create or replace function public.spend_resolution(
  p_start date default null,
  p_end date default null,
  p_transaction_ids uuid[] default null
)
returns table (
  transaction_id uuid,
  posted_at timestamptz,
  status public.transaction_status,
  target_kind public.spend_target_kind,
  budget_line_id uuid,
  allowance_member_id uuid,
  amount_cents bigint,
  reason public.spend_resolution_reason,
  rule_id uuid,
  rule_version integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.transaction_id,
    r.posted_at,
    r.status,
    case when p.is_private then 'allowance'::public.spend_target_kind else r.target_kind end,
    case when p.is_private then null else r.budget_line_id end,
    case when p.is_private then o.owner_member_id else r.allowance_member_id end,
    r.amount_cents,
    r.reason,
    case when p.is_private then null else r.rule_id end,
    case when p.is_private then null else r.rule_version end
  from public.household_ids_for_current_user() as hid
  cross join lateral public.household_spend_resolution(hid, true, p_start, p_end, p_transaction_ids) as r
  left join public.budget_line b on b.id = r.budget_line_id
  cross join lateral (select coalesce(r.allowance_member_id, b.allowance_member_id) as owner_member_id) as o
  cross join lateral (
    select o.owner_member_id is not null
      and o.owner_member_id not in (select public.current_member_ids()) as is_private
  ) as p;
$$;

comment on function public.spend_resolution(date, date, uuid[]) is 'Where each spend transaction the caller can see counts, one row per allocation, and why: a member choice or confirmed suggestion, the rule and version that matched at its posting time, an unconfirmed suggestion, or the default in force on its local posting day. A rule, suggestion or default counts toward a budget line only within its lifespan. Optionally narrowed to local posting dates p_start..p_end and to p_transaction_ids. A target private to a co-member reads as their allowance, unnamed.';

-- ── Counted spend ──────────────────────────────────────────────────────────────

-- Whether any spend in the household has ever counted toward the line, by any
-- reason, whoever can see it.
create function public.budget_line_has_counted_spend(p_budget_line_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.transaction_allocation a where a.budget_line_id = p_budget_line_id
  ) or exists (
    select 1
    from public.budget_line b
    cross join lateral public.household_spend_resolution(
      b.household_id, false, b.starts_on, b.retired_on - 1) as r
    where b.id = p_budget_line_id and r.budget_line_id = p_budget_line_id
  );
$$;

revoke execute on function public.budget_line_has_counted_spend(uuid) from public;

create function public.budget_lines_with_counted_spend()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select b.id
  from public.budget_line b
  where b.household_id in (select public.household_ids_for_current_user())
    and (b.allowance_member_id is null or b.allowance_member_id in (select public.current_member_ids()))
    and public.budget_line_has_counted_spend(b.id);
$$;

comment on function public.budget_lines_with_counted_spend() is 'The caller''s visible budget lines that any spend in the household has ever counted toward (by member choice, rule, suggestion or default): these can be retired but not deleted.';

revoke execute on function public.budget_lines_with_counted_spend() from public;
grant execute on function public.budget_lines_with_counted_spend() to authenticated;

-- A manual item with counted spend is retired, never deleted, so its history
-- stays. Derived items are the reconcile's, and a household being deleted takes
-- its items with it.
create function public.prevent_budget_line_delete_with_spend()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.breakdown_id is null and not old.is_gift_line
    and exists (select 1 from public.households h where h.id = old.household_id)
    and public.budget_line_has_counted_spend(old.id)
  then
    raise exception 'budget_line_has_spend' using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

create trigger prevent_budget_line_delete_with_spend
  before delete on public.budget_line
  for each row execute function public.prevent_budget_line_delete_with_spend();

revoke execute on function public.prevent_budget_line_delete_with_spend() from public;

-- ── Retiring ───────────────────────────────────────────────────────────────────

-- Retires `p_line` from local day `p_on`: its rules' versions end at the start
-- of that day (rules left with none are removed) and `retired_on` is set. The
-- caller has checked the line and the default.
create function public.write_budget_line_retirement(p_line public.budget_line, p_on date)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_at timestamptz := public.household_day_start(p_line.household_id, p_on);
begin
  delete from public.spend_rule_version v
    using public.spend_rule r
    where r.id = v.rule_id and r.budget_line_id = p_line.id and v.valid_from >= v_at;

  update public.spend_rule_version v
    set valid_until = v_at
    from public.spend_rule r
    where r.id = v.rule_id and r.budget_line_id = p_line.id
      and (v.valid_until is null or v.valid_until > v_at);

  delete from public.spend_rule r
    where r.budget_line_id = p_line.id
      and not exists (select 1 from public.spend_rule_version v where v.rule_id = r.id);

  perform set_config('nest.retiring_budget_line', p_line.id::text, true);
  update public.budget_line set retired_on = p_on where id = p_line.id;
  perform set_config('nest.retiring_budget_line', '', true);
end;
$$;

revoke execute on function public.write_budget_line_retirement(public.budget_line, date) from public;

-- The manual, live line `p_budget_line_id` the caller may manage, for retiring
-- from local day `p_on` (after its start).
create function public.retirable_budget_line(p_budget_line_id uuid, p_on date)
returns public.budget_line
language plpgsql
stable
set search_path = ''
as $$
declare
  v_line public.budget_line;
begin
  select b.* into v_line
    from public.budget_line b
    where b.id = p_budget_line_id
      and b.household_id in (select public.household_ids_for_current_user())
      and (b.allowance_member_id is null or b.allowance_member_id in (select public.current_member_ids()));

  if not found then
    raise exception 'budget_line_not_found' using errcode = 'no_data_found';
  end if;
  if v_line.breakdown_id is not null or v_line.is_gift_line then
    raise exception 'budget_line_derived' using errcode = 'check_violation';
  end if;
  if v_line.retired_on is not null then
    raise exception 'budget_line_retired' using errcode = 'check_violation';
  end if;
  if p_on <= v_line.starts_on then
    raise exception 'budget_line_retire_before_start' using errcode = 'check_violation';
  end if;

  return v_line;
end;
$$;

revoke execute on function public.retirable_budget_line(uuid, date) from public;

-- Whether the line is the household default on local day `p_on` or after it.
create function public.is_default_budget_line_from(p_line public.budget_line, p_on date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.household_default_budget_line_on(p_line.household_id, p_on) is not distinct from p_line.id
    or exists (
      select 1 from public.household_default_budget_line d
      where d.household_id = p_line.household_id and d.valid_from > p_on and d.budget_line_id = p_line.id
    );
$$;

revoke execute on function public.is_default_budget_line_from(public.budget_line, date) from public;

create function public.retire_budget_line(
  p_budget_line_id uuid,
  p_retire_on date default null,
  p_new_default_budget_line_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_on date;
  v_line public.budget_line;
begin
  select b.household_id into v_household_id from public.budget_line b where b.id = p_budget_line_id;
  v_on := coalesce(p_retire_on, public.household_today(v_household_id));
  v_line := public.retirable_budget_line(p_budget_line_id, v_on);

  if public.is_default_budget_line_from(v_line, v_on) then
    if p_new_default_budget_line_id is null then
      raise exception 'budget_line_default_replacement_required' using errcode = 'check_violation';
    end if;
    if p_new_default_budget_line_id = v_line.id then
      raise exception 'default_budget_line_invalid' using errcode = 'check_violation';
    end if;
    perform public.write_household_default_budget_line(v_line.household_id, v_on, p_new_default_budget_line_id);
  end if;

  perform public.write_budget_line_retirement(v_line, v_on);
end;
$$;

comment on function public.retire_budget_line(uuid, date, uuid) is 'Stops budgeting for a manual budget line the caller can manage from local day p_retire_on (default today), after its start: it leaves the plan from that day, its rules stop there, and spend already counted toward it stays. Retiring the household default needs p_new_default_budget_line_id, the default from that day. Raises budget_line_not_found, budget_line_derived, budget_line_retired, budget_line_retire_before_start, budget_line_default_replacement_required, default_budget_line_invalid.';

revoke execute on function public.retire_budget_line(uuid, date, uuid) from public;
grant execute on function public.retire_budget_line(uuid, date, uuid) to authenticated;

-- ── Change from a date ─────────────────────────────────────────────────────────

create function public.change_budget_line_from(
  p_budget_line_id uuid,
  p_change_on date,
  p_line_group public.budget_group,
  p_name text,
  p_amount_cents bigint,
  p_frequency public.frequency,
  p_interval_count integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_on date;
  v_at timestamptz;
  v_line public.budget_line;
  v_is_default boolean;
  v_rules jsonb;
  v_rule record;
  v_new_id uuid;
  v_new_rule_id uuid;
begin
  select b.household_id into v_household_id from public.budget_line b where b.id = p_budget_line_id;
  v_on := coalesce(p_change_on, public.household_today(v_household_id));
  v_line := public.retirable_budget_line(p_budget_line_id, v_on);
  v_at := public.household_day_start(v_line.household_id, v_on);
  v_is_default := public.is_default_budget_line_from(v_line, v_on);

  -- Each live rule's current conditions, in force on the replacement from the
  -- change (or from a later start of its own).
  select coalesce(jsonb_agg(jsonb_build_object(
      'valid_from', greatest(v.valid_from, v_at), 'sort_order', v.sort_order,
      'description_pattern', v.description_pattern, 'description_match', v.description_match,
      'up_category_ids', v.up_category_ids, 'account_ids', v.account_ids,
      'amount_cents', v.amount_cents, 'amount_min_cents', v.amount_min_cents,
      'amount_max_cents', v.amount_max_cents, 'text_pattern', v.text_pattern
    ) order by v.sort_order, r.created_at, r.id), '[]')
    into v_rules
    from public.spend_rule r
    join public.spend_rule_version v on v.rule_id = r.id and v.valid_until is null
    where r.budget_line_id = v_line.id;

  -- Retired first, so the replacement is the only live line drawing on an
  -- allowance.
  perform public.write_budget_line_retirement(v_line, v_on);

  insert into public.budget_line (
    household_id, line_group, name, amount_cents, frequency, interval_count, goal_id,
    destination_account_id, allowance_member_id, management_url, starts_on
  ) values (
    v_line.household_id, p_line_group, btrim(p_name), p_amount_cents, p_frequency,
    case when p_frequency in ('every_n_weeks', 'every_n_months') then p_interval_count end,
    case when p_line_group in ('savings', 'investments') then v_line.goal_id end,
    case when p_line_group not in ('savings', 'investments') then v_line.destination_account_id end,
    case when p_line_group = 'discretionary' then v_line.allowance_member_id end,
    v_line.management_url, v_on
  )
  returning id into v_new_id;

  if v_is_default then
    update public.household_default_budget_line d
      set budget_line_id = v_new_id
      where d.household_id = v_line.household_id and d.valid_from >= v_on and d.budget_line_id = v_line.id;
    if public.household_default_budget_line_on(v_line.household_id, v_on) is not distinct from v_line.id then
      insert into public.household_default_budget_line (household_id, valid_from, budget_line_id)
        values (v_line.household_id, v_on, v_new_id);
    end if;
  end if;

  for v_rule in
    select * from jsonb_to_recordset(v_rules) as x(
      valid_from timestamptz, sort_order integer, description_pattern text,
      description_match public.spend_rule_text_match, up_category_ids text[], account_ids uuid[],
      amount_cents bigint, amount_min_cents bigint, amount_max_cents bigint, text_pattern text)
  loop
    insert into public.spend_rule (household_id, target_kind, budget_line_id)
      values (v_line.household_id, 'budget_line', v_new_id)
      returning id into v_new_rule_id;
    perform public.write_spend_rule_version(
      v_new_rule_id, v_rule.valid_from, v_rule.sort_order, v_rule.description_pattern,
      v_rule.description_match, v_rule.up_category_ids, v_rule.account_ids, v_rule.amount_cents,
      v_rule.amount_min_cents, v_rule.amount_max_cents, v_rule.text_pattern
    );
  end loop;

  return v_new_id;
end;
$$;

comment on function public.change_budget_line_from(uuid, date, public.budget_group, text, bigint, public.frequency, integer) is 'Changes a manual budget line from local day p_change_on (default today) on: retires it that day and starts a replacement with the given group, name, amount and cadence, keeping its goal, funding account, allowance and link where the group allows them. Each live rule is copied onto the replacement from that day, in the same place in the order, and the replacement takes over as the default where the line was. Returns the replacement''s id. Raises what retire_budget_line does, and allowance_overdrawn.';

revoke execute on function public.change_budget_line_from(uuid, date, public.budget_group, text, bigint, public.frequency, integer) from public;
grant execute on function public.change_budget_line_from(uuid, date, public.budget_group, text, bigint, public.frequency, integer) to authenticated;

-- ── Planning mode carries the start date ───────────────────────────────────────

create or replace function public.commit_planning_changes(
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
  -- columns the client sent. A create without a start date starts today; a
  -- delete of an item with counted spend is refused (budget_line_has_spend),
  -- failing the whole commit.

  insert into public.budget_line (
    id, household_id, line_group, name, amount_cents, frequency, goal_id,
    interval_count, destination_account_id, breakdown_id,
    gift_recipient_member_id, is_gift_line, management_url, allowance_member_id,
    starts_on
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
    coalesce((row_data ->> 'is_gift_line')::boolean, false),
    nullif(row_data ->> 'management_url', ''),
    nullif(row_data ->> 'allowance_member_id', '')::uuid,
    nullif(row_data ->> 'starts_on', '')::date
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
      then (patch ->> 'is_gift_line')::boolean else b.is_gift_line end,
    management_url = case when patch ? 'management_url'
      then nullif(patch ->> 'management_url', '') else b.management_url end,
    allowance_member_id = case when patch ? 'allowance_member_id'
      then nullif(patch ->> 'allowance_member_id', '')::uuid else b.allowance_member_id end,
    starts_on = case when patch ? 'starts_on'
      then coalesce(nullif(patch ->> 'starts_on', '')::date, b.starts_on) else b.starts_on end
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
