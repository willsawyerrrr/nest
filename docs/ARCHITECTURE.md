# Architecture

Stack-agnostic view. The framework choice is deferred; this describes the
components and boundaries any chosen stack must satisfy.

## Components

- **Backend / API** — owns the domain model, tax engine, and integrations.
  Serves both the iOS and web clients over a single API. Enforces per-household
  data isolation (both members see the shared household; nobody else does).
- **Database** — cloud-hosted, managed, relational (Postgres assumed). Source of
  truth for accounts, transactions, plans, goals, and tax config.
- **iOS client** — native or cross-platform; consumes the API.
- **Web client** — consumes the same API.
- **Tax engine** — pure, versioned computation over a person's financial-year
  figures. No side effects; fully unit-testable. See [`TAX.md`](TAX.md).

## Integrations

### Up Bank API

- Personal access token per member (no CDR accreditation required).
- Pulls accounts and transactions; supports webhooks for near-real-time updates.
- Each member links their own Up token; transactions are attributed to that member
  and mapped into the shared household ledger.
- Reference: <https://developer.up.com.au/>

### Import layer

- A source-agnostic ingestion boundary. Up is the first adapter; CSV and other
  aggregators can be added without touching the domain model.
- Responsibilities: dedupe, categorise (map source categories → household
  categories), and attribute to a member.

## Cross-cutting concerns

- **Auth** — two accounts, one shared household. Consider provider-managed auth.
- **Secrets** — Up tokens and webhook secrets stored encrypted at rest.
- **Money** — store amounts as integer minor units (cents); never floats.
- **Time** — AU financial year (1 Jul – 30 Jun); store timestamps in UTC, present
  in the household's timezone (Australia/…).

## Open decisions

- Framework for backend and clients (see repo status).
- Auth provider.
- Hosting target.
