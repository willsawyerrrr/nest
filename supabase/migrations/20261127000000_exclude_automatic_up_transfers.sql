-- Up's automatic transfers are not transactions in Nest.
--
-- A round-up, a cover (and its undo), a forward, a scheduled auto transfer,
-- Save Up's sweep and a closed saver's final interest payment are moves Up
-- makes on the member's behalf. `up-sync` and `up-webhook` never land one
-- (`isAutomaticTransfer` in `up-sync/map.ts`); the rows already landed are
-- deleted below.
--
-- An account whose transactions are all automatic transfers (a Round Up saver)
-- then holds no rows to resume from, so the ledger pass records how far it has
-- read on the account itself.

alter table public.accounts add column ledger_read_through timestamptz;
comment on column public.accounts.ledger_read_through is 'The newest Up `createdAt` up-sync''s ledger pass has read on this account, landed or not; the next pass resumes a day behind it. Null until a pass reads a transaction, which backfills from the start of the prior financial year.';

update public.accounts a
  set ledger_read_through = latest.posted_at
  from (
    select account_id, max(posted_at) as posted_at
      from public.transactions
      where source = 'up'
        and external_category is distinct from 'gifts-and-charity'
      group by account_id
  ) latest
  where a.id = latest.account_id
    and a.source = 'up';

delete from public.transactions
  where source = 'up'
    and (
      transaction_type in ('Round Up', 'Scheduled Transfer')
      or (
        transaction_type = 'Transfer'
        and (
          description ~ '^((Undo )?Cover|Forward|Final interest payment) (to|from) '
          or description = 'Saved Up'
        )
      )
    );
