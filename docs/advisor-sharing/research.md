# Research: Sharing household data with a financial professional

## Task statement

"I want to be able to make some of the information available to a financial
professional, whether it's plans/goals to a financial planner or EOFY details
to a tax agent. Put some research into ways to export that information or
ways to authenticate a tax agent to have a look at the information."

## Findings

### 1. What data exists today, per audience

**Tax agent — EOFY tab** (`apps/pwa/src/components/EofyScreen.tsx`, wired by
`apps/pwa/src/routes/EofySection.tsx`, route `/eofy`):

- Speced in `CLAUDE.md` as a read-only, aggregating, per-financial-year view
  — "no new tables, no actual-paid-tax tracking, and no checklist state."
- Per member, per FY: full tax estimate breakdown (taxable income, income
  tax, Medicare levy + surcharge, HELP repayment, Division 293, total
  liability, net take-home), the withholding/refund-or-bill position (from
  payslips), claimed deductions with amounts/dates/receipt links, super
  contributions against cap warnings, and standing HELP balance + this
  year's estimated repayment.
- Composed client-side in `EofySection.tsx` from six hooks (`useInflows`,
  `useTaxProfiles`, `useSuperContributions`, `useSuperProfiles`,
  `useHelpDebts`, `useDeductions`, `useDeductionReceipts`, `usePayslips`)
  plus `@nest/tax` pure functions — there is no server-side EOFY view or
  RPC, it's assembled entirely in the browser from RLS-scoped reads.
- Deduction receipts are private Storage objects, accessed via
  `signedUrl()` threaded down from `useDeductionReceipts`.

**Financial planner — goals / budget plan / net worth**:

- Goals: `savings_goal` table, rendered by `GoalScreen.tsx` / `GoalList.tsx`.
- Budget plan: `budget_line` table, `BudgetScreen.tsx`/`BudgetLineList.tsx`
  — fortnightly plan across Needs/Wants/Discretionary/Temporary/Savings/
  Investments groups.
- Net worth: `NetWorthView.tsx` / `lib/netWorth.ts` — assets (visible
  account balances, vested equity) less liabilities (HELP debt), already
  respecting the per-account balance-privacy boundary.
- Summary: `SummaryView.tsx` — the top-level plan-vs-buffer view.
- No existing "planner view" aggregation screen analogous to EOFY — it
  would need to be assembled the same way EOFY was (a new presentational
  screen fed by existing hooks), not new tables.

### 2. Existing export/PDF/CSV code: none

- No export/report generation code anywhere in `apps/pwa/src` or
  `supabase/functions`. Every "pdf" hit is the receipt/payslip-attachment
  MIME-type allow-list; every "download" hit is downloading an attached
  file blob from Storage.
- No `jspdf`, `papaparse`, `file-saver`, or similar dependency.
- Prior art exists only as an **unbuilt roadmap idea**: `docs/roadmap.md`
  "Data export & backup (CSV / spreadsheet)" — scoped as a household-facing
  backup/escape hatch, not an advisor-sharing feature ("client-side CSV
  generation from data already loaded, or an edge function for a full
  dump… the only care is not leaking another household's data"). Closest
  existing plan and a natural building block, but never scoped as a
  professional-access mechanism.

### 3. Prior art in docs/: no advisor/accountant/share feature exists

No mention anywhere in `docs/` of a third-party access model, a share link,
or a lesser member role. Hits for "share"/"planner" are unrelated (shared
account ownership, the in-app budget/gift planner UI).

### 4. The existing invite-code pattern — closest analogue

- `supabase/migrations/20260719000000_temporary_invite_codes.sql`: invite
  code is opt-in, temporary (7-day expiry), single-use, minted by
  `create_invite_code()`, cleared by `revoke_invite_code()`, consumed
  atomically on `join_household`.
- **`join_household` makes the caller a full, permanent household member**
  — no partial/scoped join exists. Every table's RLS treats `members` as a
  trusted peer, subject only to the balance-privacy boundary (which exists
  between co-members, not for a lesser class of member).
- Requires the redeemer to already be Google-OAuth-authenticated
  (`auth.uid()` not null) before redeeming — no email delivery of the code.
- **No email infrastructure exists anywhere in the app.** The `changelog`
  function and Web Push are the only outbound-comms mechanisms, neither
  sends email. Any flow assuming "email them a link" needs net-new infra
  (e.g. Resend/Postmark via an edge function + a Vault secret), a real gap.

### 5. Security model an advisor-sharing feature must respect

- **RLS is the only boundary today; no per-row "share this record" concept
  exists.** Every policy is `household_id in (select
  household_ids_for_current_user())` — binary: full member or nothing.
- **Balance-privacy boundary** (`visible_balance_account_ids()`,
  `current_member_ids()`, `household_super_account_ids()`, all `SECURITY
  DEFINER`) is the precedent for a narrower-than-full-member view — the
  idiom (SECURITY DEFINER helper returning id sets, consumed by per-command
  RLS policies) any new boundary should follow.
- **Gift privacy** (`hidden_gift_*_for_current_member()`) is the second
  precedent: data hidden from one specific member while visible to others.
- **No table has a role/capability column** — `members` is `id,
  household_id, user_id, name, email, created_at, updated_at`. A
  "limited/read-only member" role would touch every RLS policy in the
  schema, not a small addition.
- **Storage** access is gated by `household_id` prefix match — a scoped
  share needs its own Storage access path (signed URLs, as already used
  for receipt viewing), since the blanket "any household member" policy
  has no narrower gate to reuse.
- **`push_subscription`** is the one existing precedent for a table scoped
  below household level (`current_member_ids()`-only RLS) — the pattern
  for "this belongs to one identity, not the household."

### 6. Option shapes, evaluated against that model

**A. Manual export the household does themselves** (PDF/CSV of EOFY or
goals/plan, sent via the household's own email/other channel):
- Lowest effort, zero new security surface — client-side rendering of data
  the signed-in member can already see (balance-privacy already applied,
  since rendered from the same RLS-scoped hooks). No new auth model at
  all — the professional never touches the app or Supabase.
- Point-in-time only, no drill-down, household must remember to re-export.
  Sidesteps the "no email infra" gap entirely since the app never sends
  anything itself.

**B. Scoped, time-limited, read-only share link a professional opens
without a Supabase account:**
- Needs a new table (e.g. `share_grant`: household_id, scope, financial
  year or snapshot flag, token, expires_at, created_by, revoked_at)
  mirroring the temporary-invite-code idiom but issuing a bearer token for
  a *read path*, not household membership.
- Needs a public (`verify_jwt=false`) edge function validating the token
  server-side (service-role client, deliberately bypassing RLS — same
  trust model as `up-webhook`) and returning a pre-shaped, minimal
  payload. Every existing function authenticates the caller as a household
  member first; none serves an anonymous bearer-token holder — new, not
  reused, but follows the existing function scaffolding.
- Most literal match to "authenticate a tax agent," most novel relative
  to the current codebase.

**C. Invite the professional as a genuine (limited) household member:**
- Reuses `join_household`'s exact mechanics but needs `members` to carry a
  role column and **every RLS policy in the schema** to branch on it — the
  biggest lift of the three. Forces the professional through the
  household's Google OAuth. Only option offering live, always-current data
  without a re-share step. Collides with the "member is a trusted peer"
  framing baked into the whole schema.

**D. Signed/downloadable export bundle** (app-generated file, sent by the
household via their own email) — effectively (A) with nicer packaging
(PDF letterhead, zip of CSVs); same trust profile, same "no new auth."

### 7. Constraints recap

- PWA-only, no native app — any advisor-facing surface is either the same
  PWA in an unauthenticated mode, or a plain downloadable file.
- Migrations/functions auto-deploy on merge to `main`, drift-checked every
  6 hours — new tables/RPCs/functions follow that same pipeline.
- No email infrastructure anywhere today — the single biggest constraint
  on any "invite by email" flow (option B/C); net-new infra is a scope
  decision in its own right, separate from the sharing feature itself.
- Edge functions: `index.ts` (wiring/auth) + pure logic module + tests,
  authenticated via `resolveCaller`/JWT inspection or a service-role
  bearer check, deployed automatically. A new "advisor read" function
  would be the first designed to be called by a non-household-member
  bearer.

## Decisions (resolved with product owner)

1. **Scope for v1**: EOFY only, for a tax agent. Goals/plan sharing for a
   financial planner is out of scope for this feature.
2. **Mechanism**: option B — a scoped, time-limited, read-only share link
   the tax agent opens directly, no Supabase account or Google OAuth
   required. Modelled as a new concept (`share_grant`-shaped table), not
   by stretching `members`/invite-codes.
3. **Email delivery is in scope**: the app sends the share link itself,
   to an email address the household types in when creating the share.
   Needs net-new infrastructure — a transactional email provider (e.g.
   Resend), a Vault-held API key, and an edge function, following the
   `push-key`/`vapid_keys()` pattern for secret handling.
4. **Expiry**: 7 days, auto-expiring (matching the existing invite-code
   TTL), plus a manual revoke the household can trigger early.
5. **Member scope**: always both members — no per-member picker for v1.
   A share covers the whole household's EOFY data for the FY it's scoped
   to.
6. **Financial year scope**: a share is scoped to one financial year
   (the household picks which FY when creating it, mirroring the EOFY
   tab's own FY selector) — never "every year," since a stale prior-year
   share is a stale liability.
7. **Interactivity**: the shared view mirrors the EOFY tab itself —
   rolled-up figures plus the ability to open attached receipts/payslips
   via short-lived signed URLs, not just static numbers.
8. **Share management**: single active share only, no history/audit list.
   Creating a new share replaces any existing one for the household
   (there is at most one live `share_grant` row per household at a time).
9. **Plan review**: happens inline in this chat, not via Notion — the
   Notion MCP tools this workflow normally uses aren't connected in this
   session (only an OAuth-gated proxy is).

## Remaining open questions (left to plan-time judgement)

- Exact wording/placement of the "figures are estimates, not filed
  returns" disclaimer on the shared view.
- Whether the share-creation UI lives on the EOFY tab itself (a "Share
  with your tax agent" action) or as its own small section.

## Assumptions

- "Financial professional" access is read-only in every option — no design
  gives an advisor write access, consistent with EOFY's own "nothing on
  the tab is editable" framing.
- The household's Google-OAuth-based auth is out of scope to change or
  extend (no magic-link/OTP for advisors) unless told otherwise — options
  A/B/D avoid needing new household-side auth entirely.
- "Export" means a rendered, human-readable artifact (report or CSV) of
  data already computed in-app, not a raw database dump — the roadmap's
  CSV-dump idea is a different, complementary feature.
