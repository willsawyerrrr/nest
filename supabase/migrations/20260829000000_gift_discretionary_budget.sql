-- An ad hoc discretionary gift buffer.
--
-- A household plans a single amount for gift spend nobody itemised against a
-- recipient or an occasion in advance — a spontaneous present, a top-up for
-- whatever comes up. gift_discretionary_budget holds that one figure per
-- household; its purchases (gift_purchase rows counting against it instead of a
-- gift_budget) may optionally tag a recipient for record-keeping only, never a
-- real per-person budget.

-- ── gift_discretionary_budget: one row per household ─────────────────────────

create table public.gift_discretionary_budget (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null unique references public.households on delete cascade,
  budgeted_amount_cents bigint not null default 0 check (budgeted_amount_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id)
);
comment on table public.gift_discretionary_budget is 'The household''s single ad hoc gift buffer: a planned amount not linked to any recipient''s or occasion''s gift budget. One row per household, created lazily on first edit.';

create trigger set_updated_at before update on public.gift_discretionary_budget
  for each row execute function public.set_updated_at();

alter table public.gift_discretionary_budget enable row level security;

create policy "household members manage the discretionary gift budget" on public.gift_discretionary_budget
  for all to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));

grant select, insert, update, delete on public.gift_discretionary_budget to authenticated;

-- ── gift_purchase: an ad hoc purchase, counted against the buffer instead ────
--
-- A purchase counts against exactly one of a gift_budget or the household's
-- discretionary buffer, never both and never neither. An ad hoc purchase may
-- optionally tag a gift_recipient for record-keeping only — the tag carries no
-- budget of its own, so it is never set on a budget-linked purchase, whose
-- recipient is already gift_budget.recipient_id.

alter table public.gift_purchase
  alter column gift_budget_id drop not null,
  add column gift_discretionary_budget_id uuid,
  add column recipient_id uuid,
  add constraint gift_purchase_gift_discretionary_budget_id_household_id_fkey
    foreign key (gift_discretionary_budget_id, household_id)
    references public.gift_discretionary_budget (id, household_id) on delete cascade,
  add constraint gift_purchase_recipient_id_household_id_fkey
    foreign key (recipient_id, household_id)
    references public.gift_recipient (id, household_id) on delete set null (recipient_id),
  add constraint gift_purchase_budget_xor_discretionary
    check (
      (gift_budget_id is not null and gift_discretionary_budget_id is null)
      or (gift_budget_id is null and gift_discretionary_budget_id is not null)
    ),
  add constraint gift_purchase_recipient_requires_discretionary
    check (recipient_id is null or gift_discretionary_budget_id is not null);

comment on column public.gift_purchase.gift_budget_id is 'The gift budget this purchase counts against; null for an ad hoc purchase against the household''s discretionary buffer instead (gift_purchase_budget_xor_discretionary).';
comment on column public.gift_purchase.gift_discretionary_budget_id is 'The household''s discretionary gift buffer this ad hoc purchase counts against; null for a purchase linked to a gift_budget instead (gift_purchase_budget_xor_discretionary).';
comment on column public.gift_purchase.recipient_id is 'The recipient an ad hoc purchase is optionally tagged with, for record-keeping only — never set on a budget-linked purchase, whose recipient is already gift_budget.recipient_id (gift_purchase_recipient_requires_discretionary).';

create index on public.gift_purchase (gift_discretionary_budget_id, household_id);
create index on public.gift_purchase (recipient_id, household_id);
