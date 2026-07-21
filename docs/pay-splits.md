# Pay splits

Keeping the household's Up pay splits aligned with the budget. Each budget line
is routed to the Up account or saver that funds it; the app then recommends, per
saver, the fortnightly amount to configure as that saver's Up pay split. The
household sets those splits in Up by hand and **confirms** the amount it set, so
the app can flag when the recommendation later drifts from the confirmed amount
and prompt a re-confirm.

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

An Up saver is an `accounts` row with `source = 'up'`, `type = 'savings'`; the
main spending account is `type = 'transaction'`. Both are valid destinations.

## Pure logic (`@nest/plan`)

- `resolveDestinationAccountId(line, goals)` — a Savings/Investments line resolves
  through its goal's `linkedAccountId`; every other line uses its own
  `destinationAccountId`; unresolved → `null`.
- `assignmentsByAccount(lines, goals)` — groups lines by resolved destination and
  sums each group's `fortnightlyCents`, returning per-account totals plus an
  `unassignedFortnightlyCents` bucket for unrouted lines.
- `roundCentsUpToStep(amountCents, stepCents)` — round up to the next multiple of
  a step, never below the amount (used with `5_00`).
- `paySplitNeedsUpdate(recommendedCents, configuredCents)` — whether the rounded
  recommendation differs from the configured split (`null` = never confirmed →
  always needs update). Source-agnostic: it does not care where the configured
  amount came from.

All pure, no I/O, unit-tested — consistent with the rest of `@nest/plan`.

## UI

- **Budget-line form** — a "Funded from" account picker for
  non-Savings/Investments lines, sourced from the identity-only `account_directory`
  view (shared accounts, the caller's own accounts, and any member's spending
  account by name — so a co-member's spending account is selectable without
  exposing its balance; a co-member's savers are absent), excluding super-fund
  balance accounts, which are not spendable. Savings / Investments lines show the
  goal-derived route instead of a picker.
- **Budget list** — each line shows a small badge naming its route: the linked
  goal for a Savings/Investments line, the funding account otherwise. The badge's
  icon is the account/saver's own icon — its Up emoji when its name carries one,
  otherwise a shared default — and its name shows with that emoji stripped.
  Unrouted lines show none.
- **Splits tab** — for each Up saver with lines routed to it, the recommended
  fortnightly pay split (rounded up to the nearest $5); the remainder that stays in the
  transaction account; and an "Unassigned" nudge totalling lines not yet routed.
  Each row shows the same account/saver icon and emoji-stripped name as the budget
  list, and rows can be sorted by title or amount with a direction toggle (the
  preference persists). Each saver row compares its recommendation against the
  confirmed split (`configuredByAccount`, passed in as a plain map — the screen
  never reads `pay_split` directly): a matching row reads "✓ up to date"; a
  drifted or never-confirmed row is flagged (a yellow left border and an "Update"
  badge), shows the change ("was $350 → $400 / fn", or "Not set in Up yet"), and
  offers a Confirm button that records the rounded recommendation. A "N to update"
  badge by the heading summarises how many savers need a re-confirm.

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
`pay_split` (one row per account, `unique (household_id, account_id)`) holds the
household's confirmed fortnightly split; `@nest/plan` exposes the pure
`resolveDestinationAccountId`, `assignmentsByAccount`, `roundCentsUpToStep`, and
`paySplitNeedsUpdate`; the budget-line form offers a "Funded from" picker on
non-Savings/Investments lines (Savings/Investments show the goal-derived route);
and the Splits tab (between Budget and Goals) lists each account's recommended
fortnightly split rounded up to the nearest $5, flags savers whose confirmed
split has drifted (or is unset) with a Confirm to record the new amount, and
shows an Unassigned nudge.
