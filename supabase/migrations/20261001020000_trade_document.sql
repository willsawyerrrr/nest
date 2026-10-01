-- The broker document a trade was read from: a contract note, trade confirmation,
-- or statement, held in the private `receipts` Storage bucket exactly as deduction
-- receipts are. One document can back several trades (a statement lists many), so
-- the link lives on the trade: `trade.document_id` points at the document row, and
-- deleting a document row leaves its trades in place with no document.
--
-- A trade read from a document keeps `source = 'manual'` and no `external_id`:
-- those columns belong to a brokerage import's own idempotency key, and a member
-- confirms every extracted trade by hand, so the document link is the only mark
-- that a trade was extracted.
--
-- The composite foreign key on (document_id, household_id) keeps the reference
-- inside the household, as `trade.member_id` does, and `on delete set null
-- (document_id)` clears only the document column, never the household.

create table public.trade_document (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  storage_path text not null unique,
  created_at timestamptz not null default now(),
  unique (id, household_id)
);
create index on public.trade_document (household_id);
comment on table public.trade_document is 'A stored broker document (contract note, trade confirmation, or statement) that one or more trades were read from; the file lives in the private `receipts` Storage bucket and this row records its path.';
comment on column public.trade_document.storage_path is 'Object key in the `receipts` bucket, prefixed with the household id as its first path segment for the Storage RLS check.';

alter table public.trade add column document_id uuid;
alter table public.trade add constraint trade_document_id_household_id_fkey
  foreign key (document_id, household_id)
  references public.trade_document (id, household_id) on delete set null (document_id);
create index on public.trade (document_id);
comment on column public.trade.document_id is 'The stored broker document the trade was read from; null for a trade entered without one.';

-- ── Row-Level Security ───────────────────────────────────────────────────────

alter table public.trade_document enable row level security;

create policy "household members manage trade documents" on public.trade_document
  for all to authenticated
  using (household_id in (select public.household_ids_for_current_user()))
  with check (household_id in (select public.household_ids_for_current_user()));

-- ── Table grants (Data API auto-expose is off; grant explicitly) ─────────────

grant select, insert, update, delete on public.trade_document to authenticated;

-- ── Saving the trades read from one document ─────────────────────────────────

create or replace function public.create_trades_with_document(
  p_household_id uuid,
  p_document_id uuid,
  p_document_path text,
  p_trades jsonb
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.trade_document (id, household_id, storage_path)
  values (p_document_id, p_household_id, p_document_path)
  on conflict (id) do nothing;

  -- A retried save replays the same caller-minted trade ids, so rows already
  -- written are skipped rather than duplicated.
  with inserted as (
    insert into public.trade (
      id, household_id, member_id, ticker, side, traded_on, units,
      price_per_unit_cents, fee_cents, document_id
    )
    select
      (t ->> 'id')::uuid,
      p_household_id,
      (t ->> 'member_id')::uuid,
      t ->> 'ticker',
      (t ->> 'side')::public.trade_side,
      (t ->> 'traded_on')::date,
      (t ->> 'units')::numeric,
      (t ->> 'price_per_unit_cents')::bigint,
      coalesce((t ->> 'fee_cents')::bigint, 0),
      p_document_id
    from jsonb_array_elements(p_trades) as t
    on conflict (id) do nothing
    returning 1
  )
  select count(*) into v_count from inserted;

  return v_count;
end;
$$;

comment on function public.create_trades_with_document(uuid, uuid, text, jsonb) is 'Writes the already-uploaded document a member confirmed trades from, and those trades, in one transaction, keyed on caller-minted ids so a retried save skips what it already wrote. Returns the number of trades inserted. Runs as the caller, so household RLS gates every statement.';

revoke execute on function public.create_trades_with_document(uuid, uuid, text, jsonb) from public;
grant execute on function public.create_trades_with_document(uuid, uuid, text, jsonb) to authenticated;
