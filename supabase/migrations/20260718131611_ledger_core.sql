-- Ledger core: households, members, categories, accounts, transactions.
--
-- Money is stored as integer minor units (cents) in bigint columns. Row-Level
-- Security is the isolation boundary: a member can only ever see or change rows
-- belonging to a household they are a member of. Cross-household references are
-- additionally made impossible by composite foreign keys on (id, household_id).

-- ── Enums ──────────────────────────────────────────────────────────────────

create type public.account_type as enum ('transaction', 'savings', 'credit', 'offset', 'other');
create type public.transaction_kind as enum ('income', 'expense', 'transfer');
create type public.transaction_status as enum ('pending', 'settled');
create type public.category_kind as enum ('income', 'expense');
create type public.ledger_source as enum ('up', 'manual');

-- ── Shared updated_at trigger ────────────────────────────────────────────────

create function public.set_updated_at() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── Tables ───────────────────────────────────────────────────────────────────

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Australia/Sydney',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.households is 'The shared container for a household''s members and ledger.';

create table public.members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, user_id),
  unique (id, household_id)
);
create index on public.members (user_id);
create index on public.members (household_id);
comment on table public.members is 'A person in a household, linked to an auth user.';

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  parent_id uuid,
  name text not null,
  kind public.category_kind not null,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (parent_id, household_id)
    references public.categories (id, household_id) on delete set null (parent_id)
);
create index on public.categories (household_id);
comment on table public.categories is 'Hierarchical income/expense taxonomy, scoped to a household.';

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  owner_member_id uuid,
  name text not null,
  type public.account_type not null default 'transaction',
  source public.ledger_source not null default 'manual',
  external_id text,
  balance_cents bigint not null default 0,
  currency text not null default 'AUD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  unique (source, external_id),
  foreign key (owner_member_id, household_id)
    references public.members (id, household_id) on delete set null (owner_member_id)
);
create index on public.accounts (household_id);
comment on table public.accounts is 'A bank or savings account; joint when owner_member_id is null.';

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  account_id uuid not null,
  member_id uuid,
  category_id uuid,
  posted_at timestamptz not null,
  amount_cents bigint not null,
  description text not null default '',
  kind public.transaction_kind not null,
  status public.transaction_status not null default 'settled',
  source public.ledger_source not null default 'manual',
  external_id text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id),
  foreign key (account_id, household_id)
    references public.accounts (id, household_id) on delete cascade,
  foreign key (member_id, household_id)
    references public.members (id, household_id) on delete set null (member_id),
  foreign key (category_id, household_id)
    references public.categories (id, household_id) on delete set null (category_id)
);
create index on public.transactions (household_id);
create index on public.transactions (account_id);
create index on public.transactions (category_id);
create index on public.transactions (posted_at);
comment on table public.transactions is 'A single ledger entry; amount_cents is signed (negative = outflow).';

-- ── updated_at triggers ──────────────────────────────────────────────────────

create trigger set_updated_at before update on public.households
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.members
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.categories
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.accounts
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.transactions
  for each row execute function public.set_updated_at();

-- ── Membership helper (SECURITY DEFINER to avoid RLS recursion on members) ────

create function public.household_ids_for_current_user()
returns setof uuid
language sql
security definer
set search_path = ''
stable
as $$
  select household_id from public.members where user_id = (select auth.uid());
$$;

revoke execute on function public.household_ids_for_current_user() from public;
grant execute on function public.household_ids_for_current_user() to authenticated;

-- ── Row-Level Security ───────────────────────────────────────────────────────

alter table public.households enable row level security;
alter table public.members enable row level security;
alter table public.categories enable row level security;
alter table public.accounts enable row level security;
alter table public.transactions enable row level security;

create policy "members read their household" on public.households
  for select to authenticated
  using (id in (select public.household_ids_for_current_user()));

create policy "members update their household" on public.households
  for update to authenticated
  using (id in (select public.household_ids_for_current_user()))
  with check (id in (select public.household_ids_for_current_user()));

create policy "members read co-members" on public.members
  for select to authenticated
  using (household_id in (select public.household_ids_for_current_user()));

create policy "members update own profile" on public.members
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "household members manage categories" on public.categories
  for all to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));

create policy "household members manage accounts" on public.accounts
  for all to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));

create policy "household members manage transactions" on public.transactions
  for all to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));

-- ── Table grants (Data API auto-expose is off; grant explicitly) ─────────────

grant select, update on public.households to authenticated;
grant select, update on public.members to authenticated;
grant select, insert, update, delete on public.categories to authenticated;
grant select, insert, update, delete on public.accounts to authenticated;
grant select, insert, update, delete on public.transactions to authenticated;

-- ── Bootstrap RPC: create a household and enrol the caller as its first member ─

create function public.create_household(p_name text, p_member_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'must be authenticated';
  end if;

  insert into public.households (name)
    values (p_name)
    returning id into v_household_id;

  insert into public.members (household_id, user_id, name, email)
    values (v_household_id, (select auth.uid()), p_member_name, (select auth.jwt() ->> 'email'));

  return v_household_id;
end;
$$;

revoke execute on function public.create_household(text, text) from public;
grant execute on function public.create_household(text, text) to authenticated;
