# Superannuation & net worth

Per-member superannuation modelling and the net-worth view it seeds. For the
tax and projection **math** and the versioned per-FY config, see
[`tax.md`](tax.md); for the schema (`super_profile`, `super_contribution`, the
`exclude_from_net_worth` column, and the `account_directory` view) see
[`data-model.md`](data-model.md#superannuation).

Amounts are integer minor units (cents). The fortnight and financial year are the
primary periods, as everywhere in the app.

## Super tab

The Super tab shows each member as a read-only row — fund name and the effective
balance today — with a pencil Edit affordance that swaps the row for an inline
fund-name and balance form with Save and Cancel, matching the tax profiles and the
rest of the app. The balance is held as a manual account linked from
`super_profile.linked_account_id` — the same balance-source pattern savings goals
use — not a column. For a dated baseline the row reads as an estimate, with the
accrual breakdown, since it grows by modelled contributions between true-ups;
saving re-confirms the actual balance. The caps summary, contributions list, and
retirement projection sit below the row unchanged.

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

### Projected forward

Below the total, a stacked-area chart projects net worth forward year by year to
the household's retirement horizon (the longest span to the retirement-age
assumption across the members whose age is entered, or 30 years when none is).
The stacked areas are the asset components — super, cash and other accounts, and
equity — and net worth (assets less HELP debt) is overlaid as a line, so the gap
between the stack and the line reads as the shrinking HELP liability. Figures are
nominal (future dollars): super compounds and accrues its net annual
contributions (`projectSuperBalance`); cash starts at the current account balances
and grows by each savings goal's ongoing fortnightly contribution (the sum of the
budget lines funding it, as on the Goals tab), accruing only up to the goal's
target and then holding flat; each equity grant is valued at its vested portion at
that future date so the equity line lifts as grants vest at today's price
(`equityTotalCents`); and each member's HELP debt follows the payoff projection
from the Tax tab (`projectHelpPayoff`), summed across members. A goal contributes
only its future saving on top of the cash it already holds — a goal's current
balance (its linked saver's synced balance, or a manual goal's own figure) is
already counted in the account totals, so it is never added twice
(`projectGoal` supplies the remaining-to-target cap). The projection is a pure function
(`projectNetWorth` in `@nest/plan`); it reuses the same shared
return / contribution-growth and retirement-age assumptions and per-member ages
as the retirement projection (client-side, persisted in localStorage), and reads
only existing data — no schema or stored series. Series colours come from the
shared chart-token palette and money is formatted with the app's currency helper.

## HELP debt tab

The HELP debt tab shows each member's single standing HELP/HECS balance (one
`help_debt` row per member, not financial-year-scoped) as a read-only row with a
pencil Edit affordance that swaps it for an inline balance form with Save and
Cancel, matching the tax profiles and the rest of the app. The balance drives the
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
