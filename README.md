# Nest

A household budgeting app for two people to track incomes, model Australian tax
liability, plan spending, and track savings goals.

## Goals

- **Income tracking** — record each person's income (salary, other) with gross,
  tax withheld, and super.
- **Tax** — estimate full AU income tax liability per person per financial year
  (marginal brackets, Medicare levy + surcharge, HECS/HELP, offsets) and compare
  against tax already withheld.
- **Spending plans** — budget by category and period; track actuals against plan.
- **Savings goals** — set targets with dates and track progress.
- **Wishlist** — a per-item list of aspirational purchases kept apart from the
  budget, each promotable to a savings goal or a Discretionary budget line.
- **Superannuation & net worth** — model per-person super (contributions, caps,
  Division 293, co-contribution) with its tax impact and a retirement projection,
  and total balances into a net-worth view.
- **Gifts** — a first-class Gifts tab: a unified planner of gift budgets by
  recipient × occasion with a purchase log fed by hand or by linking gift-category
  card spend synced from Up, each recipient's spend private from them.
- **Breakdowns** — user-created itemised lists (medications, any costed list) that
  roll up into a single derived budget line.
- **Pay splits** — route each budget line to the Up account that funds it and get
  a recommended fortnightly pay split per account to type into Up.

## Scope decisions

A pitch-level summary; the full locked list is canonical in
[`CLAUDE.md`](CLAUDE.md#fixed-scope-decisions).

- **Platform:** a single React PWA serving both iOS (installed via Safari) and
  web, with Supabase Auth via Google OAuth.
- **Backend:** [Supabase](https://supabase.com/) (Sydney region, Pro) — managed
  Postgres, Auth, PostgREST, Edge Functions, Vault. Clients use direct PostgREST
  with Row-Level Security for CRUD; edge functions handle the tax engine and Up
  sync. See [`docs/architecture.md`](docs/architecture.md).
- **Language:** TypeScript across the PWA and edge functions; the tax engine is a
  shared package used by both.
- **Transaction sources:** [Up Bank API](https://developer.up.com.au/) feeds +
  manual entry. Import layer designed to accept other sources later.
- **Tax:** full AU income tax modelling, versioned per financial year.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — system shape, integrations,
  security model, and CI.
- [`docs/data-model.md`](docs/data-model.md) — entities, relationships, and RPCs.
- [`docs/operations.md`](docs/operations.md) — runbook: where it runs, what
  deploys it, and per-service setup.
- [`docs/tax.md`](docs/tax.md) — AU tax modelling design.
- [`docs/budget-and-savings.md`](docs/budget-and-savings.md) — plan-only budget,
  savings, the wishlist, and Summary math.
- [`docs/super-and-net-worth.md`](docs/super-and-net-worth.md) — super modelling
  and the net-worth view.
- [`docs/breakdowns.md`](docs/breakdowns.md) — user-created itemised derived lines.
- [`docs/pay-splits.md`](docs/pay-splits.md) — routing lines to Up accounts and the
  recommended pay split.
- [`docs/up-ledger-sync.md`](docs/up-ledger-sync.md) — the Up transaction ingestion
  + reconciliation phase.
- [`docs/payslips.md`](docs/payslips.md) — expected vs actual income and tax from
  payslips.
- [`docs/planning-mode.md`](docs/planning-mode.md) — the non-persisted what-if
  sandbox over pays, bills, and savings goals, the inline real-vs-proposed
  deltas, and the `/planning` summary screen.

Planned and in-progress work is tracked in the
[Nest project in Linear](https://linear.app/willsawyerrrr-dev/project/nest-277c083e9a78).

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
pnpm install   # install all workspaces
pnpm dev       # start the local Supabase stack, apply migrations, seed a dev
               # household, and run the PWA — prints a sign-in link, no Google
               # OAuth needed locally
```

`pnpm dev` (`scripts/dev-app.js`) is idempotent — rerun it any time. It applies
pending migrations only; pass `pnpm dev --reset` to drop the local database and
replay every migration when the schema has drifted from `supabase/migrations/`.
To drive the pieces separately instead:

```sh
cp apps/pwa/.env.example apps/pwa/.env   # fill in Supabase URL + anon key
pnpm --filter @nest/pwa dev              # run the PWA
pnpm supabase start                      # start the local Postgres/API stack (Docker)
```

`apps/pwa/src/lib/database.types.ts` is generated from the schema. After changing
a migration, regenerate it against an up-to-date local stack and commit the
result; CI fails when it drifts:

```sh
pnpm dev --reset   # if the local schema is behind the migrations
pnpm db:types      # regenerate apps/pwa/src/lib/database.types.ts
pnpm check:types   # what CI asserts — no diff against the migrations
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
retirement projection) and a net-worth view are live, as are user-created
breakdowns (itemised lists that roll up into a derived budget line), a first-class
Gifts tab (a unified recipient × occasion planner whose budgets roll up into derived
budget lines per recipient), pay splits (per-account fortnightly split
recommendations against routed budget lines), and an in-app "What's new" changelog.
The Up savers → savings-goals layer is also live: members connect an Up token and
link a goal to a synced Up saver, so goal progress tracks the real balance (synced
on demand and hourly). The same sync ingests one slice of the ledger: each member's
gift-category card spend, which the Gifts tab offers as candidate purchases to link
against a gift budget. Ingestion across every category plus reconciliation (ledger
UI, actual spend vs budget, actual tax paid) is the next phase, designed in
[`docs/up-ledger-sync.md`](docs/up-ledger-sync.md) and tracked in
[Linear](https://linear.app/willsawyerrrr-dev/project/nest-277c083e9a78). See
[`docs/operations.md`](docs/operations.md) for what is deployed and how.
