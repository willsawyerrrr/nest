-- Drop the unused 'gift' value from the breakdown_kind enum.
--
-- Gifts roll up standalone, keyed by `budget_line.is_gift_line`, so no breakdown
-- row ever carries `kind = 'gift'`; the contract migration deleted the last of
-- them. Postgres has no `alter type ... drop value`, so retiring the value means
-- swapping the type for a fresh single-value enum. Breakdowns are generic-only.

-- Belt-and-suspenders: idempotent no-op after the contract migration, but makes
-- the type swap safe even if a stray gift breakdown survived — its removal here
-- means the `kind::text::breakdown_kind_new` cast below can never fail.
delete from public.breakdown where kind = 'gift';

-- Swap the enum type: drop the column default (it references the old type), swap
-- the column onto a fresh single-value enum, restore the default, drop the old
-- type, and rename the new one into its place.
alter table public.breakdown alter column kind drop default;
create type public.breakdown_kind_new as enum ('generic');
alter table public.breakdown
  alter column kind type public.breakdown_kind_new
  using kind::text::public.breakdown_kind_new;
drop type public.breakdown_kind;
alter type public.breakdown_kind_new rename to breakdown_kind;
alter table public.breakdown alter column kind set default 'generic';

comment on column public.breakdown.kind is 'Always generic: rolls up breakdown_item rows via the item editor. Breakdowns are generic-only.';
