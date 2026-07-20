# Nest

A household budgeting app for two people to track incomes, model Australian tax
liability, plan spending, and track savings goals.

## Goals

- **Income tracking** — record each person's income (salary, other) with gross,
  PAYG withheld, and super.
- **Tax** — estimate full AU income tax liability per person per financial year
  (marginal brackets, Medicare levy + surcharge, HECS/HELP, offsets) and compare
  against tax already withheld.
- **Spending plans** — budget by category and period; track actuals against plan.
- **Savings goals** — set targets with dates and track progress.
- **Superannuation & net worth** — model per-person super (contributions, caps,
  Division 293, co-contribution) with its tax impact and a retirement projection,
  and total balances into a net-worth view.
- **Gift budgeting** — plan gift spend per recipient and occasion, track
  purchases, and roll the total into a derived budget line.

## Scope decisions

- **Platform:** a single React PWA serving both iOS (installed via Safari) and
  web, with Supabase Auth via Google OAuth.
- **Backend:** [Supabase](https://supabase.com/) (Sydney region, Pro) — managed
  Postgres, Auth, PostgREST, Edge Functions, Vault. Clients use direct PostgREST
  with Row-Level Security for CRUD; edge functions handle the tax engine and Up
  sync. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
- **Language:** TypeScript across the PWA and edge functions; the tax engine is a
  shared package used by both.
- **Transaction sources:** [Up Bank API](https://developer.up.com.au/) feeds +
  manual entry. Import layer designed to accept other sources later.
- **Tax:** full AU income tax modelling, versioned per financial year.

## Documentation

- [`docs/HANDOFF.md`](docs/HANDOFF.md) — operational handoff: what is live, where
  it runs, and how to work on it.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system shape and integrations.
- [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) — entities and relationships.
- [`docs/budget-and-savings.md`](docs/budget-and-savings.md) — plan-only budget,
  savings, and Summary math.
- [`docs/TAX.md`](docs/TAX.md) — AU tax modelling design.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — phased delivery plan.

## Repository layout

```
apps/pwa        React PWA (Vite, TypeScript) — iOS + web
packages/tax    Shared, pure tax engine (used by the PWA and edge functions)
packages/plan   Shared, pure budget / summary / goal math
supabase        Postgres migrations, edge functions, and local config
```

## Development

Requires Node ≥ 22, pnpm, and Docker (for the local Supabase stack).

```sh
pnpm install                 # install all workspaces
cp apps/pwa/.env.example apps/pwa/.env   # fill in Supabase URL + anon key
pnpm --filter @nest/pwa dev              # run the PWA
pnpm supabase start          # start the local Postgres/API stack (Docker)
```

Workspace-wide checks (also run in CI):

```sh
pnpm lint          # oxlint
pnpm format:check  # prettier
pnpm typecheck     # tsc across packages
pnpm test          # vitest across packages
pnpm build         # production build
```

## Status

The plan-only app — income + tax estimate, fortnightly budget, and savings goals
— is live in production and fully replaces the household's spreadsheet; it needs
no transaction data. Full superannuation modelling (concessional-contribution tax
impact, Division 293, contribution caps, government co-contribution, and a
retirement projection) and a net-worth view are live, as is gift budget tracking
(a per-recipient × occasion planner whose total feeds a derived budget line). The
Up savers → savings-goals layer is also live: members connect an Up token and link
a goal to a synced Up saver, so goal progress tracks the real balance (synced on
demand and hourly). Up transaction ingestion + reconciliation (ledger UI, actual
spend vs budget, actual tax paid) is the next phase. See
[`docs/ROADMAP.md`](docs/ROADMAP.md) and [`docs/HANDOFF.md`](docs/HANDOFF.md).
