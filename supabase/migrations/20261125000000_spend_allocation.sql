-- Spend allocation: where each transaction's spend counts.
--
-- Every spend transaction counts toward targets: a budget item (`budget_line`),
-- a member's allowance, or Not budgeted. Where a transaction counts is resolved,
-- first that applies:
--
--   1. a member's choice, or a suggestion a member confirmed
--      (`transaction_allocation`, never changing on its own);
--   2. the household's ordered rules, using the rule versions in force at the
--      transaction's `posted_at`, first match winning (`spend_rule`,
--      `spend_rule_version`);
--   3. an unconfirmed suggestion (`transaction_allocation`);
--   4. the default: spend from a member's own account counts toward that
--      member's allowance, anything else toward the household's default item
--      (`households.default_budget_line_id`), or Not budgeted while it has none.
--
-- Only member choices and suggestions are stored. Rule and default resolution is
-- computed live by `spend_resolution`, a pure function of the transaction, the
-- rule versions and the household's default, so a transaction that changes
-- (settles, gains a note) is re-resolved on the next read against the rules in
-- force at its posting time, with nothing to keep in step. Versioning is what
-- keeps that stable: an edit, a reorder or a retirement applies from a moment
-- on, so an earlier transaction keeps resolving under the version it matched.
--
-- A rule or allocation targeting an allowance, or a budget line drawn from one,
-- is private to that allowance's member. A co-member reads the transaction (if
-- the `transactions` policies show it to them) as counting toward that member's
-- allowance, with neither the rule nor the drawn line named.

-- ── Enums ──────────────────────────────────────────────────────────────────────

create type public.spend_target_kind as enum ('budget_line', 'allowance', 'not_budgeted');
create type public.spend_allocation_origin as enum ('member_choice', 'confirmed_suggestion', 'suggestion');
create type public.spend_resolution_reason as enum ('member_choice', 'confirmed_suggestion', 'rule', 'suggestion', 'default');
create type public.spend_rule_text_match as enum ('contains', 'equals');

-- Lets the allocation, rule and household-default references composite-FK a
-- budget line without leaving the household.
alter table public.budget_line
  add constraint budget_line_id_household_id_key unique (id, household_id);

-- ── households.default_budget_line_id ──────────────────────────────────────────

alter table public.households
  add column default_budget_line_id uuid,
  add constraint households_default_budget_line_id_fkey
    foreign key (default_budget_line_id, id)
    references public.budget_line (id, household_id) on delete set null (default_budget_line_id);
create index on public.households (default_budget_line_id);

comment on column public.households.default_budget_line_id is 'The budget item spend counts toward when no member choice, rule or suggestion places it and it is not from a member''s own account; null counts it as Not budgeted. Set through set_household_default_budget_line.';

-- ── spend_rule: a household's matching rules ───────────────────────────────────
--
-- The rule's identity and target. Its conditions and place in the order live on
-- its versions. The target is fixed: sending a rule's matches elsewhere is a new
-- rule, the old one retired from the same moment.

create table public.spend_rule (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  target_kind public.spend_target_kind not null,
  budget_line_id uuid,
  allowance_member_id uuid,
  created_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (budget_line_id, household_id)
    references public.budget_line (id, household_id) on delete cascade,
  foreign key (allowance_member_id, household_id)
    references public.member_allowance (member_id, household_id) on delete cascade,
  constraint spend_rule_target check (
    case target_kind
      when 'budget_line' then budget_line_id is not null and allowance_member_id is null
      when 'allowance' then allowance_member_id is not null and budget_line_id is null
      else budget_line_id is null and allowance_member_id is null
    end
  )
);
create index on public.spend_rule (household_id);
create index on public.spend_rule (budget_line_id, household_id);
create index on public.spend_rule (allowance_member_id, household_id);

comment on table public.spend_rule is 'A household rule sending matching spend to a budget item, a member''s allowance, or Not budgeted. Its conditions and order are versioned in spend_rule_version. A rule targeting an allowance, or a line drawn from one, is private to that member.';

-- ── spend_rule_version: a rule's conditions and order over time ────────────────
--
-- A version is in force on [valid_from, valid_until); a rule has at most one
-- open version (`valid_until` null), its current one. Conditions are ANDed and
-- at least one is set. Amounts are positive spend cents, compared against the
-- transaction's absolute amount so a refund matches the rule its purchase did.

create table public.spend_rule_version (
  rule_id uuid not null,
  version integer not null check (version >= 1),
  household_id uuid not null references public.households on delete cascade,
  valid_from timestamptz not null,
  valid_until timestamptz,
  sort_order integer not null,
  description_pattern text,
  description_match public.spend_rule_text_match,
  up_category_ids text[],
  account_ids uuid[],
  amount_cents bigint,
  amount_min_cents bigint,
  amount_max_cents bigint,
  text_pattern text,
  created_at timestamptz not null default now(),
  primary key (rule_id, version),
  foreign key (rule_id, household_id)
    references public.spend_rule (id, household_id) on delete cascade,
  constraint spend_rule_version_period check (valid_until is null or valid_until > valid_from),
  constraint spend_rule_version_description check (
    (description_pattern is null) = (description_match is null)
    and (description_pattern is null or (description_pattern = btrim(description_pattern) and description_pattern <> ''))
  ),
  constraint spend_rule_version_text check (
    text_pattern is null or (text_pattern = btrim(text_pattern) and text_pattern <> '')
  ),
  constraint spend_rule_version_categories check (up_category_ids is null or cardinality(up_category_ids) > 0),
  constraint spend_rule_version_accounts check (account_ids is null or cardinality(account_ids) > 0),
  constraint spend_rule_version_amount check (
    (amount_cents is null or (amount_cents > 0 and amount_min_cents is null and amount_max_cents is null))
    and (amount_min_cents is null or amount_min_cents > 0)
    and (amount_max_cents is null or amount_max_cents > 0)
    and (amount_min_cents is null or amount_max_cents is null or amount_min_cents <= amount_max_cents)
  ),
  constraint spend_rule_version_condition check (
    num_nonnulls(description_pattern, up_category_ids, account_ids, amount_cents,
      amount_min_cents, amount_max_cents, text_pattern) > 0
  )
);
create unique index spend_rule_version_current on public.spend_rule_version (rule_id) where valid_until is null;
create index on public.spend_rule_version (household_id, valid_from);

comment on table public.spend_rule_version is 'One version of a spend rule: its ANDed conditions and its place in the household''s order (sort_order, ascending), in force on [valid_from, valid_until). A transaction resolves under the versions in force at its posted_at.';
comment on column public.spend_rule_version.description_pattern is 'Matches the transaction''s description (the payee Up shows), case-insensitively, by description_match.';
comment on column public.spend_rule_version.up_category_ids is 'Matches a transaction whose Up category is one of these.';
comment on column public.spend_rule_version.account_ids is 'Matches a transaction on one of these accounts.';
comment on column public.spend_rule_version.amount_cents is 'Matches a transaction whose absolute amount is exactly this; excludes amount_min_cents and amount_max_cents.';
comment on column public.spend_rule_version.text_pattern is 'Matches a transaction whose up_message, up_note or notes contains this, case-insensitively.';

-- ── transaction_allocation: member choices and suggestions ─────────────────────
--
-- One set of rows per transaction, all of one origin, summing to its spend (the
-- negated `amount_cents`, so a refund's set is negative): split-capable, though
-- every writer allocates a whole transaction to one target. A suggestion is
-- always a whole transaction. A set losing any row is discarded whole, so a
-- deleted budget line or member returns the transaction to rule and default
-- resolution; a set follows its transaction's amount when the sync re-prices it.

create table public.transaction_allocation (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  transaction_id uuid not null,
  target_kind public.spend_target_kind not null,
  budget_line_id uuid,
  allowance_member_id uuid,
  amount_cents bigint not null,
  origin public.spend_allocation_origin not null,
  member_id uuid,
  created_at timestamptz not null default now(),
  foreign key (transaction_id, household_id)
    references public.transactions (id, household_id) on delete cascade,
  foreign key (budget_line_id, household_id)
    references public.budget_line (id, household_id) on delete cascade,
  foreign key (allowance_member_id, household_id)
    references public.member_allowance (member_id, household_id) on delete cascade,
  foreign key (member_id, household_id)
    references public.members (id, household_id) on delete set null (member_id),
  constraint transaction_allocation_target check (
    case target_kind
      when 'budget_line' then budget_line_id is not null and allowance_member_id is null
      when 'allowance' then allowance_member_id is not null and budget_line_id is null
      else budget_line_id is null and allowance_member_id is null
    end
  ),
  constraint transaction_allocation_suggestion_member check (origin <> 'suggestion' or member_id is null)
);
create index on public.transaction_allocation (transaction_id, household_id);
create index on public.transaction_allocation (budget_line_id, household_id);
create index on public.transaction_allocation (allowance_member_id, household_id);
create index on public.transaction_allocation (member_id, household_id);
create index on public.transaction_allocation (household_id);

comment on table public.transaction_allocation is 'Where a member sent a transaction''s spend, or where a suggestion places it: one set per transaction, of one origin, summing to its spend (the negated amount_cents).';
comment on column public.transaction_allocation.origin is 'member_choice and confirmed_suggestion take precedence over every rule; suggestion applies only where no rule matches.';
comment on column public.transaction_allocation.member_id is 'The member who chose or confirmed the allocation; null for an unconfirmed suggestion or once that member is removed.';

-- A set is whole by commit: one origin, one row for a suggestion, every row the
-- spend's sign, summing to the spend. Deferred so a writer may replace a set row
-- by row within its transaction.
create function public.check_transaction_allocation() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_spend bigint;
  v_sum bigint;
  v_rows integer;
  v_origins integer;
  v_suggestion boolean;
  v_wrong_sign boolean;
begin
  select -t.amount_cents into v_spend from public.transactions t where t.id = new.transaction_id;

  select coalesce(sum(a.amount_cents), 0), count(*), count(distinct a.origin),
      bool_or(a.origin = 'suggestion'), bool_or(sign(a.amount_cents) * sign(v_spend) < 0)
    into v_sum, v_rows, v_origins, v_suggestion, v_wrong_sign
    from public.transaction_allocation a
    where a.transaction_id = new.transaction_id;

  if v_spend is null or v_rows = 0 then
    return null;
  end if;

  if v_origins > 1 or v_sum <> v_spend or v_wrong_sign or (v_suggestion and v_rows > 1) then
    raise exception 'transaction_allocation_mismatch' using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

create constraint trigger check_transaction_allocation
  after insert or update on public.transaction_allocation
  deferrable initially deferred
  for each row execute function public.check_transaction_allocation();

create function public.discard_transaction_allocation_set() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.transaction_allocation a where a.transaction_id = old.transaction_id;
  return null;
end;
$$;

create trigger discard_transaction_allocation_set
  after delete on public.transaction_allocation
  for each row execute function public.discard_transaction_allocation_set();

-- A held transaction settles at whatever the merchant finally charges. Its set
-- is scaled to the new spend, the rounding remainder landing on its largest
-- row, so a whole-transaction allocation simply takes the new amount.
create function public.follow_transaction_allocation_amount() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old bigint := -old.amount_cents;
  v_new bigint := -new.amount_cents;
begin
  update public.transaction_allocation a
    set amount_cents = case
      when v_old = 0 then 0
      else round(a.amount_cents::numeric * v_new / v_old)::bigint
    end
    where a.transaction_id = new.id;

  update public.transaction_allocation a
    set amount_cents = a.amount_cents + (
      v_new - (select sum(s.amount_cents) from public.transaction_allocation s where s.transaction_id = new.id)
    )
    where a.id = (
      select s.id from public.transaction_allocation s
      where s.transaction_id = new.id
      order by abs(s.amount_cents) desc, s.id
      limit 1
    );

  return null;
end;
$$;

create trigger follow_transaction_allocation_amount
  after update of amount_cents on public.transactions
  for each row
  when (old.amount_cents is distinct from new.amount_cents)
  execute function public.follow_transaction_allocation_amount();

revoke execute on function public.check_transaction_allocation() from public;
revoke execute on function public.discard_transaction_allocation_set() from public;
revoke execute on function public.follow_transaction_allocation_amount() from public;

-- ── Row-level security ─────────────────────────────────────────────────────────
--
-- Clients read these tables and write them only through the RPCs below, which
-- hold the versioning and allocation invariants.

-- The spend rules the caller may see: their household's, less those targeting a
-- co-member's allowance or a line drawn from one. SECURITY DEFINER so the
-- drawn-line test reads past the budget_line policy it mirrors.
create function public.visible_spend_rule_ids()
returns setof uuid
language sql
security definer
set search_path = ''
stable
as $$
  select r.id
  from public.spend_rule r
  left join public.budget_line b on b.id = r.budget_line_id
  where r.household_id in (select public.household_ids_for_current_user())
    and (r.allowance_member_id is null or r.allowance_member_id in (select public.current_member_ids()))
    and (b.allowance_member_id is null or b.allowance_member_id in (select public.current_member_ids()));
$$;

revoke execute on function public.visible_spend_rule_ids() from public;
grant execute on function public.visible_spend_rule_ids() to authenticated;

alter table public.spend_rule enable row level security;
alter table public.spend_rule_version enable row level security;
alter table public.transaction_allocation enable row level security;

create policy "household members read visible spend rules" on public.spend_rule
  for select to authenticated
  using (id in (select public.visible_spend_rule_ids()));

create policy "household members read visible spend rule versions" on public.spend_rule_version
  for select to authenticated
  using (rule_id in (select public.visible_spend_rule_ids()));

-- An allocation is readable with its transaction (under the `transactions`
-- policies) unless it targets a co-member's allowance or a line drawn from one
-- (under the `budget_line` policy).
create policy "household members read visible allocations" on public.transaction_allocation
  for select to authenticated
  using (
    household_id in (select public.household_ids_for_current_user())
    and transaction_id in (select t.id from public.transactions t)
    and (allowance_member_id is null or allowance_member_id in (select public.current_member_ids()))
    and (budget_line_id is null or budget_line_id in (select b.id from public.budget_line b))
  );

revoke all on public.spend_rule, public.spend_rule_version, public.transaction_allocation
  from anon, authenticated, service_role;
grant select on public.spend_rule, public.spend_rule_version, public.transaction_allocation to authenticated;

-- ── current_spend_rules: each live rule at its current version ─────────────────

create view public.current_spend_rules
with (security_invoker = on) as
  select
    r.id,
    r.household_id,
    r.target_kind,
    r.budget_line_id,
    r.allowance_member_id,
    r.created_at,
    v.version,
    v.valid_from,
    (select min(f.valid_from) from public.spend_rule_version f where f.rule_id = r.id) as first_valid_from,
    v.sort_order,
    v.description_pattern,
    v.description_match,
    v.up_category_ids,
    v.account_ids,
    v.amount_cents,
    v.amount_min_cents,
    v.amount_max_cents,
    v.text_pattern
  from public.spend_rule r
  join public.spend_rule_version v on v.rule_id = r.id and v.valid_until is null;

comment on view public.current_spend_rules is 'Each spend rule in force now, with its current version''s conditions and order (sort_order ascending; first match wins) and first_valid_from, the earliest posting time it applies to. Under the spend_rule and spend_rule_version policies.';

grant select on public.current_spend_rules to authenticated;

-- ── Internal helpers ───────────────────────────────────────────────────────────
--
-- Granted to no role: reached only from the SECURITY DEFINER RPCs below.

-- Refuses a target the caller may not send spend to: a budget line outside the
-- household or drawn from a co-member's allowance, or any allowance but their
-- own.
create function public.assert_spend_target(
  p_household_id uuid,
  p_target_kind public.spend_target_kind,
  p_budget_line_id uuid,
  p_allowance_member_id uuid
)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_target_kind is null
    or (p_target_kind = 'budget_line' and (
      p_allowance_member_id is not null
      or not exists (
        select 1 from public.budget_line b
        where b.id = p_budget_line_id
          and b.household_id = p_household_id
          and (b.allowance_member_id is null or b.allowance_member_id in (select public.current_member_ids()))
      )
    ))
    or (p_target_kind = 'allowance' and (
      p_budget_line_id is not null
      or p_allowance_member_id is null
      or p_allowance_member_id not in (select public.current_member_ids())
      or not exists (
        select 1 from public.member_allowance a
        where a.member_id = p_allowance_member_id and a.household_id = p_household_id
      )
    ))
    or (p_target_kind = 'not_budgeted' and (p_budget_line_id is not null or p_allowance_member_id is not null))
  then
    raise exception 'spend_target_invalid' using errcode = 'check_violation';
  end if;
end;
$$;

-- The moment a rule change applies from: now, or the start of a local day in
-- the household's timezone when backdated. Never a future day.
create function public.spend_rule_effective_from(p_household_id uuid, p_apply_from date)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_timezone text;
begin
  if p_apply_from is null then
    return now();
  end if;

  select h.timezone into v_timezone from public.households h where h.id = p_household_id;

  if p_apply_from > (now() at time zone v_timezone)::date then
    raise exception 'spend_rule_apply_from_future' using errcode = 'check_violation';
  end if;

  return p_apply_from::timestamp at time zone v_timezone;
end;
$$;

-- Writes a rule's version in force from `p_from`: versions starting at or after
-- it are superseded outright, the one spanning it ends there, and the new one
-- stays open. Version numbers only grow. Returns the new version.
create function public.write_spend_rule_version(
  p_rule_id uuid,
  p_from timestamptz,
  p_sort_order integer,
  p_description_pattern text,
  p_description_match public.spend_rule_text_match,
  p_up_category_ids text[],
  p_account_ids uuid[],
  p_amount_cents bigint,
  p_amount_min_cents bigint,
  p_amount_max_cents bigint,
  p_text_pattern text
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_description text := nullif(btrim(p_description_pattern), '');
  v_text text := nullif(btrim(p_text_pattern), '');
  v_categories text[];
  v_accounts uuid[];
  v_version integer;
begin
  select r.household_id into v_household_id from public.spend_rule r where r.id = p_rule_id;

  select array_agg(distinct btrim(c) order by btrim(c)) into v_categories
    from unnest(p_up_category_ids) as c
    where nullif(btrim(c), '') is not null;
  select array_agg(distinct a order by a) into v_accounts
    from unnest(p_account_ids) as a
    where a is not null;

  if num_nonnulls(v_description, v_categories, v_accounts, p_amount_cents,
      p_amount_min_cents, p_amount_max_cents, v_text) = 0 then
    raise exception 'spend_rule_condition_required' using errcode = 'check_violation';
  end if;

  if coalesce(p_amount_cents <= 0, false)
    or (p_amount_cents is not null and (p_amount_min_cents is not null or p_amount_max_cents is not null))
    or coalesce(p_amount_min_cents <= 0, false)
    or coalesce(p_amount_max_cents <= 0, false)
    or coalesce(p_amount_min_cents > p_amount_max_cents, false)
  then
    raise exception 'spend_rule_amount_invalid' using errcode = 'check_violation';
  end if;

  -- Any account the caller can name: shared, their own, or a member's spending
  -- account (the account_directory rule).
  if exists (
    select 1 from unnest(v_accounts) as x(id)
    where not exists (
      select 1 from public.accounts a
      where a.id = x.id
        and a.household_id = v_household_id
        and (
          a.owner_member_id is null
          or a.owner_member_id in (select public.current_member_ids())
          or a.type = 'transaction'
        )
    )
  ) then
    raise exception 'spend_rule_account_invalid' using errcode = 'check_violation';
  end if;

  select coalesce(max(v.version), 0) + 1 into v_version
    from public.spend_rule_version v where v.rule_id = p_rule_id;

  delete from public.spend_rule_version v
    where v.rule_id = p_rule_id and v.valid_from >= p_from;

  update public.spend_rule_version v
    set valid_until = p_from
    where v.rule_id = p_rule_id
      and v.valid_from < p_from
      and (v.valid_until is null or v.valid_until > p_from);

  insert into public.spend_rule_version (
    rule_id, version, household_id, valid_from, sort_order, description_pattern,
    description_match, up_category_ids, account_ids, amount_cents,
    amount_min_cents, amount_max_cents, text_pattern
  ) values (
    p_rule_id, v_version, v_household_id, p_from, p_sort_order, v_description,
    case when v_description is not null then coalesce(p_description_match, 'contains') end,
    v_categories, v_accounts, p_amount_cents, p_amount_min_cents, p_amount_max_cents, v_text
  );

  return v_version;
end;
$$;

revoke execute on function public.assert_spend_target(uuid, public.spend_target_kind, uuid, uuid) from public;
revoke execute on function public.spend_rule_effective_from(uuid, date) from public;
revoke execute on function public.write_spend_rule_version(uuid, timestamptz, integer, text, public.spend_rule_text_match, text[], uuid[], bigint, bigint, bigint, text) from public;

-- ── set_household_default_budget_line ──────────────────────────────────────────

create function public.set_household_default_budget_line(p_budget_line_id uuid)
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

  if p_budget_line_id is not null and not exists (
    select 1 from public.budget_line b
    where b.id = p_budget_line_id
      and b.household_id = v_household_id
      and b.allowance_member_id is null
  ) then
    raise exception 'default_budget_line_invalid' using errcode = 'check_violation';
  end if;

  update public.households
    set default_budget_line_id = p_budget_line_id
    where id = v_household_id;
end;
$$;

comment on function public.set_household_default_budget_line(uuid) is 'Sets (or, with null, clears) the caller''s household default item: a budget line of the household not drawn from an allowance.';

revoke execute on function public.set_household_default_budget_line(uuid) from public;
grant execute on function public.set_household_default_budget_line(uuid) to authenticated;

-- ── Member choices ─────────────────────────────────────────────────────────────
--
-- Both run as their owner and re-apply the `transactions` read policy's
-- predicate themselves, as review_transaction does. A joint-account
-- transaction's choice is shared by both partners, the last write winning.

create function public.set_transaction_spend_target(
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

comment on function public.set_transaction_spend_target(uuid, public.spend_target_kind, uuid, uuid) is 'Sends the whole of a spend transaction the caller can see to a target (a budget line, the caller''s own allowance, or Not budgeted) as their choice, replacing any choice or suggestion. Raises no_data_found for a transaction the caller cannot see, transaction_not_spend for a transfer or uncategorised income, spend_target_invalid for a target they may not use.';

create function public.clear_transaction_spend_target(p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.transactions t
    where t.id = p_transaction_id
      and t.household_id in (select public.household_ids_for_current_user())
      and t.account_id in (select public.visible_balance_account_ids())
      and t.id not in (select public.hidden_gift_transaction_ids_for_current_member())
  ) then
    raise exception 'transaction not found' using errcode = 'no_data_found';
  end if;

  delete from public.transaction_allocation a
    where a.transaction_id = p_transaction_id and a.origin <> 'suggestion';
end;
$$;

comment on function public.clear_transaction_spend_target(uuid) is 'Clears the member choice (or confirmed suggestion) on a transaction the caller can see, returning it to rule and default resolution.';

revoke execute on function public.set_transaction_spend_target(uuid, public.spend_target_kind, uuid, uuid) from public;
grant execute on function public.set_transaction_spend_target(uuid, public.spend_target_kind, uuid, uuid) to authenticated;
revoke execute on function public.clear_transaction_spend_target(uuid) from public;
grant execute on function public.clear_transaction_spend_target(uuid) to authenticated;

-- ── Rules ──────────────────────────────────────────────────────────────────────
--
-- Every change applies from now, or with `p_apply_from` from the start of that
-- local day, re-resolving the transactions posted since. A new rule joins the
-- end of the order.

create function public.create_spend_rule(
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
begin
  select hid into v_household_id
    from public.household_ids_for_current_user() as hid
    limit 1;

  if v_household_id is null then
    raise exception 'caller has no household';
  end if;

  perform public.assert_spend_target(v_household_id, p_target_kind, p_budget_line_id, p_allowance_member_id);

  select coalesce(max(v.sort_order), -1) + 1 into v_sort_order
    from public.spend_rule_version v where v.household_id = v_household_id;

  insert into public.spend_rule (household_id, target_kind, budget_line_id, allowance_member_id)
    values (v_household_id, p_target_kind, p_budget_line_id, p_allowance_member_id)
    returning id into v_rule_id;

  perform public.write_spend_rule_version(
    v_rule_id, public.spend_rule_effective_from(v_household_id, p_apply_from), v_sort_order,
    p_description_pattern, p_description_match, p_up_category_ids, p_account_ids,
    p_amount_cents, p_amount_min_cents, p_amount_max_cents, p_text_pattern
  );

  return v_rule_id;
end;
$$;

comment on function public.create_spend_rule(public.spend_target_kind, uuid, uuid, text, public.spend_rule_text_match, text[], uuid[], bigint, bigint, bigint, text, date) is 'Creates a spend rule at the end of the household''s order, in force from now or from the start of local day p_apply_from. Returns its id. Raises spend_target_invalid, spend_rule_condition_required, spend_rule_amount_invalid, spend_rule_account_invalid, or spend_rule_apply_from_future.';

create function public.update_spend_rule(
  p_rule_id uuid,
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
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.spend_rule;
  v_sort_order integer;
begin
  select r.* into v_rule from public.spend_rule r
    where r.id = p_rule_id and r.id in (select public.visible_spend_rule_ids());

  if not found then
    raise exception 'spend_rule_not_found' using errcode = 'no_data_found';
  end if;

  select v.sort_order into v_sort_order
    from public.spend_rule_version v
    where v.rule_id = p_rule_id and v.valid_until is null;

  if not found then
    raise exception 'spend_rule_retired' using errcode = 'check_violation';
  end if;

  return public.write_spend_rule_version(
    p_rule_id, public.spend_rule_effective_from(v_rule.household_id, p_apply_from), v_sort_order,
    p_description_pattern, p_description_match, p_up_category_ids, p_account_ids,
    p_amount_cents, p_amount_min_cents, p_amount_max_cents, p_text_pattern
  );
end;
$$;

comment on function public.update_spend_rule(uuid, text, public.spend_rule_text_match, text[], uuid[], bigint, bigint, bigint, text, date) is 'Replaces a live spend rule''s conditions with a new version in force from now or from the start of local day p_apply_from, keeping its place in the order. Returns the new version. Raises spend_rule_not_found, spend_rule_retired, or the create_spend_rule condition errors.';

create function public.delete_spend_rule(p_rule_id uuid, p_apply_from date default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.spend_rule;
  v_from timestamptz;
begin
  select r.* into v_rule from public.spend_rule r
    where r.id = p_rule_id and r.id in (select public.visible_spend_rule_ids());

  if not found then
    raise exception 'spend_rule_not_found' using errcode = 'no_data_found';
  end if;

  v_from := public.spend_rule_effective_from(v_rule.household_id, p_apply_from);

  delete from public.spend_rule_version v
    where v.rule_id = p_rule_id and v.valid_from >= v_from;

  update public.spend_rule_version v
    set valid_until = v_from
    where v.rule_id = p_rule_id and (v.valid_until is null or v.valid_until > v_from);

  delete from public.spend_rule r
    where r.id = p_rule_id
      and not exists (select 1 from public.spend_rule_version v where v.rule_id = r.id);
end;
$$;

comment on function public.delete_spend_rule(uuid, date) is 'Retires a spend rule from now or from the start of local day p_apply_from; transactions posted earlier keep resolving under it. A rule retired from before it first applied is removed outright. Raises spend_rule_not_found.';

-- Reorders the live rules the caller can see into `p_rule_ids`, first match
-- first. The rules keep the order slots they occupy between them, so a
-- co-member's private rules hold their places, and each moved rule takes a new
-- version from now: earlier transactions keep the order they resolved under.
create function public.reorder_spend_rules(p_rule_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slots integer[];
  v_live uuid[];
  v_version public.spend_rule_version;
  v_index integer;
begin
  select array_agg(v.rule_id order by v.rule_id), array_agg(v.sort_order order by v.sort_order)
    into v_live, v_slots
    from public.spend_rule_version v
    where v.valid_until is null
      and v.rule_id in (select public.visible_spend_rule_ids());

  if coalesce(v_live, '{}') <> coalesce((select array_agg(x order by x) from unnest(p_rule_ids) as x), '{}')
    or cardinality(p_rule_ids) <> (select count(distinct x) from unnest(p_rule_ids) as x)
  then
    raise exception 'spend_rule_order_mismatch' using errcode = 'check_violation';
  end if;

  for v_index in 1 .. coalesce(cardinality(p_rule_ids), 0) loop
    select v.* into v_version
      from public.spend_rule_version v
      where v.rule_id = p_rule_ids[v_index] and v.valid_until is null;

    if v_version.sort_order <> v_slots[v_index] then
      perform public.write_spend_rule_version(
        v_version.rule_id, now(), v_slots[v_index],
        v_version.description_pattern, v_version.description_match, v_version.up_category_ids,
        v_version.account_ids, v_version.amount_cents, v_version.amount_min_cents,
        v_version.amount_max_cents, v_version.text_pattern
      );
    end if;
  end loop;
end;
$$;

comment on function public.reorder_spend_rules(uuid[]) is 'Orders every live spend rule the caller can see as p_rule_ids (first match first), from now. Raises spend_rule_order_mismatch unless p_rule_ids is exactly those rules.';

revoke execute on function public.create_spend_rule(public.spend_target_kind, uuid, uuid, text, public.spend_rule_text_match, text[], uuid[], bigint, bigint, bigint, text, date) from public;
grant execute on function public.create_spend_rule(public.spend_target_kind, uuid, uuid, text, public.spend_rule_text_match, text[], uuid[], bigint, bigint, bigint, text, date) to authenticated;
revoke execute on function public.update_spend_rule(uuid, text, public.spend_rule_text_match, text[], uuid[], bigint, bigint, bigint, text, date) from public;
grant execute on function public.update_spend_rule(uuid, text, public.spend_rule_text_match, text[], uuid[], bigint, bigint, bigint, text, date) to authenticated;
revoke execute on function public.delete_spend_rule(uuid, date) from public;
grant execute on function public.delete_spend_rule(uuid, date) to authenticated;
revoke execute on function public.reorder_spend_rules(uuid[]) from public;
grant execute on function public.reorder_spend_rules(uuid[]) to authenticated;

-- ── spend_resolution: where each transaction counts, and why ───────────────────
--
-- One row per allocation (a whole transaction is one row) of every spend
-- transaction the caller can see, optionally narrowed to local posting dates
-- `p_start`..`p_end` (household timezone) and to `p_transaction_ids`.
-- `amount_cents` is positive spend; a refund is negative and nets off its
-- target.
--
-- What counts: any row but a transfer, except uncategorised income. Pending and
-- settled alike, `status` telling them apart.
--
-- SECURITY DEFINER because resolution reads every rule and allocation in the
-- household, a co-member's private ones included, so a joint transaction
-- resolves the same for both partners. It re-applies the `transactions` read
-- policy's predicate itself, and reports a target private to a co-member as
-- that member's allowance, with no budget line, rule or version named.

create function public.spend_resolution(
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
      a.owner_member_id, h.default_budget_line_id
    from public.transactions t
    join public.households h on h.id = t.household_id
    join public.accounts a on a.id = t.account_id
    where t.household_id in (select public.household_ids_for_current_user())
      and t.account_id in (select public.visible_balance_account_ids())
      and t.id not in (select public.hidden_gift_transaction_ids_for_current_member())
      and t.kind <> 'transfer'
      and (t.external_category is not null or t.kind = 'expense')
      and (p_start is null or (t.posted_at at time zone h.timezone)::date >= p_start)
      and (p_end is null or (t.posted_at at time zone h.timezone)::date <= p_end)
      and (p_transaction_ids is null or t.id = any(p_transaction_ids))
  ),
  resolved as (
    select
      s.id, al.target_kind, al.budget_line_id, al.allowance_member_id, al.amount_cents,
      al.origin::text::public.spend_resolution_reason as reason,
      null::uuid as rule_id, null::integer as rule_version
    from spend s
    join public.transaction_allocation al on al.transaction_id = s.id and al.origin <> 'suggestion'
    union all
    select s.id, f.target_kind, f.budget_line_id, f.allowance_member_id, s.spend_cents, f.reason, f.rule_id, f.rule_version
    from spend s
    cross join lateral (
      select * from (
        (
          select r.target_kind, r.budget_line_id, r.allowance_member_id,
            'rule'::public.spend_resolution_reason as reason, v.rule_id, v.version as rule_version, 1 as layer
          from public.spend_rule_version v
          join public.spend_rule r on r.id = v.rule_id
          where v.household_id = s.household_id
            and v.valid_from <= s.posted_at
            and (v.valid_until is null or s.posted_at < v.valid_until)
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
        where al.transaction_id = s.id and al.origin = 'suggestion'
        union all
        select
          case
            when s.owner_member_id is not null then 'allowance'
            when s.default_budget_line_id is not null then 'budget_line'
            else 'not_budgeted'
          end::public.spend_target_kind,
          case when s.owner_member_id is null then s.default_budget_line_id end,
          s.owner_member_id,
          'default'::public.spend_resolution_reason, null, null, 3
      ) as candidate
      order by candidate.layer
      limit 1
    ) as f
    where not exists (
      select 1 from public.transaction_allocation al
      where al.transaction_id = s.id and al.origin <> 'suggestion'
    )
  )
  select
    r.id,
    s.posted_at,
    s.status,
    case when p.is_private then 'allowance'::public.spend_target_kind else r.target_kind end,
    case when p.is_private then null else r.budget_line_id end,
    case when p.is_private then o.owner_member_id else r.allowance_member_id end,
    r.amount_cents,
    r.reason,
    case when p.is_private then null else r.rule_id end,
    case when p.is_private then null else r.rule_version end
  from resolved r
  join spend s on s.id = r.id
  left join public.budget_line b on b.id = r.budget_line_id
  cross join lateral (select coalesce(r.allowance_member_id, b.allowance_member_id) as owner_member_id) as o
  cross join lateral (
    select o.owner_member_id is not null
      and o.owner_member_id not in (select public.current_member_ids()) as is_private
  ) as p;
$$;

comment on function public.spend_resolution(date, date, uuid[]) is 'Where each spend transaction the caller can see counts, one row per allocation, and why: a member choice or confirmed suggestion, the rule and version that matched at its posting time, an unconfirmed suggestion, or the default. Optionally narrowed to local posting dates p_start..p_end and to p_transaction_ids. A target private to a co-member reads as their allowance, unnamed.';

revoke execute on function public.spend_resolution(date, date, uuid[]) from public;
grant execute on function public.spend_resolution(date, date, uuid[]) to authenticated;

-- ── actual_spend_by_target: spend per target over a period ─────────────────────

create function public.actual_spend_by_target(p_start date, p_end date)
returns table (
  target_kind public.spend_target_kind,
  budget_line_id uuid,
  allowance_member_id uuid,
  status public.transaction_status,
  spent_cents bigint,
  transaction_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    r.target_kind, r.budget_line_id, r.allowance_member_id, r.status,
    sum(r.amount_cents)::bigint, count(distinct r.transaction_id)::integer
  from public.spend_resolution(p_start, p_end) r
  group by r.target_kind, r.budget_line_id, r.allowance_member_id, r.status;
$$;

comment on function public.actual_spend_by_target(date, date) is 'Spend posted on local dates p_start..p_end per target (budget line, allowance, or Not budgeted) and status, from spend_resolution: one row per target with pending spend and one with settled.';

revoke execute on function public.actual_spend_by_target(date, date) from public;
grant execute on function public.actual_spend_by_target(date, date) to authenticated;

-- ── preview_spend_rule: what a rule change would move ──────────────────────────
--
-- Applies the change exactly as create_spend_rule (no `p_rule_id`),
-- update_spend_rule (`p_rule_id`), or delete_spend_rule (`p_rule_id` and
-- `p_retire`) would, reads the resolution of every transaction posted since the
-- change applies from, and rolls the change back. Returns each transaction
-- whose target would change, from what to what. A change from now moves
-- nothing already posted, so only a backdated one returns rows. Raises what the
-- change itself would.

create function public.preview_spend_rule(
  p_rule_id uuid default null,
  p_target_kind public.spend_target_kind default null,
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
  p_apply_from date default null,
  p_retire boolean default false
)
returns table (
  transaction_id uuid,
  posted_at timestamptz,
  status public.transaction_status,
  amount_cents bigint,
  from_target_kind public.spend_target_kind,
  from_budget_line_id uuid,
  from_allowance_member_id uuid,
  from_reason public.spend_resolution_reason,
  to_target_kind public.spend_target_kind,
  to_budget_line_id uuid,
  to_allowance_member_id uuid,
  to_reason public.spend_resolution_reason,
  to_rule_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_from timestamptz;
  v_before jsonb;
  v_after jsonb;
begin
  select hid into v_household_id
    from public.household_ids_for_current_user() as hid
    limit 1;

  if v_household_id is null then
    raise exception 'caller has no household';
  end if;

  v_from := public.spend_rule_effective_from(v_household_id, p_apply_from);

  select coalesce(jsonb_agg(to_jsonb(r)), '[]') into v_before
    from public.spend_resolution(
      ((v_from at time zone (select h.timezone from public.households h where h.id = v_household_id))::date)
    ) r
    where r.posted_at >= v_from;

  begin
    if p_retire then
      perform public.delete_spend_rule(p_rule_id, p_apply_from);
    elsif p_rule_id is null then
      perform public.create_spend_rule(
        p_target_kind, p_budget_line_id, p_allowance_member_id, p_description_pattern,
        p_description_match, p_up_category_ids, p_account_ids, p_amount_cents,
        p_amount_min_cents, p_amount_max_cents, p_text_pattern, p_apply_from
      );
    else
      perform public.update_spend_rule(
        p_rule_id, p_description_pattern, p_description_match, p_up_category_ids,
        p_account_ids, p_amount_cents, p_amount_min_cents, p_amount_max_cents,
        p_text_pattern, p_apply_from
      );
    end if;

    select coalesce(jsonb_agg(to_jsonb(r)), '[]') into v_after
      from public.spend_resolution(
        ((v_from at time zone (select h.timezone from public.households h where h.id = v_household_id))::date)
      ) r
      where r.posted_at >= v_from;

    -- Undo the change: only the two readings survive the rollback.
    raise exception 'spend rule preview' using errcode = 'NP001';
  exception when sqlstate 'NP001' then
    null;
  end;

  -- Rules move only whole transactions, so a changed transaction has one row on
  -- each side.
  return query
    select
      b.transaction_id, b.posted_at, b.status, b.amount_cents,
      b.target_kind, b.budget_line_id, b.allowance_member_id, b.reason,
      a.target_kind, a.budget_line_id, a.allowance_member_id, a.reason, a.rule_id
    from jsonb_to_recordset(v_before) as b(
      transaction_id uuid, posted_at timestamptz, status public.transaction_status, amount_cents bigint,
      target_kind public.spend_target_kind, budget_line_id uuid, allowance_member_id uuid,
      reason public.spend_resolution_reason, rule_id uuid
    )
    join jsonb_to_recordset(v_after) as a(
      transaction_id uuid, target_kind public.spend_target_kind, budget_line_id uuid,
      allowance_member_id uuid, reason public.spend_resolution_reason, rule_id uuid
    ) on a.transaction_id = b.transaction_id
    where (a.target_kind, a.budget_line_id, a.allowance_member_id)
      is distinct from (b.target_kind, b.budget_line_id, b.allowance_member_id)
    order by b.posted_at, b.transaction_id;
end;
$$;

comment on function public.preview_spend_rule(uuid, public.spend_target_kind, uuid, uuid, text, public.spend_rule_text_match, text[], uuid[], bigint, bigint, bigint, text, date, boolean) is 'Previews creating (no p_rule_id), editing (p_rule_id) or retiring (p_rule_id, p_retire) a spend rule from now or local day p_apply_from, changing nothing: each visible transaction posted since whose target would change, from what to what.';

revoke execute on function public.preview_spend_rule(uuid, public.spend_target_kind, uuid, uuid, text, public.spend_rule_text_match, text[], uuid[], bigint, bigint, bigint, text, date, boolean) from public;
grant execute on function public.preview_spend_rule(uuid, public.spend_target_kind, uuid, uuid, text, public.spend_rule_text_match, text[], uuid[], bigint, bigint, bigint, text, date, boolean) to authenticated;
