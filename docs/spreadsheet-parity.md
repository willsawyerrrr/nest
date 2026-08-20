# Spreadsheet feature-parity analysis

Audit of the household's real budgeting spreadsheet against the shipped plan-only
app, to find what the app must add for full parity. Structure and mechanics only
— no real amounts, balances, or personal names.

## 1. Spreadsheet feature inventory

The workbook has nine sheets. It is driven by Excel named tables and `VLOOKUP`
against small config tables; every amount normalises to a fortnight and to an
annual total, exactly like the app.

- **Summary** — the reconciliation dashboard. Three blocks:
  - _Income_: annual + fortnightly income, tax, and after-tax, each summed across
    the two members.
  - _Outgoing_ and _Saving_: one row per category (Needs, Wants, Spending,
    Temporary / Savings, Investments) showing Fortnightly, Annually, and
    **Portion** = category fortnightly ÷ fortnightly after-tax income.
  - _Remaining_: a running ledger — Income → `After Outgoing` (income − outgoings)
    → `After Saving` (− savings block). This is precisely the app's Summary.
- **Income** — per-member tax model, two side-by-side blocks:
  - One member's income is **wage-based**: `hourly_rate × 38 × 52` (rate × standard
    hours × weeks). The other is a **fixed annual salary**.
  - Annual tax = marginal income tax + STSL (HELP) repayment + flat Medicare levy:
    `IncomeTax(income) + STSL(income) + MEDICARE_LEVY × income`, where
    `MEDICARE_LEVY = 0.02` (a named constant) and `IncomeTax`/`STSL` are marginal
    `VLOOKUP`s of the form `Absolute + PerDollar × (income − LowerBound)` against
    the Data sheet's bracket tables.
  - After-tax = income − tax; fortnightly = annual ÷ 26.
  - This is a **simpler** tax model than the app: flat 2% Medicare with no
    low-income reduction, no LITO offset, no Medicare levy surcharge / private-
    hospital handling, and HELP as a plain marginal lookup.
- **Outgoing** — six category tables laid out side by side: **Needs, Wants,
  Spending** (= the app's Discretionary), **Temporary, Savings, Investments**.
  Each row = Bill/Item, Amount, Frequency, then computed Fortnightly
  (`Amount × PeriodsPerYear(Frequency) / 26`) and Annually
  (`Amount × PeriodsPerYear(Frequency)`), with per-table `SUBTOTAL` totals. A
  free-text **"Spendings" scratch column** sits beside the Discretionary table —
  an un-costed running list of discretionary intentions (annotations only).
- **Goals** — a flat list of savings targets: Goal name + target Amount, with a
  total. No current balance, contribution, date, or ETA — **the app's Goals are
  strictly richer.**
- **Data** — the lookup/config tables that everything references:
  - _Income Tax Rates_ — marginal brackets (Lower Bound, Absolute, Per Dollar).
  - _STSL Rates_ — HELP/STSL repayment brackets (same marginal shape; one row
    derives a 10% cap).
  - _Payment Frequencies_ — Frequency → periods/year (Weekly 52, Fortnightly 26,
    Monthly 12, Quarterly 4, Biannually 2, Annually 1).
  - _Payment Methods_ — an enum: **Debit, Transfer, Card, Saver** (how a bill is
    paid).
- **Computed Data** — builds the allocation ranking behind the donut: `VSTACK`
  the outgoing + saving categories and their portions, `SORTBY` portion
  descending, and compute **`Unallocated` = 1 − Σ portions**.
- **Wishlist** — a **per-member** list of aspirational purchases (item + amount +
  total per person). Not part of the budget; a wish-to-buy backlog.
- **Todo** — a free-text **finance-admin checklist** (e.g. chase a reimbursement,
  change a payment method on a bill). Plain task list.
- **Gifts** — a detailed **itemised gift budget**: one table of individual gifts
  by occasion and recipient (amount each), plus a second "each other" table
  (occasion × per-person amount × 2). Rolls up to a total that feeds a
  Discretionary gift line.

## 2. Parity matrix

| Spreadsheet capability | App | Note |
| --- | --- | --- |
| Per-member income; wage (rate × hours × weeks) and salary | ✅ Have | Taxable inflows: wage `rate × hours/period`, salary annual gross. App richer: an inflow can also be a **one-off** — a single dated payment (severance, a bonus, a gift) the sheet can only model as a recurring annual amount, which smears it across every fortnight of the plan |
| Income tax + HELP + Medicare estimate | ✅ Have | App is richer: LITO, Medicare low-income phase-in + surcharge, private hospital, marginal HELP with cap, employment-termination concessions (genuine redundancy, ETP, unused leave) delivered as an offset, versioned FY config |
| Six budget groups (Needs/Wants/Discretionary/Temporary/Savings/Investments) | ✅ Have | Exact same groups |
| Amount + frequency → fortnightly + annual normalisation | ✅ Have | Same frequencies, plus every-N-weeks and every-N-months cadences the sheet lacks |
| Summary reconciliation: after-tax − outgoings − savings = buffer | ✅ Have | Same running After Outgoing / After Saving ledger |
| Per-category portion of after-tax income | ✅ Have | Rendered per budget group in the Summary ledger |
| Allocation ranking + `Unallocated` | ✅ Have | Summary allocation donut with remaining/unallocated |
| Savings goals | ✅ Have | App richer: target date, current balance, contribution link, progress + ETA |
| **Payment-method tag per bill** (Debit/Transfer/Card/Saver) | ➖ Not planned | Deliberate non-gap — the household keeps this in the sheet |
| **Itemised sub-budget under a line** (Gifts by occasion/recipient) | ✅ Have | Two roll-ups feed derived budget lines: generic breakdowns (a user-created itemised list owning one line via `budget_line.breakdown_id`) cover any list, and gifts are a standalone roll-up keyed by `budget_line.is_gift_line`, derived straight from the gift tables in the Gifts tab. App richer: the gift planner records purchases against each budget — hand-entered or linked from a synced Up card transaction — and keeps a member's own gifts private from them |
| **Wishlist** (per-member aspirational purchases) | ❌ Missing | No wishlist surface |
| **Finance-admin to-do list** | ➖ Not planned | Deliberate non-gap — the household keeps this in the sheet |
| **Free-text notes on a budget line** ("Spendings" scratch list) | ❌ Missing | Budget lines have no notes field |
| Per-member breakdown of discretionary spend / wishlist / gifts | 🟨 Partial | App pools money by explicit design; per-line member tagging is deliberately out of scope, though gifts do partition by recipient — one derived line per member with gift budgets plus one for external recipients. Itemisation is covered by breakdowns; free-text notes are not |

## 3. Prioritised gap list

Ordered by value. Size is rough (S ≤ ~½ day, M ~1–2 days, L larger). "Backend"
means a schema/migration/RLS/types change; "frontend" means PWA-only.

1. **Generic itemised sub-budget (line-item breakdown)** — _shipped as
   breakdowns._ A user-created breakdown holds items (name + amount + frequency)
   that roll up into a single derived budget line via `budget_line.breakdown_id`,
   covering any itemised list (e.g. the "Spendings" scratch list, medications);
   breakdowns are generic-only, `breakdown_kind` being a single-value enum. Gifts
   are a separate standalone roll-up keyed by `budget_line.is_gift_line` with
   `breakdown_id` null, derived from the gift tables by the reconcile pass — one
   line per household member with gift budgets plus one for external recipients —
   and managed solely in the Gifts tab. See [`breakdowns.md`](breakdowns.md) and
   [`roadmap.md`](roadmap.md).

2. **Wishlist** — a per-member list of aspirational purchases (name + amount),
   separate from the budget, that can later graduate into a Discretionary line or
   a savings goal. _Why:_ it is a standalone sheet the household keeps; it also
   feeds future budgeting decisions. _Size:_ S–M. _Backend + frontend_ (new
   `wishlist_item` table with optional `member_id` tag + a simple screen/section).

3. **Free-text note on a budget line** — the "Spendings" scratch annotations.
   _Why:_ small quality-of-life; lets a line carry context without a full
   breakdown, which covers any line whose detail is itemisable. _Size:_ S.
   _Backend + frontend_ (nullable `notes` text column + textarea).

**Deliberate non-gaps** (documented, not to build): a **payment-method tag per
bill** (Debit / Transfer / Card / Saver) and a **finance-admin to-do list** — the
household keeps both in the spreadsheet, and neither needs to move into the app.
The app's tax engine already exceeds the sheet's flat-Medicare / no-offset model —
which has no notion of a payment that lands once, let alone the concession one
carries;
app Goals already exceed the sheet's flat target list; and per-person *budget*
splitting is intentionally out of scope (money is fully pooled — member tags are a
tax/reporting concept only). Wishlist still warrants an optional per-member tag
for display, without implying per-person budgets; gift recipients carry one via
`gift_recipient.member_id`.

## 4. Recommended next builds

1. **Wishlist (gap 2)** — self-contained, low-risk, restores a whole sheet the
   household uses.

Gap 3 (line notes) is optional: a breakdown already covers a line whose detail is
itemisable.
