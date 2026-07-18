# Personal Budget Application

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

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system shape and integrations.
- [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) — entities and relationships.
- [`docs/TAX.md`](docs/TAX.md) — AU tax modelling design.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — phased delivery plan.

## Status

Planning (Phase 0) complete — stack settled end to end. Next: Phase 1 (ledger
core) — Supabase project, schema + RLS, and the React PWA shell.
