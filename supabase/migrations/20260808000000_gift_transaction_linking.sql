-- Gift-scoped Up transaction ingestion and linking.
--
-- up-sync polls each member's Up transactions for the gift category over a
-- trailing window and lands them in the ledger, so the Gifts screen can offer
-- real card spend as candidate purchases to link against a gift budget. Only
-- that one Up category is ingested; a synced row records the Up-side category in
-- `transactions.external_category`, which is separate from the household's own
-- `categories` taxonomy (`category_id` stays null — that taxonomy is unpopulated).
--
-- A candidate the household claims becomes a `gift_purchase` pointing at the
-- transaction, at most one purchase per transaction. Up's `gifts-and-charity`
-- category also covers charity donations, so a candidate that is not a gift can
-- be set aside instead: `gift_transaction_dismissal` records that choice and
-- keeps the row out of the inbox.

-- ── transactions: the Up-side category and household-scoped uniqueness ────────

alter table public.transactions
  add column external_category text,
  add constraint transactions_id_household_id_key unique (id, household_id);
comment on column public.transactions.external_category is 'The category id the source assigned a synced transaction (e.g. Up''s ''gifts-and-charity''), distinct from category_id''s local taxonomy.';

-- ── gift_purchase: the transaction a purchase was linked from ─────────────────

alter table public.gift_purchase
  add column transaction_id uuid,
  add constraint gift_purchase_transaction_id_household_id_fkey
    foreign key (transaction_id, household_id)
    references public.transactions (id, household_id) on delete set null (transaction_id);
comment on column public.gift_purchase.transaction_id is 'The synced transaction this purchase was linked from; null for a hand-entered purchase.';

-- One transaction backs at most one purchase. The index's leading column also
-- serves lookups by transaction and the composite foreign key's own checks.
create unique index gift_purchase_transaction_id_key
  on public.gift_purchase (transaction_id)
  where transaction_id is not null;

-- ── gift_transaction_dismissal: candidates marked "not a gift" ────────────────

create table public.gift_transaction_dismissal (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  transaction_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (transaction_id, household_id)
    references public.transactions (id, household_id) on delete cascade,
  unique (transaction_id)
);
create index on public.gift_transaction_dismissal (household_id);
comment on table public.gift_transaction_dismissal is 'A synced transaction the household marked "not a gift" (Up''s gift category also covers charity), keeping it out of the gift-purchase inbox.';

create trigger set_updated_at before update on public.gift_transaction_dismissal
  for each row execute function public.set_updated_at();

alter table public.gift_transaction_dismissal enable row level security;

-- A dismissal names a transaction and nothing else, and the Gifts screen reads
-- it only by joining `transactions`, where the per-command policies confine the
-- caller to the balance-visible account set. The blanket household policy
-- therefore discloses nothing past that boundary: a dismissal naming a
-- co-member's spending transaction resolves, for the caller, to no transaction at
-- all — the id alone is the whole row.
create policy "household members manage gift transaction dismissals" on public.gift_transaction_dismissal
  for all to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));

grant select, insert, update, delete on public.gift_transaction_dismissal to authenticated;

-- ── up-sync: land one member's gift transactions and prune what left ─────────
--
-- Called once per member per sync with that member's full result set for the
-- gift category over the trailing window (p_since forward, across
-- p_account_ids), so one call settles the window in a single transaction:
-- upsert what Up returned, keep linked purchases in step, and drop the
-- candidates Up no longer reports in the category.

create function public.sync_up_gift_transactions(
  p_household_id uuid,
  p_account_ids uuid[],
  p_since timestamptz,
  rows jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  v_external_ids text[] := array[]::text[];
  v_transaction_id uuid;
  v_amount_cents bigint;
begin
  for r in select * from jsonb_array_elements(rows)
  loop
    insert into public.transactions
      (household_id, account_id, member_id, posted_at, amount_cents, description,
       kind, status, source, external_id, external_category)
    values (
      (r ->> 'household_id')::uuid,
      (r ->> 'account_id')::uuid,
      nullif(r ->> 'member_id', '')::uuid,
      (r ->> 'posted_at')::timestamptz,
      (r ->> 'amount_cents')::bigint,
      coalesce(r ->> 'description', ''),
      (r ->> 'kind')::public.transaction_kind,
      (r ->> 'status')::public.transaction_status,
      'up',
      r ->> 'external_id',
      r ->> 'external_category'
    )
    on conflict (source, external_id) do update set
      household_id = excluded.household_id,
      account_id = excluded.account_id,
      member_id = excluded.member_id,
      posted_at = excluded.posted_at,
      amount_cents = excluded.amount_cents,
      description = excluded.description,
      kind = excluded.kind,
      status = excluded.status,
      external_category = excluded.external_category
    returning id, amount_cents into v_transaction_id, v_amount_cents;

    -- A held transaction settles at whatever the merchant finally charges, so a
    -- linked purchase follows its transaction's amount. Up signs a debit
    -- negative and gift_purchase.amount_cents is non-negative, hence the
    -- magnitude. The description and date stay as the household set them.
    update public.gift_purchase gp
      set amount_cents = abs(v_amount_cents)
      where gp.transaction_id = v_transaction_id
        and gp.amount_cents <> abs(v_amount_cents);

    v_external_ids := v_external_ids || (r ->> 'external_id');
  end loop;

  -- Recategorising a transaction away from gifts in the Up app takes it out of
  -- this result set, which takes it out of the inbox: a synced gift transaction
  -- in the polled window that the pass did not return is no longer a candidate.
  -- A transaction a purchase links to is kept — the household already claimed it
  -- — while a dismissal cascades away with its transaction, which is right: out
  -- of the category, it is not a candidate to dismiss at all. An empty result
  -- set prunes the whole window, the case where the last gift purchase was
  -- recategorised away.
  delete from public.transactions t
  where t.household_id = p_household_id
    and t.source = 'up'
    and t.account_id = any(p_account_ids)
    and t.posted_at >= p_since
    and t.external_category = 'gifts-and-charity'
    and t.external_id <> all(v_external_ids)
    and not exists (
      select 1 from public.gift_purchase gp where gp.transaction_id = t.id
    );
end;
$$;

-- The function is the only path service_role has to `transactions`: it runs as
-- its owner, so the sync needs no table grant of its own (grants stay surgical —
-- see 20260719050000_service_role_ledger_grants.sql). up-sync reaches the table
-- through nothing else; it resolves each transaction's account under the `select`
-- on `accounts` that grant already carries.
revoke execute on function public.sync_up_gift_transactions(uuid, uuid[], timestamptz, jsonb) from public;
grant execute on function public.sync_up_gift_transactions(uuid, uuid[], timestamptz, jsonb) to service_role;
