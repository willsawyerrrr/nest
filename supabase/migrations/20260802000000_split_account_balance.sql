-- Split account balances out of the identity table so the account directory can
-- be a plain, invoker view — no SECURITY DEFINER view anywhere in the schema.
--
-- `accounts` becomes an identity-only table (name, type, source, ownership); a
-- row's balance lives one-to-one in `account_balance`. The two account surfaces
-- are then ordinary `security_invoker` views, each narrowing the caller's own
-- table RLS to the right rule:
--   • account_directory     — identity only (no balance), for budget-line routing
--     and pay-split totals: shared, the caller's own, and any member's
--     transaction account.
--   • accounts_with_balance — identity joined to its balance, for net worth and
--     goal/super balances: shared, the caller's own, and any household super
--     account.
-- `accounts` SELECT spans the union of both rules so either invoker view can
-- resolve its surface without reading past RLS; a co-member's plain saver stays
-- invisible on every surface, and a co-member's spending balance never joins in.

-- ── account_balance: one balance per account, gated to the balance-visible set ─

create table public.account_balance (
  account_id uuid primary key references public.accounts (id) on delete cascade,
  household_id uuid not null,
  balance_cents bigint not null default 0,
  updated_at timestamptz not null default now(),
  foreign key (account_id, household_id)
    references public.accounts (id, household_id) on delete cascade
);
create index on public.account_balance (household_id);
comment on table public.account_balance is 'A single account''s balance in cents, split out of accounts so the identity surface needs no SECURITY DEFINER view. Visible only for the balance-visible set: shared accounts, the caller''s own, and any household super account.';

create trigger set_updated_at before update on public.account_balance
  for each row execute function public.set_updated_at();

-- Backfill every existing balance before the column is dropped.
insert into public.account_balance (account_id, household_id, balance_cents)
  select id, household_id, balance_cents from public.accounts;

alter table public.account_balance enable row level security;

-- Balances follow the same rule as transactions: readable and writable only for
-- the account ids whose balance the caller may see.
create policy "household members read visible-balance balances" on public.account_balance
  for select to authenticated
  using (
    household_id in (select public.household_ids_for_current_user())
    and account_id in (select public.visible_balance_account_ids())
  );

create policy "household members insert visible-balance balances" on public.account_balance
  for insert to authenticated
  with check (
    household_id in (select public.household_ids_for_current_user())
    and account_id in (select public.visible_balance_account_ids())
  );

create policy "household members update visible-balance balances" on public.account_balance
  for update to authenticated
  using (
    household_id in (select public.household_ids_for_current_user())
    and account_id in (select public.visible_balance_account_ids())
  )
  with check (
    household_id in (select public.household_ids_for_current_user())
    and account_id in (select public.visible_balance_account_ids())
  );

create policy "household members delete visible-balance balances" on public.account_balance
  for delete to authenticated
  using (
    household_id in (select public.household_ids_for_current_user())
    and account_id in (select public.visible_balance_account_ids())
  );

grant select, insert, update, delete on public.account_balance to authenticated;
grant select, insert, update on public.account_balance to service_role;

-- ── accounts: an identity table; SELECT spans both surfaces' rules ────────────
--
-- Identity (no balance) is readable for shared accounts, the caller's own, any
-- member's transaction account (for the directory), and any household super
-- account (for net worth). A co-member's plain saver is excluded, so it stays
-- invisible everywhere. Writes are confined to shared or self-owned rows: no code
-- path writes a co-member's identity, and a balance write is gated separately by
-- account_balance's own policies.

drop policy "household members read visible-balance accounts" on public.accounts;
drop policy "household members insert own or shared accounts" on public.accounts;
drop policy "household members update visible-balance accounts" on public.accounts;
drop policy "household members delete visible-balance accounts" on public.accounts;

create policy "household members read directory accounts" on public.accounts
  for select to authenticated
  using (
    household_id in (select public.household_ids_for_current_user())
    and (
      owner_member_id is null
      or owner_member_id in (select public.current_member_ids())
      or type = 'transaction'
      or id in (select public.household_super_account_ids())
    )
  );

create policy "household members insert own or shared accounts" on public.accounts
  for insert to authenticated
  with check (
    household_id in (select public.household_ids_for_current_user())
    and (owner_member_id is null or owner_member_id in (select public.current_member_ids()))
  );

create policy "household members update own or shared accounts" on public.accounts
  for update to authenticated
  using (
    household_id in (select public.household_ids_for_current_user())
    and (owner_member_id is null or owner_member_id in (select public.current_member_ids()))
  )
  with check (
    household_id in (select public.household_ids_for_current_user())
    and (owner_member_id is null or owner_member_id in (select public.current_member_ids()))
  );

create policy "household members delete own or shared accounts" on public.accounts
  for delete to authenticated
  using (
    household_id in (select public.household_ids_for_current_user())
    and (owner_member_id is null or owner_member_id in (select public.current_member_ids()))
  );

-- ── account_directory: identity-only surface, now a plain invoker view ────────
--
-- A security_invoker view reads under the caller's own accounts RLS, then its
-- predicate narrows the union SELECT to the directory rule: shared accounts, the
-- caller's own, and any member's transaction account. A co-member's super and
-- savers are excluded, and there is no balance column at all.

drop view public.account_directory;

create view public.account_directory
with (security_invoker = on) as
  select
    a.id,
    a.household_id,
    a.owner_member_id,
    a.name,
    a.type,
    a.source
  from public.accounts a
  where a.owner_member_id is null
    or a.owner_member_id in (select public.current_member_ids())
    or a.type = 'transaction';

comment on view public.account_directory is 'Identity-only account surface (no balance) for budget-line routing and pay-split totals: shared accounts, the caller''s own accounts, and any member''s transaction accounts. A co-member''s savers and super accounts are excluded. A plain security_invoker view over the accounts identity table.';

grant select on public.account_directory to authenticated;

-- The balance column now lives in account_balance; drop it from the identity row.
alter table public.accounts drop column balance_cents;

-- ── accounts_with_balance: identity joined to balance, a plain invoker view ───
--
-- security_invoker, so the caller's accounts RLS (directory rule) and
-- account_balance RLS (visible-balance rule) both apply; the inner join yields a
-- row only where the identity AND the balance are visible — exactly the
-- balance-visible set (shared, own, and any household super account) with its
-- balance. A co-member's spending shows in accounts but has no visible balance,
-- so it never joins in.

create view public.accounts_with_balance
with (security_invoker = on) as
  select a.*, b.balance_cents
  from public.accounts a
  join public.account_balance b
    on b.account_id = a.id and b.household_id = a.household_id;

comment on view public.accounts_with_balance is 'Account identity joined to its balance for the balance-visible set (shared, own, and household super accounts). A plain security_invoker view: the accounts and account_balance policies together confine it, so a co-member''s spending or saver balance never appears.';

grant select on public.accounts_with_balance to authenticated;

-- ── up-sync dual-write: one atomic RPC upserts identity + balance together ────
--
-- up-sync runs as service_role and upserts a member's Up accounts. Splitting the
-- balance out means two tables must move as one; this SECURITY DEFINER RPC does
-- both in a single call (one transaction), keyed the same as the direct upserts
-- were: accounts on (source, external_id), account_balance on account_id. Each
-- input row carries the full identity plus balance_cents.

create function public.upsert_up_accounts(rows jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  v_account_id uuid;
begin
  for r in select * from jsonb_array_elements(rows)
  loop
    insert into public.accounts
      (household_id, owner_member_id, name, type, source, external_id, currency)
    values (
      (r ->> 'household_id')::uuid,
      nullif(r ->> 'owner_member_id', '')::uuid,
      r ->> 'name',
      (r ->> 'type')::public.account_type,
      (r ->> 'source')::public.ledger_source,
      r ->> 'external_id',
      coalesce(r ->> 'currency', 'AUD')
    )
    on conflict (source, external_id) do update set
      household_id = excluded.household_id,
      owner_member_id = excluded.owner_member_id,
      name = excluded.name,
      type = excluded.type,
      currency = excluded.currency
    returning id into v_account_id;

    insert into public.account_balance (account_id, household_id, balance_cents)
    values (v_account_id, (r ->> 'household_id')::uuid, (r ->> 'balance_cents')::bigint)
    on conflict (account_id) do update set
      household_id = excluded.household_id,
      balance_cents = excluded.balance_cents;
  end loop;
end;
$$;

revoke execute on function public.upsert_up_accounts(jsonb) from public;
grant execute on function public.upsert_up_accounts(jsonb) to service_role;
