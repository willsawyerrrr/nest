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

The Net worth tab totals assets less liabilities. Assets are the `balance_cents`
of every account the member can see, split into Super vs Other accounts, plus the
current vested value of each equity grant (from the `equity_grant` table — see the
Equity tab) shown in an Equity group. Each member's outstanding HELP debt (from
the `help_debt` table — see the HELP debt tab) is a liability, shown as a negative
figure in a Liabilities group and subtracted from the grand total. So the grand
total is super + other accounts + vested equity − liabilities. A co-member's
private spending / saver balances
are excluded, so each member's total covers only balances they can see (the
per-account balance-privacy model — see
[`architecture.md`](architecture.md#security)).

Any account can be toggled out of the totals via its `exclude_from_net_worth`
flag — a shared, household-wide setting (both partners' views drop it) that
surfaces the account in a muted "Excluded from net worth" group. The exclusion
affects net-worth totals only: it leaves the retirement projection and budgeting
untouched.

## HELP debt tab

The HELP debt tab edits each member's single standing HELP/HECS balance (one
`help_debt` row per member, not financial-year-scoped). The balance drives the
compulsory HELP repayment on the Tax tab and counts as a liability on the Net
worth tab.

## Equity tab

The Equity tab tracks each member's startup equity grants (options or shares),
grouped by member with add / edit / delete. Each grant records its `quantity`,
`grant_date`, cliff and vesting period in months, vesting frequency (monthly /
quarterly / annual), and — for options — a per-share `strike_price_cents`. There
is no Cake (or other cap-table) API, so entry is manual: the household maintains
`price_per_share_cents` (the current fair value per share, a 409A-equivalent)
itself, alongside an optional `price_as_of` date.

A grant vests nothing before its cliff, then vests whole tranches on each
interval boundary up to the vesting period; the vested quantity rounds down. The
net-worth figure is the net "if exercised today" value: the gross vested value
(vested quantity times the price per share) less the exercise cost (vested
quantity times the strike). So options are worth the vested quantity times the
excess of the price per share over the strike (never negative, so underwater
options are worth nothing), and shares — which carry no strike — are worth their
full gross vested value. Only this net value counts toward net worth, valued as
of today; the vesting and valuation math is pure (`vestedQuantity`,
`grossVestedValueCents`, `exerciseCostCents`, `grantValueCents`,
`equityTotalCents` in `@nest/plan`).

The Equity tab shows both figures for an option grant — the gross vested value,
the exercise cost, and the net that counts toward net worth — while a share
grant, whose gross equals its net, shows the single value. The Net worth tab
sums every grant's net value into its Equity assets group, captioned to note the
figure is the vested value net of the strike/exercise cost.
