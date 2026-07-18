# Architecture

## Stack

- **Backend platform:** [Supabase](https://supabase.com/) — managed Postgres,
  Auth, auto-generated REST API (PostgREST), Edge Functions (Deno/TypeScript),
  Vault (secrets), and Storage. Hosted in the **Sydney (AU)** region on the
  **Pro** tier (no project pausing; daily backups).
- **Clients:** a single **React PWA** (TypeScript) serving both iOS (installed
  via Safari → Add to Home Screen) and web. One frontend, no native app.
- **Frontend hosting:** [Vercel](https://vercel.com/) — the PWA's static build is
  deployed from the repo (Root Directory `apps/pwa`, Vite preset). Merges to
  `main` deploy to production; each PR gets a preview deployment. `apps/pwa/vercel.json`
  provides the SPA fallback rewrite. `VITE_SUPABASE_*` are set as Vercel env vars.
- **Shared code:** TypeScript packages shared between the PWA and edge functions
  (notably the tax engine).

Firebase and other document stores are out — the domain model is relational.

## Access pattern (hybrid)

Clients talk to the database in the way that fits each job:

- **Direct PostgREST + RLS** — plain CRUD the PWA does itself: transactions,
  categories, budgets, goals, accounts. No hand-written endpoints. Rules are
  enforced by DB constraints + Row-Level Security; correctness is aided by
  generated TypeScript types.
- **Edge functions (Deno/TypeScript)** — only what needs trusted server compute:
  - **Tax estimate** — authoritative computation.
  - **Up sync** — scheduled polling + webhook receiver; holds Up tokens.
- **SQL views / RPC** — derived reporting (spend-vs-budget, savings progress),
  callable through the auto-generated API.

Custom code is limited to the two things that genuinely need it; everything else
is CRUD over RLS.

## Components

- **Database** — Postgres, source of truth. Every domain row carries a
  `household_id`.
- **Auth** — Supabase Auth via **Google OAuth**. Two accounts, one shared
  household. The Google consent screen is *published* (basic email/profile scopes
  need no verification review) to avoid the 7-day refresh-token expiry of testing
  mode. Note the iOS standalone-PWA OAuth redirect quirk — the round-trip may
  return to Safari rather than the installed app; handled via redirect-URL config.
- **PWA** — consumes PostgREST directly (RLS-enforced) and calls edge functions
  for tax + Up.
- **Tax engine** — pure, versioned TypeScript package. Imported by the edge
  function (authoritative) and reused in the PWA for instant client-side preview
  — the *same* code, so no duplication or divergence. See [`TAX.md`](TAX.md).
- **Import layer** — source-agnostic ingestion boundary; Up is the first adapter.

## Integrations

### Up Bank API

- Personal access token per member (no CDR accreditation required).
- Tokens stored encrypted in **Supabase Vault**; never exposed to clients.
- **Webhook receiver** edge function for near-real-time updates; verifies Up's
  HMAC signature.
- **Scheduled poll** (pg_cron → edge function) as a backstop; dedupes on
  `external_id`.
- Each member links their own token; transactions are attributed to that member
  and mapped into the shared household ledger.
- Reference: <https://developer.up.com.au/>

## Security

- **RLS is the security boundary.** Policies grant access when `auth.uid()` maps
  to a member of the row's household; joint vs owner-scoped rows handled in
  policy. Tested deliberately (pgTAP / integration tests), not by inspection.
- Up tokens and webhook secrets encrypted at rest (Vault).

## Cross-cutting conventions

- **Money** — integer minor units (cents); never floats.
- **Time** — AU financial year (1 Jul – 30 Jun); store UTC, present in the
  household timezone (`Australia/…`).

## Local dev & delivery

- **Supabase CLI** runs the full stack locally in Docker; SQL migrations are
  version-controlled; TypeScript types are generated from the schema.
- Tax package and edge functions are unit-tested in CI.

## Next up (Phase 1)

- Supabase project (Sydney, Pro) + CLI local stack.
- Initial schema migrations and RLS policies (see [`DATA_MODEL.md`](DATA_MODEL.md)).
- React PWA shell with Google OAuth sign-in.
