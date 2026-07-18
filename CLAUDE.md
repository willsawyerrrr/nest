# CLAUDE.md

## Purpose

Household budgeting app for two people: income tracking, full AU income-tax
modelling, spending plans, and savings goals. See [`README.md`](README.md) and
[`docs/`](docs/) for scope and design.

## Fixed scope decisions

- Platform: iOS + web on one shared backend.
- Data: cloud-hosted, managed, relational (Postgres assumed).
- Transaction sources: Up Bank API + manual entry; ingestion is source-agnostic.
- Tax: full AU income tax, versioned per financial year.
- Tech stack: **not yet chosen** — do not assume a framework until decided.

## Conventions

- Money is stored as integer minor units (cents); never floats.
- Financial year = AU FY (1 Jul – 30 Jun), labelled by the ending year.
- Tax rates/thresholds live in versioned config, never hardcoded in logic.
- Commit messages: Conventional Commits, first word capitalised, scoped where it
  helps (e.g. `feat(tax): Add LITO taper`).
- Feature work on branches → PRs; keep `main` releasable.
