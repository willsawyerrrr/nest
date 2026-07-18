# CLAUDE.md

## Purpose

Household budgeting app for two people: income tracking, full AU income-tax
modelling, spending plans, and savings goals. See [`README.md`](README.md) and
[`docs/`](docs/) for scope and design.

## Fixed scope decisions

- Platform: one PWA for both iOS (installed via Safari) and web. No native app.
- Backend: Supabase (Sydney, Pro) — Postgres, Auth, PostgREST, Edge Functions,
  Vault. Direct PostgREST + RLS for CRUD; edge functions for tax engine + Up sync.
- Frontend: React PWA (TypeScript); one frontend for iOS + web.
- Auth: Supabase Auth via Google OAuth (consent screen published).
- Language: TypeScript across PWA and edge functions; tax engine is a shared
  package.
- Transaction sources: Up Bank API + manual entry; ingestion is source-agnostic.
- Tax: full AU income tax, versioned per financial year.

## Conventions

- Money is stored as integer minor units (cents); never floats.
- Financial year = AU FY (1 Jul – 30 Jun), labelled by the ending year.
- Tax rates/thresholds live in versioned config, never hardcoded in logic.
- Commit messages: Conventional Commits, first word capitalised, scoped where it
  helps (e.g. `feat(tax): Add LITO taper`).
- Feature work on branches → PRs; keep `main` releasable.
