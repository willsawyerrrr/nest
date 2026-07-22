# Superannuation & net worth

Per-member superannuation modelling and the net-worth view it seeds. For the
tax and projection **math** and the versioned per-FY config, see
[`tax.md`](tax.md); for the schema (`super_profile`, `super_contribution`, the
`exclude_from_net_worth` column, and the `account_directory` view) see
[`data-model.md`](data-model.md#superannuation).

Amounts are integer minor units (cents). The fortnight and financial year are the
primary periods, as everywhere in the app.

## Super tab

The Super tab edits each member's fund name and current balance for the financial
year. The balance is held as a manual account linked from
`super_profile.linked_account_id` — the same balance-source pattern savings goals
use — not a column.

Each member's `super_contribution` rows are managed here (add / edit / delete),
each carrying a kind, an amount or percent-of-salary, a frequency, an FHSS flag,
and a spouse contributor.

### Concessional impact on the estimate

Concessional kinds (salary sacrifice + personal deductible) reduce the tax
estimate — lowering taxable income and after-tax income — so the Tax tab shows a
Division 293 line for high earners and the Summary's available income reflects the
super diverted from cash.

### Caps and co-contribution

Each member's card shows their concessional and non-concessional cap usage (the
concessional cap includes their manual carry-forward), warns when either cap is
exceeded, and estimates the government co-contribution when it applies. The caps,
carry-forward, and co-contribution income test all come from the versioned per-FY
config — see [`tax.md`](tax.md#super-contribution-caps-and-co-contribution).

### Retirement projection

Below the members, a retirement projection compounds each member's current
balance plus their net-of-15%-tax annual contribution (concessional and employer
SG taxed in the fund; non-concessional and co-contribution untaxed) to
retirement, showing the result in nominal and today's (real) dollars. The
projection math is pure (`projectSuperBalance` in `@nest/plan` — see
[`tax.md`](tax.md#retirement-projection)); the shared return / inflation / growth
and retirement-age assumptions and each member's age are client-side inputs
persisted in localStorage, not stored in the database.

## Net worth tab

The Net worth tab sums the `balance_cents` of every account the member can see
(assets only; liabilities not modelled yet), split into Super vs Other accounts.
A co-member's private spending / saver balances are excluded, so each member's
total covers only balances they can see (the per-account balance-privacy model —
see [`architecture.md`](architecture.md#security)).

Any account can be toggled out of the totals via its `exclude_from_net_worth`
flag — a shared, household-wide setting (both partners' views drop it) that
surfaces the account in a muted "Excluded from net worth" group. The exclusion
affects net-worth totals only: it leaves the retirement projection and budgeting
untouched.
