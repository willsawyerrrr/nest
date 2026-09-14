# CDR-sourced accounts in pay splits and savings goals

The other half of [`redbark-ingestion.md`](redbark-ingestion.md): once a
non-Up bank account exists in `accounts`/`account_balance` via Redbark, it is
usable everywhere the **Splits** tab and **Savings goals** already read those
tables — no schema change, and no accreditation or external API of its own.

## The ledger is source-blind end to end

`docs/pay-splits.md` and `docs/budget-and-savings.md` both describe
`budget_line.destination_account_id`, `pay_split`, and
`savings_goal.linked_account_id` as referencing `accounts (id, household_id)`
with no source predicate anywhere — the composite FKs, RLS, and the pure
`@nest/plan` functions (`resolveDestinationAccountId`, `assignmentsByAccount`,
`paySplitNeedsUpdate`) are all keyed on an account id, not on `source`. The
frontend matches this: `apps/pwa/src/hooks/useSavers.ts` and
`apps/pwa/src/components/SplitsScreen.tsx`'s `isSaver()` both key on `type =
'savings'` and exclude only `source = 'manual'` (`.neq('source', 'manual')`),
so a synced savings account from any source — Up or Redbark — is a saver, and
a future third source needs no further edit at either call site.

`GoalForm`'s saver picker, `GoalList`'s "From synced saver …" caption, and
`SplitsScreen`'s recommendation grouping all read from that one filter, so a
Redbark-synced savings account already appears everywhere an Up saver does. UI
copy throughout — "Synced saver" / "From synced saver …" / "Deleted at
source" in `GoalForm.tsx`, `GoalList.tsx`, `BudgetLineForm.tsx`,
`DerivedBudgetLineForm.tsx`, and `SplitsScreen.tsx` — names the source
generically rather than naming Up.

## Pay-split destinations and goal linking need no source-specific code

The budget-line "Funded from" picker reads `account_directory` with no source
filter (`docs/pay-splits.md`), and `set_household_pay_account` checks only
`type = 'transaction'`, not source. A Redbark-synced everyday account at
another bank is a selectable destination — and a selectable pay account — the
moment its row lands in `accounts`, exactly as a second Up account is.

`savings_goal.linked_account_id` is source-blind at the DB layer, so
`GoalForm`'s saver field offers Redbark savers alongside Up ones with no
schema change. Balance freshness depends on `redbark-sync`'s polling cadence
— Redbark proxies live per call rather than storing, so a goal linked to a
Redbark saver is only as fresh as the last poll, the same constraint Up
already has, paced to Redbark's 30 requests/minute limit across however many
household connections exist.

## Ownership: always individual, never joint

A Redbark connection is always owned by whoever completed its consent flow,
never joint — `redbark_connection.member_id` records this directly, and every
account `redbark-sync` lands through a connection takes `owner_member_id =
member_id`. Redbark exposes no signal that an underlying account is legally
joint, so there is no joint-Redbark concept and no joint reconcile pass,
unlike Up. A linked CDR saver's goal therefore belongs to that one member
under the co-member saver-invisible rule in `CLAUDE.md`'s household & money
section, exactly as an individually-owned Up saver already does.

## What CDR does not unlock: pushing the split

CDR's banking designation is read access to account/balance/transaction data;
it does not include payment or standing-instruction initiation, and Redbark
does not expose one either. Confirming a pay split into a CDR-sourced account
stays exactly the manual step it already is for Up: the household types the
recommended amount into that bank's own app, then hits Confirm here.
`pay_split`'s "source-agnostic, no API can push it" framing in
`docs/pay-splits.md` was written for Up's read-only API and holds unchanged
for every bank a CDR aggregator reaches.

## Where this lands

This is the pay-splitting/goal-saving half of Redbark's account ingestion —
see [`redbark-ingestion.md`](redbark-ingestion.md) for the ingestion half —
and a generalisation of Up-saver linking to any synced saver rather than Up
specifically.
