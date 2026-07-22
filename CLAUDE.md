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
- UI framework: Mantine (React components + theming; system light/dark). The app
  is designed mobile-first — the primary device is an installed iPhone PWA.
- Frontend hosting: Vercel (Root Directory `apps/pwa`, Vite preset); auto-deploy
  on merge to `main`, preview deploys per PR.
- Auth: Supabase Auth via Google OAuth (consent screen published).
- Language: TypeScript across PWA and edge functions; tax engine is a shared
  package.
- Household & money: the two partners share ONE household with money fully
  pooled — no multi-household UI (no picker or switcher), no per-person budgets
  or splitting. All household members manage the shared planning data, and record
  attribution to a member is a tax/reporting tag, not a permission. `household_id`
  + RLS isolate the household's data from all other Supabase users; within the
  household, membership gates the shared and own data, with a per-account
  balance-privacy boundary on top — a member sees balances and transactions only
  for shared/joint, own, and household-super accounts, a co-member's spending
  account is visible by NAME ONLY (for routing) and their savers not at all, so a
  net-worth view sums only visible balances. The helper-function and
  view mechanics behind this live in architecture.md (Security) and data-model.md
  (the ledger tables and `account_directory`). A partner joins via a temporary, opt-in, single-use
  invite code (`create_invite_code` mints one, `join_household` redeems and
  consumes it, `revoke_invite_code` clears it); no email infrastructure.
- Inflows: the household owns many projection-based inflows, split by taxability
  — taxable income (salary, wage, or other regular income on a schedule — weekly
  through annual, or an arbitrary every-N-weeks or every-N-months cadence — each
  tagged to a member
  for tax) and non-taxable inflows (reimbursement, hobby income, gift, or other —
  the type is a reporting label, excluded from tax and added to available cash).
- Tax: full AU income tax, versioned per financial year; estimate-only
  (actual-paid tracking deferred), per-person, modelling HELP debt and
  private-hospital cover; target financial year FY2027. Each member's HELP/HECS
  balance is a single standing figure (the `help_debt` table, not FY-scoped),
  edited on its own HELP debt tab, that feeds the tax estimate and counts as a
  net-worth liability.
- Superannuation: modelled in full per person. Concessional contributions reduce
  taxable income and are taxed at 15% in the fund, with Division 293 for high
  earners; contribution caps (with manual carry-forward) and the government
  co-contribution are modelled, all from the versioned per-FY config alongside the
  tax config. Each member's balance is a dated baseline that auto-accrues modelled
  contributions between manual true-ups, seeds a net-worth view (assets less
  liabilities: account balances split into super and other, plus the vested value
  of each member's startup-equity grants, less each member's HELP debt; any
  account can be excluded via a shared household-wide flag that drops it from
  net-worth totals alone — not retirement projection or budgeting), and projects
  to retirement under client-side (localStorage) return/age assumptions.
- Equity: each member owns many startup-equity grants (options or shares) on their
  own Equity tab (the `equity_grant` table), with a cliff and vesting schedule.
  Entry is manual — there is no Cake or cap-table API — so the household maintains
  the current price per share itself. Only the vested portion is valued (options
  at their gain over the strike, shares at the price per share) and that vested
  value counts toward net worth as an asset. The vesting and valuation math is
  pure, in `@nest/plan`.
- Budgeting is plan-only and fortnightly: the household allocates projected
  after-tax income across grouped categories (Needs / Wants / Discretionary /
  Temporary / Savings / Investments) with a live remaining buffer; actual-spend
  reconciliation via Up ingestion is a later enhancement. Each line carries an
  amount on a frequency (weekly through annual, or an arbitrary every-N-weeks or
  every-N-months cadence, exactly as inflows do), normalised to fortnightly and
  annual. A budget
  line's amount can be **derived** — rolled up from a user-created **breakdown**
  (an itemised list) that owns the line via `budget_line.breakdown_id` rather than
  typed. A breakdown's `breakdown_kind` selects the editor: `gift` is the
  recipient × occasion planner + purchase log (reached from the Breakdowns tab, not
  a standalone Gifts tab); `generic` is a name + group with an item list (amount +
  frequency), which is how medications and any other itemised budget are modelled.
  A gift's agreed budget is shared and keeps feeding the derived line and pay
  splits, but its purchases and the spent/remaining they derive are private from
  the recipient: a `gift_recipient` links to a household member via `member_id`,
  and when it does, RLS on `gift_purchase`
  (`hidden_gift_budget_ids_for_current_member`) hides that member's own-gift
  purchases from them and blocks them logging one, while the Gifts screen shows
  them only the budgeted amount — the buyer (any other member) sees everything.
  Both household members are permanent recipients: each member's recipient is
  auto-created with the member (an insert trigger), removed with them (an
  `on delete cascade` FK), limited to one per member (a partial unique index),
  and non-editable (an update guard), so adding a recipient is for external
  people only.
  A line can also be **routed** to the account that funds it via
  `budget_line.destination_account_id` (Savings/Investments route through their
  goal's linked saver instead); the Splits tab sums each account's routed lines
  into a recommended fortnightly Up pay split. The household designates the single
  spending account its pay lands in (`households.pay_account_id`, set via the
  `set_household_pay_account` RPC); pay stays there and every other routed account
  — the other spending accounts and the savers — becomes a recommended split. Up
  exposes no pay-split API, so the household types the split into Up by hand and
  **confirms** the amount it set into the `pay_split` table; the Splits tab flags
  when the recommendation later drifts from the confirmed amount and offers a
  Confirm to re-record it.
- Ingestion: both partners bank with Up. The account-balance slice is built and
  deployed — members connect an Up personal-access token (held in Vault), and
  `up-sync` polls every Up account (savers and spending alike) into `accounts`,
  so a goal linked to a saver tracks its real balance and every account the
  member can see — plus any member's spending account by name via
  `account_directory` — is available as a budget-line funding destination (a
  co-member's savers stay private). Deduped on (source,
  external_id): a joint account shared across both partners collapses to one
  shared row (`owner_member_id` null), while individual accounts are attributed
  to their owner; an individual spending account's name is stored prefixed with
  the owner's name in possessive form (e.g. "Alex's Spending") to disambiguate
  the household's two spending accounts. Up transaction ingestion (spend/ledger reconciliation,
  actual tax paid) is deferred. Sources (Up Bank API + manual entry) are
  source-agnostic. Edge functions (`up-connect` / `up-disconnect` / `up-sync` /
  `up-webhook` / `changelog`) live under `supabase/functions/` and auto-deploy to
  prod on merge via `.github/workflows/deploy-functions.yml`.
- Changelog: an in-app "What's new" tab reads recent user-facing changes from
  GitHub via the `changelog` edge function (a server-held `GITHUB_CHANGELOG_TOKEN`
  fine-grained PAT), showing open PR titles as in-progress and merged-commit
  subjects as implemented, keeping only `feat`/`fix`/`perf` entries. The build's
  commit SHA is stamped into the app (`VITE_COMMIT_SHA` from
  `VERCEL_GIT_COMMIT_SHA`) and sent to the function, which splits the raw commit
  list at that commit: that commit and older are implemented (so a stale/cached
  PWA never shows entries newer than the build it is running), and the commits
  newer than it are returned as an "Update available" list with a Reload-to-update
  button that force-updates the PWA to the latest deployed version.

## Conventions

- Money is stored as integer minor units (cents); never floats.
- Integer-cent numeric literals are grouped to read as dollars: a trailing `_NN`
  for the cents, then `_NNN` groups for the dollars (e.g. `18_200_00` = $18,200.00).
- Financial year = AU FY (1 Jul – 30 Jun), labelled by the ending year.
- Tax rates/thresholds live in versioned config, never hardcoded in logic.
- Commit messages: Conventional Commits, first word capitalised, scoped where it
  helps (e.g. `feat(tax): Add LITO taper`).
- Feature work on branches → PRs; keep `main` releasable.
- Before opening a pull request — and before pushing updates to an open one —
  `git fetch` and rebase the branch onto the latest `origin/main`, so a PR is
  never built on a stale main (which risks silent conflicts with changes merged
  in the meantime).
- One feature per pull request. Each distinct change ships in its own branch and
  PR, even when several are requested in quick succession. Never bundle two
  unrelated changes together just because one was asked for while the other was
  already in motion — when a new request arrives mid-flight, open a separate
  branch and PR for it rather than folding it into the work in progress.
- PR titles are user-facing changelog copy. The in-app "What's new" changelog is
  sourced from merged-commit subjects on `main` (squash-merge uses the PR title)
  and from open PR titles, so write every PR title as a clear, user-readable
  description of the change. Keep the Conventional Commit `type(scope):` prefix —
  the changelog surfaces `feat`, `fix`, and `perf` entries and hides `chore`,
  `docs`, `ci`, `test`, and `refactor` — but phrase the description for someone
  using the app, not for an implementer.
- Because the changelog shows only the description (the type becomes an emoji and
  the scope is hidden), write each PR title's description so it reads as a clear,
  self-contained sentence that makes sense without the scope — e.g. prefer
  `feat(splits): Sort pay-split rows by title or amount` over
  `feat(splits): Add sorting`, whose description ("Add sorting") is meaningless
  once the `splits` scope is dropped.
- Keep documentation in sync with the code. When a change alters behaviour,
  schema, scope, or a workflow, update the affected docs (`docs/` and this file)
  as part of the same change, so `main` is never merged with stale docs.
- Claude is the driver of everything in this repo. It makes changes of every kind
  — code, schema, migrations, docs, CI, config — and owns the full git and PR
  lifecycle autonomously: branching, committing, pushing, and opening, updating,
  and merging pull requests, all without per-turn confirmation.
- Merge PRs via GitHub auto-merge (`gh pr merge --auto`), not by polling for CI to
  go green. Enable it once the PR is open; GitHub merges the moment the required
  checks pass.
- The driving agent delegates every piece of work to subagents rather than doing
  it inline, staying free to plan and take direction from the user. Launch
  independent subagents concurrently; reserve the main thread for orchestration
  and conversation.
- Every piece of work happens in its own dedicated git worktree named after its
  branch. This repo is a bare + per-branch-worktree layout (`.bare` plus a
  worktree per branch), so isolating each task in its own worktree keeps
  parallel subagents from sharing a working tree or colliding on git state.
- CI must complete in under 1 minute. If a run exceeds that, diagnosing and
  reducing CI time takes priority over other work. CI runs as separate parallel
  jobs (`check`, `test`, `rls`, `functions`) aggregated by a `ci-status` job that
  is the single required `CI Status` check, so overall wall-clock is the slowest
  single job, not the sum; the job/coverage/shard specifics are canonical in
  [`docs/architecture.md`](docs/architecture.md#ci). Steps WITHIN a job stay
  sequential: on a single 2-vCPU runner, running CPU-bound steps concurrently only
  causes contention and inflates each one without improving wall-clock time.
  Splitting into separate jobs avoids that by giving each its own runner.
