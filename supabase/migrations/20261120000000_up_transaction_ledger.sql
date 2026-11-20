-- Every Up transaction lands in the ledger.
--
-- up-sync lands each member's Up transactions across every category, each
-- account resuming from its latest synced transaction, and rescans the gift
-- category over a trailing window so a transaction recategorised in the Up app
-- is refreshed in place. Rows carry Up's own detail beside the ledger columns;
-- `notes` stays the household's own and the sync never writes it.

-- ── transactions: Up-side detail ───────────────────────────────────────────────

alter table public.transactions
  add column external_parent_category text,
  add column is_categorizable boolean,
  add column transaction_type text,
  add column deep_link_url text,
  add column up_message text,
  add column up_note text,
  add column performing_customer_name text,
  add column external_category_since timestamptz not null default now();

-- A row's first insert is the closest existing record of when it took on its
-- category: before this migration only the gift category was ingested, and a
-- row recategorised away was deleted rather than kept.
update public.transactions set external_category_since = created_at;

comment on column public.transactions.notes is 'The household''s own note on the transaction. Nest-owned: a source sync never writes it.';
comment on column public.transactions.external_parent_category is 'The parent of external_category in the source''s taxonomy (e.g. Up''s ''good-life''); null when uncategorised.';
comment on column public.transactions.is_categorizable is 'Whether the source lets its owner categorise the transaction (Up''s isCategorizable; false for transfers). Null for a manual row.';
comment on column public.transactions.transaction_type is 'The source''s description of the payment type (Up''s transactionType, e.g. ''Purchase'').';
comment on column public.transactions.deep_link_url is 'The link opening the transaction in the source''s app (Up''s up:// deepLinkURL).';
comment on column public.transactions.up_message is 'The sender''s message on an Up transfer or payment (Up''s message attribute).';
comment on column public.transactions.up_note is 'The owner''s note on the transaction in the Up app (Up''s note.text), distinct from the household''s notes.';
comment on column public.transactions.performing_customer_name is 'The display name of the Up customer who made the transaction (Up''s performingCustomer), telling 2Up partners apart on a joint account.';
comment on column public.transactions.external_category_since is 'When the sync first saw the row carry its current external_category: its insert, or the sync that saw the category change.';

-- ── up-sync: land Up transactions ──────────────────────────────────────────────
--
-- Upserts one household's rows on (source, external_id). A conflicting row in
-- another household is left alone rather than moved, and is absent from the
-- result. `notes` is never written, and neither is `category_id` (the
-- household's taxonomy) nor `created_at` (the row's first insert).
--
-- A held transaction settles at whatever the merchant finally charges, so a
-- linked gift purchase follows its transaction's amount. Up signs a debit
-- negative and gift_purchase.amount_cents is non-negative, hence the magnitude.
-- The purchase's description and date stay as the household set them.
--
-- Returns each landed row's id and whether this call inserted it (`xmax = 0` on
-- a fresh insert), so a caller can act on newly arrived transactions.

create function public.sync_up_transactions(p_household_id uuid, p_rows jsonb)
returns table (id uuid, inserted boolean)
language sql
security definer
set search_path = ''
as $$
  with upserted as (
    insert into public.transactions as t
      (household_id, account_id, member_id, posted_at, amount_cents, description,
       kind, status, source, external_id, external_category, external_parent_category,
       is_categorizable, transaction_type, deep_link_url, up_message, up_note,
       performing_customer_name)
    select
      p_household_id,
      (r ->> 'account_id')::uuid,
      nullif(r ->> 'member_id', '')::uuid,
      (r ->> 'posted_at')::timestamptz,
      (r ->> 'amount_cents')::bigint,
      coalesce(r ->> 'description', ''),
      (r ->> 'kind')::public.transaction_kind,
      (r ->> 'status')::public.transaction_status,
      'up',
      r ->> 'external_id',
      r ->> 'external_category',
      r ->> 'external_parent_category',
      (r ->> 'is_categorizable')::boolean,
      r ->> 'transaction_type',
      r ->> 'deep_link_url',
      r ->> 'up_message',
      r ->> 'up_note',
      r ->> 'performing_customer_name'
    from jsonb_array_elements(p_rows) as r
    on conflict (source, external_id) do update set
      account_id = excluded.account_id,
      member_id = excluded.member_id,
      posted_at = excluded.posted_at,
      amount_cents = excluded.amount_cents,
      description = excluded.description,
      kind = excluded.kind,
      status = excluded.status,
      external_category = excluded.external_category,
      external_category_since = case
        when t.external_category is distinct from excluded.external_category then now()
        else t.external_category_since
      end,
      external_parent_category = excluded.external_parent_category,
      is_categorizable = excluded.is_categorizable,
      transaction_type = excluded.transaction_type,
      deep_link_url = excluded.deep_link_url,
      up_message = excluded.up_message,
      up_note = excluded.up_note,
      performing_customer_name = excluded.performing_customer_name
    where t.household_id = excluded.household_id
    returning t.id, t.amount_cents, t.xmax = 0 as inserted
  ),
  repriced as (
    update public.gift_purchase gp
      set amount_cents = abs(u.amount_cents)
      from upserted u
      where gp.transaction_id = u.id
        and gp.amount_cents <> abs(u.amount_cents)
  )
  select u.id, u.inserted from upserted u;
$$;

-- ── up-sync: delete the Up transactions Up no longer has ──────────────────────
--
-- The gift rescan re-reads a stored gift-category row Up stopped listing in the
-- category; one Up answers 404 for no longer exists there (a hold that dropped)
-- and is deleted here. A transaction a gift purchase links to is kept — the
-- household already claimed it — while a dismissal cascades away with its
-- transaction.

create function public.delete_up_transactions(p_household_id uuid, p_external_ids text[])
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.transactions t
  where t.household_id = p_household_id
    and t.source = 'up'
    and t.external_id = any(p_external_ids)
    and not exists (
      select 1 from public.gift_purchase gp where gp.transaction_id = t.id
    );
$$;

-- These functions are service_role's only write path to `transactions`: they
-- run as their owner, so the sync needs no table write grant of its own (grants
-- stay surgical — see docs/operations.md). It reads the table under the
-- `select` 20261105000000_new_gift_candidate_notification.sql granted.
revoke execute on function public.sync_up_transactions(uuid, jsonb) from public;
grant execute on function public.sync_up_transactions(uuid, jsonb) to service_role;
revoke execute on function public.delete_up_transactions(uuid, text[]) from public;
grant execute on function public.delete_up_transactions(uuid, text[]) to service_role;

-- The gift-scoped upsert-and-prune these two replace.
drop function public.sync_up_gift_transactions(uuid, uuid[], timestamptz, jsonb);
