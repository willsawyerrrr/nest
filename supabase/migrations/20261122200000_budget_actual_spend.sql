-- Actual spend beside the planned budget.
--
-- Each Up child category maps to a budget group: a seeded default every
-- household shares (`up_category_default_group`), which a household can
-- override per category (`up_category_group`), including to no group at all.
-- `budget_actual_spend` sums the caller's visible spend per group over one
-- period of local calendar days.

-- ── up_category_default_group: the shared default map ─────────────────────────
--
-- Keyed on Up's category id with no foreign key to `up_category`: the taxonomy
-- is synced at runtime, so a fresh database has the defaults before it has the
-- categories. A category absent here defaults to no group.

create table public.up_category_default_group (
  category_id text primary key,
  line_group public.budget_group not null
);

comment on table public.up_category_default_group is 'The budget group each Up child category''s spend counts toward unless a household overrides it in up_category_group. Shared by every household; a category with no row counts toward no group.';

insert into public.up_category_default_group (category_id, line_group) values
  ('groceries', 'needs'),
  ('rent-and-mortgage', 'needs'),
  ('utilities', 'needs'),
  ('internet', 'needs'),
  ('home-insurance-and-rates', 'needs'),
  ('home-maintenance-and-improvements', 'needs'),
  ('pets', 'needs'),
  ('mobile-phone', 'needs'),
  ('health-and-medical', 'needs'),
  ('family', 'needs'),
  ('education-and-student-loans', 'needs'),
  ('life-admin', 'needs'),
  ('car-insurance-and-maintenance', 'needs'),
  ('car-repayments', 'needs'),
  ('fuel', 'needs'),
  ('parking', 'needs'),
  ('public-transport', 'needs'),
  ('toll-roads', 'needs'),
  ('restaurants-and-cafes', 'wants'),
  ('takeaway', 'wants'),
  ('tv-and-music', 'wants'),
  ('games-and-software', 'wants'),
  ('holidays-and-travel', 'wants'),
  ('homeware-and-appliances', 'wants'),
  ('clothing-and-accessories', 'wants'),
  ('fitness-and-wellbeing', 'wants'),
  ('hair-and-beauty', 'wants'),
  ('gifts-and-charity', 'wants'),
  ('news-magazines-and-books', 'wants'),
  ('technology', 'wants'),
  ('cycling', 'wants'),
  ('taxis-and-share-cars', 'wants'),
  ('booze', 'discretionary'),
  ('pubs-and-bars', 'discretionary'),
  ('events-and-gigs', 'discretionary'),
  ('hobbies', 'discretionary'),
  ('adult', 'discretionary'),
  ('lottery-and-gambling', 'discretionary'),
  ('tobacco-and-vaping', 'discretionary'),
  ('investments', 'investments');

alter table public.up_category_default_group enable row level security;

create policy "members read default category groups" on public.up_category_default_group
  for select to authenticated
  using (true);

revoke all on public.up_category_default_group from anon, authenticated, service_role;
grant select on public.up_category_default_group to authenticated;

-- ── up_category_group: a household's overrides ────────────────────────────────
--
-- One row per category the household has remapped. A null `line_group` takes
-- the category out of every group; deleting the row restores the default.

create table public.up_category_group (
  household_id uuid not null references public.households on delete cascade,
  category_id text not null,
  line_group public.budget_group,
  updated_at timestamptz not null default now(),
  primary key (household_id, category_id)
);

comment on table public.up_category_group is 'A household''s override of the budget group an Up child category''s spend counts toward. A null line_group counts it toward no group; no row falls back to up_category_default_group.';

create trigger set_updated_at before update on public.up_category_group
  for each row execute function public.set_updated_at();

alter table public.up_category_group enable row level security;

create policy "household members manage category groups" on public.up_category_group
  for all to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));

revoke all on public.up_category_group from anon, authenticated, service_role;
grant select, insert, update, delete on public.up_category_group to authenticated;

-- ── budget_actual_spend: spend per group over a period ────────────────────────
--
-- Sums spend posted on `p_start`..`p_end` (inclusive local dates, in the
-- household's timezone) per budget group, as a positive cent figure.
--
-- What counts: an `expense` or `income` row carrying an Up category, signed so
-- an outflow adds and a refund back into the category subtracts; and an
-- uncategorised `expense` row. Transfers between the household's own accounts
-- (round-ups, covers, saver moves) are `kind = 'transfer'` and never count, and
-- uncategorised income (pay, a transfer in from someone else) never counts.
-- Settled rows only, unless `p_include_pending`.
--
-- One row per group with spend; a null `line_group` is spend in no group: an
-- uncategorised row, or a category mapped to none.
--
-- SECURITY INVOKER: the `transactions` policies apply, so the figure covers the
-- accounts the caller can see and never a co-member's private spending.

create function public.budget_actual_spend(
  p_start date,
  p_end date,
  p_include_pending boolean default false
)
returns table (line_group public.budget_group, spent_cents bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    case
      when t.external_category is null then null
      when o.category_id is not null then o.line_group
      else d.line_group
    end as line_group,
    -sum(t.amount_cents)::bigint as spent_cents
  from public.transactions t
  join public.households h on h.id = t.household_id
  left join public.up_category_group o
    on o.household_id = t.household_id and o.category_id = t.external_category
  left join public.up_category_default_group d on d.category_id = t.external_category
  where t.household_id in (select public.household_ids_for_current_user())
    and (t.posted_at at time zone h.timezone)::date between p_start and p_end
    and (t.status = 'settled' or p_include_pending)
    and (
      (t.external_category is not null and t.kind <> 'transfer')
      or (t.external_category is null and t.kind = 'expense')
    )
  group by 1;
$$;

comment on function public.budget_actual_spend(date, date, boolean) is 'Spend per budget group posted on p_start..p_end in the household''s timezone, from the transactions the caller can see; a null line_group is spend in no group.';

revoke execute on function public.budget_actual_spend(date, date, boolean) from public;
grant execute on function public.budget_actual_spend(date, date, boolean) to authenticated;
