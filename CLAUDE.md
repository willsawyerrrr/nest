# CLAUDE.md

## Purpose

Household budgeting app for two people: income tracking, full AU income-tax
modelling, spending plans, and savings goals. See [`README.md`](README.md) and
[`docs/`](docs/) for scope and design.

## Fixed scope decisions

- Platform: one PWA for both iOS (installed via Safari) and web. No native app.
- Backend: Supabase (Sydney, Pro) — Postgres, Auth, PostgREST, Edge Functions,
  Vault. Direct PostgREST + RLS for CRUD; edge functions for tax engine + Up sync.
  Schema migrations under `supabase/migrations/` auto-deploy to prod on merge to
  `main` via `.github/workflows/deploy-migrations.yml` — nothing is applied by
  hand. Prod having applied every migration in the directory is asserted, not
  assumed: `.github/workflows/check-migration-drift.yml` compares the two every
  six hours, and the deploy workflow re-runs the same check straight after its
  push (see [`docs/operations.md`](docs/operations.md#deployment)).
- Frontend: React PWA (TypeScript); one frontend for iOS + web.
- UI framework: Mantine (React components + theming) under a dark-first design
  system (custom brand/semantic colour scales, shared primitives, tokenised
  charts — see [`docs/design-system.md`](docs/design-system.md)). The app is
  designed mobile-first — the primary device is an installed iPhone PWA.
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
  net-worth view sums only visible balances. Balances live in `account_balance`,
  split out of the identity `accounts` table so both account surfaces —
  `account_directory` (identity only) and `accounts_with_balance` (identity plus
  balance) — are plain invoker views needing no SECURITY DEFINER; the
  helper-function and view mechanics behind this live in architecture.md
  (Security) and data-model.md (the ledger tables, `account_directory`, and
  `accounts_with_balance`). A partner joins via a temporary, opt-in, single-use
  invite code (`create_invite_code` mints one, `join_household` redeems and
  consumes it, `revoke_invite_code` clears it); no email infrastructure.
- Inflows: the household owns many projection-based inflows, split by taxability
  — taxable income (salary, wage, or other regular income on a schedule — weekly
  through annual, or an arbitrary every-N-weeks or every-N-months cadence — each
  tagged to a member
  for tax) and non-taxable inflows (reimbursement, hobby income, gift, or other —
  the type is a reporting label, excluded from tax and added to available cash).
  An inflow may carry optional effective-from/until dates (`starts_on` /
  `ends_on`); the FY tax estimate prorates each rate by its active share of the
  year (by calendar days), so income that changes mid-year — a pay rise modelled
  as the old rate ending and a new dated inflow starting — is estimated correctly.
  A taxable inflow also records whether it is ordinary time earnings
  (`attracts_super`, default true). An allowance paid on top of ordinary hours —
  on-call or standby pay, each tier its own inflow — is taxed in full but earns
  no employer super, so it is excluded from the SG and percent-of-salary bases
  and from a payslip's expected super. It is NOT excluded from the super
  co-contribution's income test, which is on total assessable income: an
  allowance is assessable in full, so the two bases are computed separately and
  leaving it out would over-state the entitlement. The flag touches super only;
  taxability is unaffected.
- Tax: full AU income tax, versioned per financial year; estimate-only
  (actual-paid tracking deferred), per-person, modelling HELP debt and
  private-hospital cover; target financial year FY2027. Each member's HELP/HECS
  balance is a single standing figure (the `help_debt` table, not FY-scoped),
  edited on its own HELP debt tab, that feeds the tax estimate and counts as a
  net-worth liability.
- EOFY summary: a read-only filing-prep tab (`/eofy`) that gathers the
  household's already-tracked tax data — the tax estimate, deductions, super
  contributions, and HELP debt — into one per-member view for a financial year
  picked from a selector built from the tax engine's published configs, so the
  selector scales as future FY configs are added. It aggregates existing data
  only: no new tables, no actual-paid-tax tracking, and no checklist state. Each
  member's card condenses their filing-relevant tax figures, lists their claimed
  deductions with receipts, shows their super contributions against the same
  cap warnings as the Super tab, and shows their standing HELP balance with the
  year's estimated repayment; nothing on the tab is editable.
- Tax deductions: each member owns many deductible expenses on their own Tax
  deductions tab (the `deduction` table, FY-scoped), each an amount and date
  tagged to a member. A deduction reduces that member's taxable income in the
  tax estimate — so their estimated tax falls and take-home rises — appearing as
  a Deductions line in the Tax tab's income build-up and flowing through to the
  Summary. Each deduction may carry stored receipts (`deduction_receipt`), the
  files held in a private Supabase Storage bucket (`receipts`) laid out under
  `<household_id>/…` so Storage RLS gates access by household membership.
- Payslips: each member owns many payslips (the `payslip` table, FY-scoped), one
  per pay event, carrying the actuals — gross, tax withheld, super, net, plus the
  slip's optional salary sacrifice and year-to-date running totals. A slip is filed
  under the financial year its pay LANDED in — derived from `paid_on`, falling back
  to the pay period's last day where the slip states none — because the ATO assesses
  salary and wages in the year they are paid, so a fortnight worked to 28 June and
  paid 1 July counts in the later year. The form derives that year and shows back
  which date decided it, and the `payslip_financial_year` check constraint holds the
  same rule in the database, `financial_year` staying a plain writable column rather
  than a generated one. The pay period is never clipped to that year: a straddling
  period counts all of its own days, and the year only supplies the 365/366
  denominator an off-cadence period's expectations are apportioned over. A slip's
  own YTD figures rank by payment date too, so the anchor slip is whichever pay
  landed last, while the LIST stays ordered by pay period — every slip has one,
  `paid_on` is optional. The figures are
  always confirmed by the member; a slip names its cadence anchor via an
  explicit picker (`source_inflow_id`, nullable — a bonus or back-pay slip maps to
  none) and one employer per member, so there is no per-employer stream handling —
  a job change is modelled the way a pay rise is, the old inflow ending and a new
  dated one starting. One payment routinely covers several projections at once —
  salary plus one or two on-call allowances — so a slip is itemised into earnings
  lines (`payslip_line`), each an amount under the label the slip prints, drawing
  on the projected inflow it comes from. Many lines may draw on the SAME inflow
  (ordinary hours and annual leave both come off the salary), so gross variance is
  measured per inflow: each inflow's lines are summed and held against that
  inflow's expectation for the period, keeping a steady salary's variance at nil
  while a lumpy allowance's stands on its own. The lines need not sum to the
  slip's gross; the remainder is unallocated and surfaced, not absorbed. Expected
  employer super is charged on the gross less every line recorded as earning
  none, so an on-call allowance never inflates it; each line snapshots that
  decision from its inflow when it is written, because a payslip is a historical
  record and retiring the inflow must not move what a past slip was measured
  against. A slip with no lines is measured whole against its cadence anchor,
  which decides its super too. The slip and its lines are written by one RPC
  (`upsert_payslip_with_lines`) keyed on the id the form mints, so a save is one
  transaction and a retry rewrites the same slip rather than duplicating it.
  Itemisation is per-period totals only — there is no shift or roster entity. Each slip may carry
  an attached document, the file held in a
  private Supabase Storage bucket (`payslips`) laid out under
  `<household_id>/<payslip_id>/…` so Storage RLS gates access by household
  membership. Picking that document is what triggers **extraction pre-fill**: the
  form mints the payslip id, stores the file under it straight away (the file is
  the auditable record either way, and the `payslip-extract` edge function takes an
  object path), then reads it with Claude Haiku 4.5 and fills in the figures it
  found — showing back the literal text it read for each, so a misread is caught
  rather than confirmed blind. Extraction writes nothing: it never overwrites a
  figure that is already the member's — one they typed here, or one the payslip
  being edited already holds — every field stays editable, and the member's
  own save is what persists. An unconfigured key, a file that is not a payslip, an
  unsupported type or size, a rate limit, and a model failure each read as their own
  inline note and fall back to manual entry; none blocks the save. A stored document
  the member clears, replaces, or walks away from is deleted again, best effort: a
  delete that fails is swallowed rather than surfaced, and a closed tab, a refresh,
  or a killed PWA runs no cleanup at all, so an object no payslip references can
  survive. Payslips drive per-period
  variance against the projection (gross, withholding, super) and the FY's summed
  actual withheld feeds the tax engine's `paygWithheldCents`, turning the estimate's
  balance into a concrete refund or bill. The withheld figure — per period and
  year to date — is the slip's whole tax total, PAYG income tax plus any STSL
  study-loan component, because the liability it nets against already includes the
  compulsory HELP repayment that STSL pays; the extraction prompt, the entry form,
  the column comments, and `docs/payslips.md` all say so. RLS is household-wide,
  exactly as for the other per-member tax tables: `member_id` is a tax attribution,
  not a privacy boundary.
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
  line's amount can be **derived** rather than typed. A **breakdown** — a
  user-created, name + group itemised list (amount + frequency) — owns one derived
  line via `budget_line.breakdown_id`, which is how medications and any other
  itemised budget are modelled; the `breakdown` table holds only these generic
  (`breakdown_kind = 'generic'`) breakdowns, created and edited in the Breakdowns
  tab. Gift budget lines are a separate standalone roll-up keyed by
  `budget_line.is_gift_line`, derived directly from the gift tables by the reconcile
  pass with no breakdown row (`breakdown_id` null); gifts are managed solely in the
  Gifts tab (`/gifts`) and never appear in Breakdowns.
  Gifts fund each recipient separately: the reconcile derives one budget line per
  household member who has gift budgets (named "Gifts for &lt;member&gt;", keyed by
  `budget_line.gift_recipient_member_id`) plus one line for all external recipients;
  the gift planner stays a single unified screen. Each gift line's budget group is
  independent — set per line and preserved across reconcile (the breakdown's group
  only seeds a brand-new gift line), so "Gifts (others)" can be Discretionary while
  "Gifts for &lt;member&gt;" lines are Wants — whereas a generic breakdown's single
  line takes its group from the breakdown. A "Gifts for &lt;member&gt;" line
  is funded automatically from the **buyer's** — the other partner's — spending
  account (the other member's `type='transaction'` account, never the joint one),
  set by the reconcile each pass and NOT user-configurable (its "Funded from" picker
  is a read-only note; null when Up is unsynced), and its line is removed as soon as
  its budgets are gone. The external ("others") line and every generic derived line
  keep a user-set, editable funding account and route to their own pay split. A gift's agreed budget is shared and keeps feeding those
  derived lines and pay splits, but its purchases and the spent/remaining they
  derive are private from
  the recipient: a `gift_recipient` links to a household member via `member_id`,
  and when it does, RLS on `gift_purchase`
  (`hidden_gift_budget_ids_for_current_member`) hides that member's own-gift
  purchases from them and blocks them logging one, while the Gifts screen shows
  them only the budgeted amount. The recipient may still edit that shared agreed
  amount (RLS on `gift_budget` permits it and the Gifts screen offers the edit
  control), since the budget is jointly planned; only the spend stays hidden — the
  buyer (any other member) sees everything.
  A purchase is either hand-entered or linked from a synced Up card transaction:
  the Gifts tab's "From your card" inbox offers each unclaimed `gifts-and-charity`
  transaction (see Ingestion) to link against a gift budget — picked as a recipient
  and then one of that recipient's occasions, two dependent selects that name the
  one budget for the pair; the
  purchase takes the transaction's amount and its local posting date, with only the
  description editable — or to set aside as "not a gift"
  (`gift_transaction_dismissal`), Up's category covering charity too. The inbox
  respects the spend privacy above from both directions: the pickers omit
  gifts for the signed-in member (and the recipient itself where their every gift is
  one), whose purchases RLS refuses anyway, and the
  `transactions` policies withhold both a transaction outside the member's
  balance-visible accounts (`visible_balance_account_ids()`, so a gift bought on
  the buyer's own spending account is invisible to the recipient) and one already
  claimed as a gift for them (`hidden_gift_transaction_ids_for_current_member()`,
  so a joint-account gift is a candidate for both partners until one claims it and
  is withheld from the recipient thereafter). No account choice is needed to keep
  a surprise intact.
  Both household members are permanent recipients: each member's recipient is
  auto-created with the member (an insert trigger), removed with them (an
  `on delete cascade` FK), limited to one per member (a partial unique index),
  and non-editable (an update guard), so adding a recipient is for external
  people only.
  A line can also be **routed** to the account that funds it via
  `budget_line.destination_account_id` (Savings/Investments route through their
  goal's linked saver instead); the Pay splits tab sums each account's routed lines
  into a recommended fortnightly Up pay split. The household designates the single
  spending account its pay lands in (`households.pay_account_id`, set via the
  `set_household_pay_account` RPC); pay stays there and every other routed account
  — the other spending accounts and the savers — becomes a recommended split. Up
  exposes no pay-split API, so the household types the split into Up by hand and
  **confirms** the amount it set into the `pay_split` table; the Pay splits tab flags
  when the recommendation later drifts from the confirmed amount and offers a
  Confirm to re-record it.
- Ingestion: both partners bank with Up. The account-balance slice is built and
  deployed — members connect an Up personal-access token (held in Vault), and
  `up-sync` polls every Up account (savers and spending alike) into `accounts`
  and `account_balance` via the `upsert_up_accounts` RPC (identity and balance in
  one transaction), so a goal linked to a saver tracks its real balance and every account the
  member can see — plus any member's spending account by name via
  `account_directory` — is available as a budget-line funding destination (a
  co-member's savers stay private). Deduped on (source,
  external_id): a joint account shared across both partners collapses to one
  shared row (`owner_member_id` null), while individual accounts are attributed
  to their owner; an individual spending account's name is stored prefixed with
  the owner's name in possessive form (e.g. "Alex's Spending") to disambiguate
  the household's two spending accounts. Transaction ingestion covers one Up
  category: the same poll lands each member's `gifts-and-charity` transactions in
  `transactions` (Up's category in `external_category`, the household's own
  `category_id` null) via the `sync_up_gift_transactions` RPC, so a gift purchase
  can be linked to real card spend (`gift_purchase.transaction_id`) or set aside
  as not a gift (`gift_transaction_dismissal`). It rescans a fixed 365-day
  trailing window each run rather than following a cursor, because Up raises no
  event when a transaction is recategorised — which is how most gift spend gets
  categorised — and prunes the candidates Up no longer reports in the category,
  keeping any a purchase links to. The ledger's per-account privacy applies: a
  co-member's gift candidates on their own spending account stay invisible, and
  joint-account spend is a candidate for both partners until it is claimed as one
  partner's gift, at which point it is withheld from them. A general ledger
  (every category, spend reconciliation, actual tax paid) is deferred.
  Sources (Up Bank API + manual entry) are
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
- Push notifications: alerts reach the installed PWA over Web Push (RFC 8291
  payload encryption, RFC 8292 VAPID auth) — no push vendor and no native app. A
  member opts in **per device**: the subscription (endpoint plus its two keys)
  lands in `push_subscription`, upserted on the globally unique `endpoint` so a
  re-subscribe refreshes the row. That table is the one exception to the
  shared-household rule — an endpoint is a bearer capability to make someone's
  phone buzz, so RLS scopes all four commands to the owning member
  (`current_member_ids()`), a co-member can neither read nor delete nor reassign
  it, and `service_role` holds only `select` (to send) and `delete` (to prune).
  The VAPID keypair and its `mailto:` subject live in Vault, read only through the
  service-role-only `vapid_keys()` RPC and set by hand; `push-key` serves the
  public key so rotating the pair needs no rebuild, and `push-test` sends a
  verification notification to the caller's own devices, pruning a row only on a
  `404`/`410` and reporting `{ devices, sent, pruned, failed }`. The payload is
  `{ title, body, url }`, the URL being where `notificationclick` navigates.
  Deciding **when** to notify is out of scope: there is no scheduled evaluation
  pass and no buffer / goal / expiry trigger, so a push happens only when a member
  asks for a test.

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
- A defect or gap found along the way gets fixed, not raised as a question. Never
  ask whether something worth fixing should be fixed, and never park it as an
  optional follow-up for someone to approve: open its own branch and PR for it and
  say what was done. Report findings — the reasoning behind a decision, a
  trade-off taken, something deliberately left alone and why — but report them as
  work already in hand, not as a menu. Ask only where the answer is genuinely the
  household's to give and no default is defensible: what the app should do, which
  of several valid behaviours is wanted, or an outward-facing act with
  consequences beyond the repo.
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
