---
name: run-dev-app
description: Launches and drives the nest PWA locally — local Supabase stack, migrations, a seeded dev household, a signed-in session, and the Vite dev server, in one command. Use this whenever asked to run, start, or try out the app locally.
---

# Running the app locally

Auth is Google OAuth only in production (see `CLAUDE.md`), which has nothing
to sign in with in a fresh local Supabase stack. `scripts/dev-app.js` works
around that by seeding a two-member household and minting a one-time
magic-link sign-in via GoTrue's admin API — no Google client needed.

## Launch

From the repo root:

```sh
pnpm dev
```

This starts the local Supabase stack (Docker — must already be running),
applies any pending `supabase/migrations/*.sql`, seeds "Local dev household"
with members Alice (`alice@dev.local`) and Bob (`bob@dev.local`) if they don't
already exist, prints a one-time sign-in link for Alice, and starts the PWA
dev server on `http://127.0.0.1:5173`.

Idempotent — safe to rerun any time, including after `supabase db reset` (it
recreates whatever the reset wiped) or with the stack already up.

Pass `--port=<n>` to use a different port; `supabase/config.toml`'s
`auth.additional_redirect_urls` only allow-lists `5173` (and `3000`), so a
custom port needs adding there too or the sign-in link's redirect will be
rejected.

## Drive it

1. Run `pnpm dev` and read its output for the sign-in link, e.g.:
   `http://127.0.0.1:54321/auth/v1/verify?token=...&type=magiclink&redirect_to=http://127.0.0.1:5173`
2. Open that link in a browser (or fetch it, or use `claude-in-chrome` to
   navigate to it) — it redirects into the running app already signed in as
   Alice, inside "Local dev household".
3. The link is single-use and short-lived. Rerunning `pnpm dev` (or the script
   directly: `node scripts/dev-app.js`) prints a fresh one without disturbing
   already-seeded data.

To add fixtures beyond the two members (a gift budget, a payslip, an inflow —
whatever the feature under test needs), seed them directly against the local
REST API or with `psql "$(pnpm exec supabase status -o json | jq -r .DB_URL)"`
after `pnpm dev` has the stack up; `scripts/dev-app.js` only seeds enough to
log in.

## Stopping

The dev server runs in the foreground under `pnpm dev` — Ctrl+C stops it. The
Supabase stack keeps running afterwards (`pnpm supabase stop` to stop it);
leaving it up is normal between sessions.
