-- Date every Up transaction by when the payment was made.
--
-- up-sync and up-webhook set `transactions.posted_at` to Up's `createdAt`, the
-- instant the payment was made, which settlement never moves. Up does not
-- expose `createdAt` on a stored row, so the rows already landed are corrected
-- by re-reading them from Up: `ledger_resync_pending` sends an account's next
-- ledger pass back to the backfill start, whose upsert rewrites every row's
-- `posted_at`, and the pass clears the flag once those rows have landed.

alter table public.accounts
  add column ledger_resync_pending boolean not null default false;
comment on column public.accounts.ledger_resync_pending is 'Whether up-sync''s next ledger pass for this account re-reads from the backfill start rather than its latest synced transaction, re-landing every row; cleared once that pass lands.';

update public.accounts set ledger_resync_pending = true where source = 'up';
