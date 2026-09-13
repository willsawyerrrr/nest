# CDR-sourced accounts in pay splits and savings goals

A design sketch for the other half of [`redbark-ingestion.md`](redbark-ingestion.md):
once a non-Up bank account exists in `accounts`/`account_balance` via a CDR
aggregator (Redbark, or an equivalent), what does it take for the **Splits**
tab and **Savings goals** to actually use it? Nothing here is committed, and
nothing here needs its own accreditation or external API — it is what happens
to two already-shipped features once a second account source shows up in the
same tables they already read.

## The ledger is already source-blind; the frontend isn't

`docs/pay-splits.md` and `docs/budget-and-savings.md` both describe
`budget_line.destination_account_id`, `pay_split`, and
`savings_goal.linked_account_id` as referencing `accounts (id, household_id)`
with no source predicate anywhere — the composite FKs, RLS, and the pure
`@nest/plan` functions (`resolveDestinationAccountId`, `assignmentsByAccount`,
`paySplitNeedsUpdate`) are all keyed on an account id, not on `source`. That
was true before this sketch and needs no schema change to stay true once
Redbark-sourced rows exist.

The frontend, however, hardcodes `source = 'up'` in exactly two places:

- `apps/pwa/src/hooks/useSavers.ts` — `.eq('source', 'up').eq('type',
  'savings')`, the query behind every saver picker.
- `apps/pwa/src/components/SplitsScreen.tsx`'s `isSaver()` — `account.source
  === 'up' && account.type === 'savings'`, which decides whether a routed
  account belongs in "recommended splits" or "stays in your account."

Everything downstream of those two — `GoalForm`'s saver picker, `GoalList`'s
"From Up saver …" caption, `SplitsScreen`'s recommendation grouping — inherits
the Up-only filter from these two call sites, not from anything structural.

## Sketch

### 1. Generalise the two filters

Widen both to any synced savings account rather than naming `'up'`
specifically — `.neq('source', 'manual')` (or, once `ledger_source` gains a
third value per `redbark-ingestion.md`, an explicit `.in('source', ['up',
'redbark'])` if a blanket "not manual" reads too loose). Keying on "not
manual" rather than enumerating sources means a fourth source added later
needs no further edit here, matching how `redbark-ingestion.md` already
generalises `upsert_up_accounts` to take `source` as data rather than baking
`'up'` into the function.

### 2. Pay-split destinations need no code change

The budget-line "Funded from" picker already reads `account_directory` with
no source filter (`docs/pay-splits.md`), and `set_household_pay_account`
checks only `type = 'transaction'`, not source. A Redbark-synced everyday
account at another bank becomes a selectable destination — and a selectable
pay account — the moment its row lands in `accounts`, exactly as a second Up
account would. This is the one part of the sketch that is genuinely already
done.

### 3. Goal linking follows the picker

`savings_goal.linked_account_id` is already source-blind at the DB layer, so
once `useSavers` (step 1) widens, `GoalForm`'s "Up saver" field starts
offering Redbark savers alongside Up ones with no schema change. Balance
freshness then depends on a scheduled `redbark-sync` (mirroring `up-sync`'s
polling cadence) — Redbark proxies live per call rather than storing, so a
goal linked to a Redbark saver is only as fresh as the last poll, the same
constraint Up already has, just paced to Redbark's 30 requests/minute limit
across however many household connections exist.

### 4. What CDR does not unlock: pushing the split

CDR's banking designation is read access to account/balance/transaction data;
it does not include payment or standing-instruction initiation, and Redbark
does not expose one either. So confirming a pay split into a CDR-sourced
account stays exactly the manual step it already is for Up: the household
types the recommended amount into that bank's own app, then hits Confirm
here. `pay_split`'s "source-agnostic, no API can push it" framing in
`docs/pay-splits.md` was written for Up's read-only API but holds unchanged
for every bank a CDR aggregator reaches.

## Schema delta

None beyond what `redbark-ingestion.md` already specs for ingestion itself
(`ledger_source` gains `'redbark'`; `upsert_up_accounts` renames to
`upsert_accounts`). `budget_line`, `pay_split`, and `savings_goal` were
already built generic — this sketch is a frontend-filter change plus a
copy pass, not a migration.

## Open questions

1. **UI copy.** Resolved: "Up saver" and its variants ("From Up saver …",
   "deleted in Up") read as "synced saver" / "From synced saver …" / "deleted
   at source" across `GoalForm.tsx`, `GoalList.tsx`, `BudgetLineForm.tsx`,
   `DerivedBudgetLineForm.tsx`, and `SplitsScreen.tsx`.
2. **Ownership for balance-visibility RLS.** Resolved: a Redbark connection is
   always individually owned by whoever completed its consent flow, never
   joint — `redbark_connection.member_id` records this directly, and every
   account `redbark-sync` lands through a connection takes
   `owner_member_id = member_id`. Redbark exposes no signal that an
   underlying account is legally joint, so there is no joint-Redbark concept
   and no joint reconcile pass, unlike Up. A linked CDR saver's goal therefore
   "belongs" to that one member under the co-member saver-invisible rule in
   `CLAUDE.md`'s household & money section, exactly as an individually-owned
   Up saver already does.
3. **Filter shape.** Resolved: `isSaver`/`useSavers` key on `type = 'savings'`
   and exclude only `'manual'` (`.neq('source', 'manual')`), needing no
   further change per future source.

## Where this lands

This is the pay-splitting/goal-saving half of the multi-source import idea and a
generalisation of the "Up Saver ↔ temporary-item linking" idea to "any
synced saver" rather than Up specifically — see
[`redbark-ingestion.md`](redbark-ingestion.md) for the ingestion half this
depends on. It lands after that ingestion sketch is built: there is nothing
to link a goal to or route a split toward until a non-Up account actually
exists in `accounts`.
