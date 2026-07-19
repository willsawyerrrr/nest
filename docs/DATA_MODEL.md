# Data model

Relational, stack-agnostic. Amounts are integer minor units (cents). All
foreign keys implied by the relationships below.

> This is the conceptual model. The implemented planning schema (inflows, budget
> lines, temporary items, savings goals) is described concretely in
> [`budget-and-savings.md`](budget-and-savings.md) and the `supabase/migrations/`
> files; where the two differ, the migrations are authoritative.

## Household & members

- **Household** — the shared container for two people.
  - `id`, `name`, `timezone` (e.g. `Australia/Sydney`), `created_at`.
  - `invite_code` (nullable; a single-use code a partner redeems to join) and
    `invite_code_expires_at` (nullable) — temporary and opt-in, so both are null
    when no code is active.
- **Member** — a person in the household.
  - `id`, `household_id`, `name`, `email`, `auth_subject`, `created_at`.
  - A member owns income records, payslips, tax profiles, and linked bank tokens.

## Accounts & transactions

- **Account** — a bank/savings account.
  - `id`, `household_id`, `owner_member_id` (nullable for joint), `name`,
    `type` (`transaction` | `savings` | `credit` | `offset` | `other`),
    `source` (`up` | `manual` | …), `external_id`, `balance_cents`, `currency`.
- **Transaction** — a single ledger entry.
  - `id`, `account_id`, `household_id`, `posted_at`, `amount_cents`
    (signed: negative = outflow), `description`, `kind`
    (`income` | `expense` | `transfer`), `category_id`, `member_id`
    (attribution), `source`, `external_id` (dedupe key), `status`
    (`pending` | `settled`), `notes`.
  - Transfers between own accounts are excluded from spend/income reporting.
- **Category** — spending/income taxonomy.
  - `id`, `household_id`, `name`, `parent_id` (hierarchical), `kind`
    (`income` | `expense`), `is_archived`.
  - Seeded from Up's categories, then user-editable.
- **CategoryMapping** — maps a source category to a household category.
  - `id`, `source`, `source_category`, `category_id`.

## Income & tax inputs

- **IncomeSource** — a recurring income (employer, etc.).
  - `id`, `member_id`, `name`, `type` (`salary` | `business` | `investment` | …).
- **Payslip / IncomeEvent** — a dated income record feeding tax.
  - `id`, `member_id`, `income_source_id`, `financial_year`, `paid_at`,
    `gross_cents`, `paye_withheld_cents`, `super_cents`, `pre_tax_deductions_cents`.
- **TaxProfile** — per member per financial year, drives the tax engine.
  - `id`, `member_id`, `financial_year`, `residency` (`resident` | `non_resident`),
    `has_private_health` (for Medicare levy surcharge), `help_debt_cents`
    (HECS/HELP balance), `claims_tax_free_threshold`, `other_income_cents`,
    `deductions_cents`.
- **TaxYearConfig** — versioned AU tax parameters (see [`TAX.md`](TAX.md)).

## Planning & goals

- **Budget** — a spending plan for a period.
  - `id`, `household_id`, `period` (`monthly` | `fortnightly` | `annual`),
    `starts_on`, `member_scope` (household | member).
- **BudgetLine** — a planned amount per category.
  - `id`, `budget_id`, `category_id`, `planned_cents`.
  - Actuals derived by summing settled transactions in the category/period.
- **SavingsGoal** — a target to save toward.
  - `id`, `household_id`, `name`, `target_cents`, `target_date`,
    `linked_account_id` (nullable), `current_cents` (derived or manual),
    `member_scope`.

## Derived / computed (not stored)

- Spend vs budget per category/period.
- Savings-goal progress and required contribution rate.
- Tax estimate vs withheld (from tax engine over `TaxProfile` + income events).
