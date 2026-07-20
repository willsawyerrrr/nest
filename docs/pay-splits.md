# Pay splits

Keeping the household's Up pay splits aligned with the budget. Each budget line
is routed to the Up account or saver that funds it; the app then recommends, per
saver, the fortnightly amount to configure as that saver's Up pay split. The
plan is the source of truth for what the splits *should* be; Up holds the real
splits, and the household keeps them in sync by hand.

Amounts are integer minor units (cents). The fortnight is the primary period, as
everywhere in the plan-only app.

## Hard constraint: Up cannot expose pay splits

Up's public API is **read-only** over `accounts`, `transactions`, `categories`,
`tags`, `attachments`, and `webhooks`. It has **no** endpoint for pay-split /
salary-automation config and **no** payment initiation. So the app can neither
read the splits configured in Up nor push new ones. This rules out any automatic
comparison against the real Up state and forces a **recommend-only** design: the
app computes the recommended split, and the person edits Up manually.

Comparing recommendations against the split actually configured in Up (to flag
drift) is therefore **blocked** — see [ROADMAP.md](ROADMAP.md) "Blocked". Revisit
only if Up's API ever exposes pay-split config.

## Decisions (locked)

- **Recommend-only.** No stored "Up target"; the app computes the recommended
  per-saver split from budget assignments and shows "set Up to these".
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

Add one column to `budget_line`:

- `destination_account_id uuid` — nullable composite FK
  `(destination_account_id, household_id) → accounts (id, household_id)`,
  `on delete set null`, mirroring `goal_id`. A line can only reference an account
  in its own household; the reference clears rather than blocks when the account
  is removed.
- CHECK `budget_line_destination_group`: `destination_account_id is null or
  line_group not in ('savings', 'investments')` — enforces the two-path model.

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

All pure, no I/O, unit-tested — consistent with the rest of `@nest/plan`.

## UI

- **Budget-line form** — a "Funded from" account picker for
  non-Savings/Investments lines (the household's accounts, excluding super-fund
  balance accounts, which are not spendable). Savings / Investments lines show the
  goal-derived route instead of a picker.
- **Splits tab** — for each Up saver with lines routed to it, the recommended
  fortnightly pay split (rounded up to the nearest $5); the remainder that stays in the
  transaction account; and an "Unassigned" nudge totalling lines not yet routed.
  A Refresh re-syncs Up accounts via `up-sync`.

## Out of scope / future

- Comparison against Up's real splits (blocked — see above).
- Percentage-based splits (would need a pay base from take-home).
- Per-member pay cadence mapping (fortnightly is the common denominator today).
- Pushing splits to Up (no API).

## Status

Built and deployed. `budget_line.destination_account_id` (the nullable composite
FK plus the `budget_line_destination_group` check) carries a line's destination;
`@nest/plan` exposes the pure `resolveDestinationAccountId`, `assignmentsByAccount`,
and `roundCentsToNearest`; the budget-line form offers a "Funded from" picker on
non-Savings/Investments lines (Savings/Investments show the goal-derived route);
and the Splits tab (between Budget and Goals) lists each account's recommended
fortnightly split rounded up to the nearest $5, with an Unassigned nudge and a Refresh that
re-syncs Up accounts via `up-sync`.
