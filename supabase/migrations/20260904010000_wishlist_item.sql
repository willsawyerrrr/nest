-- Wishlist: a household's aspirational purchases, kept apart from the budget.
--
-- A wishlist item is a thing the household wants to buy one day — a name, a
-- rough cost, and an optional note. It carries no cadence, funds nothing, and
-- feeds no projection: it sits beside the plan until the household turns it into
-- a savings goal or a Discretionary budget line, prefilled from the item, on the
-- Wishlist tab. The item stays after promoting; the household deletes it by hand.
--
-- Isolation matches the other planning tables: RLS on household membership. The
-- `member_id` tag is a display and reporting label — whose wish it is — not a
-- privacy boundary and not a per-person budget; money stays fully pooled.

create table public.wishlist_item (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  name text not null,
  amount_cents bigint not null check (amount_cents > 0),
  member_id uuid references public.members (id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.wishlist_item (household_id);
comment on table public.wishlist_item is 'A household''s aspirational purchase: a name, a rough cost, and an optional note, kept apart from the budget and promotable to a savings goal or a Discretionary budget line.';
comment on column public.wishlist_item.member_id is 'The member whose wish this is — a display and reporting tag only, not a privacy boundary and not a per-person budget; cleared to null if the member is removed.';

-- ── updated_at trigger ───────────────────────────────────────────────────────

create trigger set_updated_at before update on public.wishlist_item
  for each row execute function public.set_updated_at();

-- ── Row-Level Security ───────────────────────────────────────────────────────

alter table public.wishlist_item enable row level security;

create policy "household members manage wishlist items" on public.wishlist_item
  for all to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));

-- ── Table grants (Data API auto-expose is off; grant explicitly) ─────────────

grant select, insert, update, delete on public.wishlist_item to authenticated;
