# EOFY sharing

Letting a household give a tax agent a read-only look at its EOFY summary
without inviting them into the app. A household member creates a **share**
from the EOFY tab: a 7-day, single-active, financial-year-scoped link the tax
agent opens directly, no Supabase account or Google OAuth. The link mirrors
the household's own EOFY tab exactly — the same per-member tax estimate,
withholding position, deductions with receipts, super contributions, HELP
debt, and payslip documents — because it is assembled by the same client-side
composition, over rows sourced from a different, unauthenticated path.

## Why not a member, and why not a raw export

- **Not a household member.** `join_household` makes a redeemer a full,
  permanent peer with the same read/write access as everyone else — there is
  no partial/scoped join, and building one would touch every RLS policy in
  the schema for one narrow, temporary use. A tax agent needs a look, not a
  seat.
- **Not a plain export.** A PDF or CSV the household emails themselves has no
  new security surface, but it is point-in-time, has no drill-down into
  receipts or payslip documents, and the household must remember to
  re-export it whenever a figure changes. A live link degrades better.
- **A scoped, time-limited, read-only bearer token** is the middle ground:
  new to the schema, but it follows the temporary-invite-code idiom (opt-in,
  expiring, minted/revoked by a SECURITY DEFINER RPC) and the balance-privacy
  helpers' idiom (a SECURITY DEFINER function narrowing what a request can
  see) already established elsewhere.

## Data model

One table, `share_grant` (`supabase/migrations/20260831000000_share_grant.sql`):

- **`household_id` is the primary key.** At most one live share per
  household is a schema-level guarantee, not an application convention.
  Creating a new share replaces any existing one (`on conflict (household_id)
  do update`); there is no history or audit list.
- **`token_hash`**, not the token itself. The plaintext token — two
  concatenated, dash-stripped `gen_random_uuid()`s (64 hex chars, ~244 bits)
  — is returned once by `create_share_grant` and never stored; only
  `sha256(token)` hex is kept, so a leaked database row alone cannot redeem
  the share. The household's own PWA cannot recover a lost link either — it
  never persists it beyond the moment it was minted.
- **`financial_year`**, **`recipient_email`**, **`expires_at`** (7 days from
  creation), **`created_by_member_id`** (`on delete set null`), and
  `created_at`.
- **RLS is tighter than the invite-code precedent**, since this token gates
  real tax data. Household members may `select` their own share, but a
  column-level grant withholds `token_hash` even from them
  (`grant select (household_id, financial_year, recipient_email, expires_at,
  created_at) on public.share_grant to authenticated`) — the credential
  itself is never client-readable. There is no insert/update/delete grant to
  `authenticated` at all: every write goes through `create_share_grant` /
  `revoke_share_grant` (SECURITY DEFINER), so a direct PostgREST write is
  impossible.
- **`service_role` reads `share_grant` by `token_hash`**, plus the seven
  source tables `eofy-share` assembles (`members`, `inflows`, `tax_profile`,
  `super_contribution`, `super_profile`, `help_debt`, `deduction`,
  `deduction_receipt`, `payslip`) — surgical per-feature grants, following
  `docs/operations.md`'s `service_role` grants stance.

## Edge functions

Three functions under `supabase/functions/`, documented in full in
[`../supabase/functions/README.md`](../supabase/functions/README.md#eofy-sharing):

- **`share-create`** (JWT-verified) mints or replaces the household's share by
  running `create_share_grant` as the caller's own JWT-scoped client, then
  emails the link via Resend when `resend_api_key` is configured — minting
  the grant either way, so an email failure never leaves the household
  without a link.
- **`eofy-share`** (`verify_jwt = false`) resolves the bearer token against
  `share_grant` and returns the same raw rows the household's own EOFY tab
  loads, scoped to the token's household (and, for the FY-scoped tables, its
  financial year) with a service-role client.
- **`eofy-share-file`** (`verify_jwt = false`) signs a 5-minute Storage URL
  (shorter than the household's own hour-long ones) for one deduction
  receipt or payslip document — its own database scope check, not Storage
  RLS, is the entire boundary here, since an anonymous bearer has no
  `auth.uid()` for Storage's household-membership policy to match either way.

`_shared/shareGrant.ts` resolves a token for both anonymous functions,
reporting the identical generic 401 whether it is malformed, matches
nothing, or has expired — never distinguishing "expired" from "never
existed" in the response.

## PWA composition

`EofyScreen.tsx` stays the single source of truth for what an EOFY summary
looks like. Its prop surface is additive over what `EofySection.tsx` (the
authenticated tab) already passed it:

- `showTabLinks` (default `true`) hides the Tax/Payslips/Deductions/Super/
  HELP debt anchor links on the shared route, which point at authenticated
  pages a tax agent has no session for.
- `disclaimerNote` renders a second dimmed line beside the existing
  "excludes capital gains tax" note — the shared route's estimates-not-a-
  filed-return caveat.
- `members` narrows to `Pick<Member, 'id' | 'name'>[]`, which the shared
  payload's `{id, name, date_of_birth}` rows (see below) satisfy
  structurally, without a parallel prop.
- `payslipDocuments` / `payslipSignedUrl` add an optional "Payslip
  documents" subsection per member, fed by `usePayslips`' existing
  `signedUrl` on the authenticated route and by `eofy-share-file` on the
  shared one.

`EofyShareSection.tsx` (the `/share/eofy/:token` route) is `EofySection.tsx`'s
mirror: `useEofyShareData` reads `eofy-share`'s response, typed exactly as
the existing hooks' row types, and the same `estimateHouseholdTaxFromRows` /
`superCapSummaryFromRows` / `helpPayoffByMember` / `paygWithheldFromRows` /
`payslipCountByMember` pure functions in `lib/tax.ts` / `lib/payslips.ts` run
over it unmodified. This is what makes the shared view mirror the
authenticated one **by construction** rather than by two implementations
staying in sync — there is no server-side EOFY view or a second tax
computation in Deno.

One correctness detail this forced: `estimateHouseholdTaxFromRows` prices a
one-off termination payment's tax-free amount against the member's age at
the payment date (`members[].date_of_birth`), so `eofy-share`'s `members`
query carries `date_of_birth` alongside `id`/`name` — never email or
user_id, and never rendered — so the shared estimate cannot silently
diverge from the household's own for a redundancy near preservation age.

`App.tsx` matches `/share/eofy/:token` in its own top-level `<Routes>`,
ahead of the session gate (renamed `AuthGate`, otherwise unchanged): a tax
agent opening a shared link never calls `supabase.auth.getSession()`.
`EofyShareSection` is lazy-loaded like every other route and imports nothing
from `supabase.auth`.

`EofyShareControl.tsx`, wired into `EofySection.tsx` above the EOFY summary,
is the household-facing half: an email + financial-year form when no share
is active, and — once one is — an "Active, expires in N days" summary with a
Revoke button. The plaintext link is shown, with a Copy button, only in the
same render pass it was just minted in (the "returned once" treatment the
VAPID/push keys already use): the app never stores it, so it cannot be
recovered on a later visit even by the household that created it.

## Risks and mitigations

- **Token leakage** (forwarded or misdelivered email): bounded by the 7-day
  expiry, the household's own Revoke, and the token's read-only/EOFY-only/
  single-financial-year scope. `apps/pwa/vercel.json` sets
  `Referrer-Policy: no-referrer` on `/share/*`, since the token sits in the
  URL path and a `Referer` header would otherwise leak it to whatever the
  tax agent's browser fetches next.
- **Token brute-forcing**: 64 hex characters (~244 bits) is infeasible to
  guess; no rate limiting was added for v1.
- **Storage over-exposure**: `eofy-share-file`'s scope check (household
  prefix, then a database lookup tying the path to a deduction or payslip in
  the grant's own household and financial year) is the entire security
  surface for file access — see its `file_test.ts` for the cases exercised
  (another household, an out-of-scope financial year, no matching row).

## Out of scope / future

- Financial-planner sharing (goals, budget plan, net worth) — EOFY-only for
  v1; a planner view would need the same client-side-composition treatment
  built fresh, not reuse `EofyScreen`.
- Per-member share scope — a share always covers the whole household's EOFY
  data for its financial year.
- Share history / audit log — single active share only.

## Status

Built and deployed. `share_grant` (migration
`20260831000000_share_grant.sql`) with its `create_share_grant` /
`revoke_share_grant` RPCs and `resend_api_key()` Vault read; the
`share-create` / `eofy-share` / `eofy-share-file` edge functions; the
additive `EofyScreen.tsx` props; `useShareGrant.ts` /
`EofyShareControl.tsx` on the EOFY tab; `useEofyShareData.ts` /
`EofyShareSection.tsx` behind `/share/eofy/:token`; and the `App.tsx`
routing split so the public route bypasses the session gate.
