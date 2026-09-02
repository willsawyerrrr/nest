# Pay splits

Keeping the household's Up pay splits aligned with the budget. Each budget line
is routed to the account or saver that funds it; the household designates the one
spending account its **pay lands in** (the source), and the app then recommends,
per other account, the fortnightly amount to configure as that account's Up pay
split. Pay stays in the pay account, so every other routed account — the other
spending accounts and the savers — is a recommended split. The household sets
those splits in Up by hand and **confirms** the amount it set, so the app can
flag when the recommendation later drifts from the confirmed amount and prompt a
re-confirm.

Amounts are integer minor units (cents). The fortnight is the primary period, as
everywhere in the plan-only app.

## Up cannot expose pay splits — so the app holds the confirmed split

Up's public API is **read-only** over `accounts`, `transactions`, `categories`,
`tags`, `attachments`, and `webhooks`. It has **no** endpoint for pay-split /
salary-automation config and **no** payment initiation. So the app can neither
read the splits configured in Up nor push new ones.

The app therefore treats "the split currently configured for an account" as a
single **source-agnostic** concept, and today records it itself: when the
household has set a saver's split in Up, it confirms that amount into the
`pay_split` table (an app-side record — still **not** read from Up). The Splits
tab compares each saver's recommendation against its confirmed amount and flags
drift, offering a Confirm to record the new amount and clear the alert.

## Decisions (locked)

- **Confirmed split, app-side today.** The app stores the fortnightly split the
  household has confirmed as set in Up (one `pay_split` row per account),
  compares it to the recommendation to surface drift, and offers a Confirm to
  record the new amount. The confirmation is app-side — it is not read from Up.
- **Clearing a confirmed split.** A confirmed account offers a Clear that deletes
  its `pay_split` row. The account then reverts to an unconfirmed recommendation
  (`configuredCents === null`), which the Splits tab already flags as "Not set in
  Up yet" with a "Mark as set" button — the signal that the split needs
  establishing, as when the splits an employer paid are gone after a job change.
  A plain delete, one account at a time: no bulk "clear all", no separate
  paused or inactive state.
- **One household pay account.** The household designates a single spending
  (`type = 'transaction'`) account as the source pay lands in
  (`households.pay_account_id`). It affects the Splits view only — pay stays
  there, and every other routed account becomes a recommended split. The pay
  account stays selectable as a budget-line destination everywhere else. Until a
  pay account is chosen, only savers are recommended and spending accounts are
  shown as staying put.
- **One destination per line.** A line points at exactly one account (nullable).
  Splitting a cost across savers means two lines — no per-line fan-out, no join
  table.
- **Savings/Investments derive their destination.** Those lines already fund a
  goal (`budget_line.goal_id`), and a goal links to an Up saver
  (`savings_goal.linked_account_id`). So they route via that saver; the explicit
  destination column applies only to the other groups. A line has exactly one
  source of destination.
- **Fixed-dollar splits.** Up splits are treated as fixed dollar amounts (not
  percentages), so recommendations are the summed fortnightly amount per account.
  No pay-base / percentage math.
- **Rounded up to the nearest $5.** Cents-exact figures add no value when typed
  into Up, and rounding up (never down) keeps a recommended split from funding a
  line short.
- **Household-level.** Assignments are household totals (money is pooled). A
  per-saver recommendation is the combined amount both partners' pays should send
  to that saver; the app does not model per-member pay cadence.
- **Dedicated Splits tab** between Budget and Goals.

## Data model

One column on `budget_line` routes a line to its funding account:

- `destination_account_id uuid` — nullable composite FK
  `(destination_account_id, household_id) → accounts (id, household_id)`,
  `on delete set null`, mirroring `goal_id`. A line can only reference an account
  in its own household; the reference clears rather than blocks when the account
  is removed.
- CHECK `budget_line_destination_group`: `destination_account_id is null or
  line_group not in ('savings', 'investments')` — enforces the two-path model.

One `pay_split` row per account holds the confirmed split:

- `pay_split (household_id, account_id, confirmed_fortnightly_cents,
  confirmed_at, …)` — the fortnightly split the household has confirmed as set in
  Up for an account. `unique (household_id, account_id)` keeps it one-per-account;
  the composite FK `(account_id, household_id) → accounts (id, household_id)` on
  delete cascade keeps it within the household. RLS gates on household membership,
  like the rest of the ledger. It is the source-agnostic "configured split" the
  Splits tab compares against.

The pay account lives on the household:

- `households.pay_account_id uuid` — nullable composite FK
  `(pay_account_id, id) → accounts (id, household_id)`,
  `on delete set null (pay_account_id)`. The single spending account the
  household's pay lands in; deleting that account clears the designation and
  leaves the household standing, dropping the tab back to its no-pay-account
  state. Written only through the
  `set_household_pay_account(account_id)` SECURITY DEFINER RPC, which rejects any
  account that is not a `type = 'transaction'` account in the caller's household,
  so households writes stay controlled rather than exposing a broad column update.

An Up saver is an `accounts` row with `source = 'up'`, `type = 'savings'`; a
spending account is `type = 'transaction'`. Both are valid destinations.

## Pure logic (`@nest/plan`)

- `resolveDestinationAccountId(line, goals)` — a Savings/Investments line resolves
  through its goal's `linkedAccountId`; every other line uses its own
  `destinationAccountId`; unresolved → `null`.
- `assignmentsByAccount(lines, goals)` — groups lines by resolved destination and
  sums each group's `fortnightlyCents`, returning per-account totals plus an
  `unassignedFortnightlyCents` bucket for unrouted lines.
- `roundCentsUpToStep(amountCents, stepCents)` — round up to the next multiple of
  a step, never below the amount (used with `5_00`).
- `isRecommendedSplitAccount({ isPayAccount, isSaver }, hasPayAccount)` — whether
  a routed account belongs in the recommended splits (a transfer destination)
  rather than the "stays" section (the pay account, where pay lands). With a pay
  account designated, every account but it is a split; until then, only savers.
- `paySplitNeedsUpdate(recommendedCents, configuredCents)` — whether the rounded
  recommendation differs from the configured split (`null` = never confirmed →
  always needs update). Source-agnostic: it does not care where the configured
  amount came from.

All pure, no I/O, unit-tested — consistent with the rest of `@nest/plan`.

## UI

- **Budget-line form** — a "Funded from" account picker for
  non-Savings/Investments lines, sourced from the identity-only `account_directory`
  view (so a co-member's spending account is selectable by name without exposing
  its balance — see
  [`data-model.md`](data-model.md#ledger)), excluding super-fund balance accounts,
  which are not spendable. Savings / Investments lines show the goal-derived route
  instead of a picker. A "Gifts for &lt;member&gt;" derived line is an exception: its
  funding account is auto-derived (the buyer's — the other partner's — spending
  account) and not user-configurable, so its editor replaces the picker with a
  read-only note. The gift external ("others") line and every generic derived line
  keep the editable picker. See [`breakdowns.md`](breakdowns.md).
- **Budget list** — each line shows a small badge naming its route: the linked
  goal for a Savings/Investments line, the funding account otherwise. The badge's
  icon is the account/saver's own icon — its Up emoji when its name carries one,
  otherwise a shared default — and its name shows with that emoji stripped.
  Unrouted lines show none.
- **Splits tab** — a "Paid into" selector at the top designates the household's
  pay account (a clearable Select of the household's spending accounts from
  `account_directory`); changing it calls `set_household_pay_account`. With a pay
  account set, every other routed account — the other spending accounts and the
  savers — is a **recommended pay split** (rounded up to the nearest $5), while
  the pay account sits under "Stays in your pay account" ("Pay lands here — no
  transfer needed"); an "Unassigned" nudge totals lines not yet routed. Until a
  pay account is chosen, a callout prompts the household to pick one, and the page
  falls back to recommending savers only with spending accounts shown as "Stays
  in your spending account". Each row shows the same account/saver icon and
  emoji-stripped name as the budget list, and rows can be sorted by title or
  amount with a direction toggle (the preference persists). Each recommended row
  compares its recommendation against the confirmed split (`configuredByAccount`,
  passed in as a plain map — the screen never reads `pay_split` directly): a
  matching row renders plainly; a drifted or never-confirmed row is flagged (a
  yellow left border and an "Update" badge), shows the change ("was $350 → $400 /
  fn", or "Not set in Up yet"), and offers a Confirm button that records the
  rounded recommendation. A "N to update" badge by the heading summarises how many
  accounts need a re-confirm. Any row with a confirmed split — drifting or not —
  also carries a subdued Clear button that deletes the `pay_split` row (via
  `usePaySplits`'s `clear`), dropping the account back to an unconfirmed
  recommendation flagged "Not set in Up yet".

## Out of scope / future

- **Reading the configured split from Up's API.** The "configured split" is a
  source-agnostic concept; today the household confirms it into `pay_split`. If
  Up's API ever exposes the real configured pay-split, that API becomes the source
  — `configuredByAccount` is fed from there, the comparison logic
  (`paySplitNeedsUpdate`) is unchanged, and the manual confirmation step falls
  away.
- Percentage-based splits (would need a pay base from take-home).
- Per-member pay cadence mapping (fortnightly is the common denominator today).
- Pushing splits to Up (no API).

## Status

Built and deployed. `budget_line.destination_account_id` (the nullable composite
FK plus the `budget_line_destination_group` check) carries a line's destination;
`households.pay_account_id` (the nullable composite FK, written through
`set_household_pay_account`) names the account pay lands in; `pay_split` (one row
per account, `unique (household_id, account_id)`) holds the household's confirmed
fortnightly split; `@nest/plan` exposes the pure `resolveDestinationAccountId`,
`assignmentsByAccount`, `isRecommendedSplitAccount`, `roundCentsUpToStep`, and
`paySplitNeedsUpdate`; the budget-line form offers a "Funded from" picker on
non-Savings/Investments lines (Savings/Investments show the goal-derived route);
and the Splits tab (between Budget and Goals) designates the pay account, lists
every other routed account's recommended fortnightly split rounded up to the
nearest $5, flags accounts whose confirmed split has drifted (or is unset) with a
Confirm to record the new amount, offers a Clear on any confirmed account that
deletes its `pay_split` row and reverts it to an unconfirmed recommendation, and
shows an Unassigned nudge.
