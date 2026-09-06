/**
 * The React-free ports of the PWA Summary's parity adapters — the pieces
 * `apps/pwa/src/lib/summary.ts` layers on top of the tax estimate to reach the
 * exact on-screen fortnightly buffer:
 *
 * - `activeNowTaxableInflows` (from `lib/tax.ts`) — the taxable inflows landing
 *   now, for the fortnightly re-estimate.
 * - `splitAcrossMembers` / `projectedInterestIncomeInputs` (from `lib/tax.ts`) —
 *   a savings goal's modelled interest as synthetic `other` income.
 * - `giftTotalsByMember` (from `lib/gifts.ts`), `derivedAmountContext` (from
 *   `lib/breakdowns.ts`), `applyBreakdownAmounts` (from `lib/derivedBudget.ts`) —
 *   the rolled-up amounts a derived budget line reads.
 *
 * Row shapes are loose interfaces, as in `tax.ts`: the edge runtime cannot
 * import the PWA's `lib/`. The names match the originals so the correspondence
 * is legible.
 */

import { annualCents, isActiveOn } from '@nest/plan'
import type { Frequency } from '@nest/plan'
import type { IncomeInput } from '@nest/tax'
import type { InflowRow } from './tax.ts'

// ── activeNowTaxableInflows ────────────────────────────────────────────────

/**
 * The taxable inflows the fortnightly budget basis is estimated over: the income
 * landing NOW, each at its full annual rate. A recurring inflow is kept only
 * while `now` falls within its effective window (either side open-ended), with
 * `starts_on` / `ends_on` cleared so the engine annualises it at the full rate
 * rather than its FY-active share. A ONE-OFF is passed through unchanged — it
 * states a date, not a cadence. Non-taxable inflows are dropped.
 */
export function activeNowTaxableInflows(inflows: readonly InflowRow[], now: Date): InflowRow[] {
  return inflows.flatMap((inflow) => {
    if (!inflow.taxable) {
      return []
    }
    if (inflow.paid_on != null) {
      return [inflow]
    }
    if (!isActiveOn({ startsOn: inflow.starts_on, endsOn: inflow.ends_on }, now)) {
      return []
    }
    return [{ ...inflow, starts_on: null, ends_on: null }]
  })
}

// ── projected savings-interest income ──────────────────────────────────────

/**
 * Splits `cents` equally across `memberIds`, the last member absorbing the
 * remainder cent so the shares sum back to `cents` exactly. An empty list
 * yields an empty array.
 */
export function splitAcrossMembers(cents: number, memberIds: readonly string[]): number[] {
  if (memberIds.length === 0) {
    return []
  }
  const each = Math.floor(cents / memberIds.length)
  return memberIds.map((_, index) =>
    index === memberIds.length - 1 ? cents - each * (memberIds.length - 1) : each
  )
}

/** The `savings_goal` columns projected interest reads. */
export interface InterestGoalRow {
  annual_interest_bps: number | null
  linked_account_id: string | null
  current_balance_cents: number
}

/** A synced Up saver: its balance and (for joint savers, null) its owner. */
export interface SaverRow {
  id: string
  balance_cents: number
  owner_member_id: string | null
}

/** The `members` column interest attribution reads. */
export interface MemberIdRow {
  id: string
}

/**
 * Synthetic `other`-income inputs for each member's share of the household's
 * projected annual savings interest. A goal modelling an effective annual rate
 * (`annual_interest_bps` above zero) adds
 * `startingBalanceCents × annual_interest_bps / 10000`, rounded to cents — a
 * simple non-compounding figure. The starting balance is the linked saver's real
 * `balance_cents` when `linked_account_id` resolves, else the goal's own
 * `current_balance_cents`.
 *
 * A goal linked to an individually-owned saver gives the whole figure to that
 * saver's owner; a goal linked to a joint saver (`owner_member_id` null) or with
 * no resolvable link splits 50/50 across `members`. Each non-zero share becomes
 * one steady, always-active `annual` `other` input.
 */
export function projectedInterestIncomeInputs(
  goals: readonly InterestGoalRow[],
  savers: readonly SaverRow[],
  members: readonly MemberIdRow[],
): IncomeInput[] {
  const accountById = new Map(savers.map((saver) => [saver.id, saver]))
  const memberIds = members.map((member) => member.id)
  const inputs: IncomeInput[] = []
  for (const goal of goals) {
    const bps = goal.annual_interest_bps
    if (bps == null || bps <= 0) {
      continue
    }
    const linked = goal.linked_account_id != null
      ? accountById.get(goal.linked_account_id)
      : undefined
    const startingBalanceCents = linked ? linked.balance_cents : goal.current_balance_cents
    const interestCents = Math.round((startingBalanceCents * bps) / 10_000)
    if (interestCents === 0) {
      continue
    }
    const shares = linked?.owner_member_id != null
      ? [[linked.owner_member_id, interestCents] as const]
      : splitAcrossMembers(interestCents, memberIds).map(
        (cents, index) => [memberIds[index] as string, cents] as const,
      )
    for (const [memberId, amountCents] of shares) {
      if (amountCents !== 0) {
        inputs.push({ memberId, type: 'other', schedule: 'annual', amountCents })
      }
    }
  }
  return inputs
}

// ── derived budget amounts (breakdowns + gifts) ────────────────────────────

/** A `gift_budget` row: an amount tagged to a recipient. */
export interface GiftBudgetRow {
  recipient_id: string
  budgeted_amount_cents: number
}

/** A `gift_recipient` row: its household-member link, or null for an external person. */
export interface GiftRecipientRow {
  id: string
  member_id: string | null
}

/** The household's single ad hoc discretionary gift buffer, or null before its first edit. */
export interface GiftDiscretionaryBudgetRow {
  budgeted_amount_cents: number
}

/**
 * The planned gift spend partitioned by the recipient's household member. Every
 * external (non-member) recipient's budgets collapse into the `null` key, which
 * also carries the household's ad hoc discretionary gift buffer amount. A member
 * appears only when it has at least one budget.
 */
export function giftTotalsByMember(
  budgets: readonly GiftBudgetRow[],
  recipients: readonly GiftRecipientRow[],
  discretionaryBudget: GiftDiscretionaryBudgetRow | null = null,
): Map<string | null, number> {
  const memberByRecipient = new Map(
    recipients.map((recipient) => [recipient.id, recipient.member_id]),
  )
  const totals = new Map<string | null, number>()
  for (const budget of budgets) {
    const key = memberByRecipient.get(budget.recipient_id) ?? null
    totals.set(key, (totals.get(key) ?? 0) + budget.budgeted_amount_cents)
  }
  const discretionaryCents = discretionaryBudget?.budgeted_amount_cents ?? 0
  if (discretionaryCents !== 0) {
    totals.set(null, (totals.get(null) ?? 0) + discretionaryCents)
  }
  return totals
}

/** A `breakdown` row (only its id is read for the roll-up). */
export interface BreakdownRow {
  id: string
}

/** A `breakdown_item` row: an amount on a frequency, filed under a breakdown. */
export interface BreakdownItemRow {
  breakdown_id: string
  amount_cents: number
  frequency: string
  interval_count: number | null
}

/** The rolled-up annual amounts every derived budget line reads, resolved per line. */
export interface DerivedAmountContext {
  /** Each generic breakdown's summed annualised item total, keyed by breakdown id. */
  genericTotalsByBreakdownId: Map<string, number>
  /** The gift spend partitioned by recipient member (`null` = external recipients). */
  giftTotalsByMember: Map<string | null, number>
}

/** The summed annualised total of a generic breakdown's items, in cents. */
function genericTotal(items: readonly BreakdownItemRow[], breakdownId: string): number {
  return items
    .filter((item) => item.breakdown_id === breakdownId)
    .reduce(
      (total, item) =>
        total +
        annualCents(
          item.amount_cents,
          item.frequency as Frequency,
          item.interval_count ?? undefined,
        ),
      0,
    )
}

/**
 * Builds the {@link DerivedAmountContext} from the household's breakdowns,
 * generic items, and gift data. Every derived-line amount resolves from this one
 * context so the surfaces never drift.
 */
export function derivedAmountContext(
  breakdowns: readonly BreakdownRow[],
  items: readonly BreakdownItemRow[],
  giftBudgets: readonly GiftBudgetRow[],
  giftRecipients: readonly GiftRecipientRow[],
  giftDiscretionaryBudget: GiftDiscretionaryBudgetRow | null = null,
): DerivedAmountContext {
  const genericTotalsByBreakdownId = new Map<string, number>()
  for (const breakdown of breakdowns) {
    genericTotalsByBreakdownId.set(breakdown.id, genericTotal(items, breakdown.id))
  }
  return {
    genericTotalsByBreakdownId,
    giftTotalsByMember: giftTotalsByMember(giftBudgets, giftRecipients, giftDiscretionaryBudget),
  }
}

/** The `budget_line` columns the derived-amount override reads. */
export interface BudgetLineRow {
  line_group: string
  amount_cents: number
  frequency: string
  interval_count: number | null
  is_gift_line: boolean
  breakdown_id: string | null
  gift_recipient_member_id: string | null
}

/** Whether a line's amount is roll-up-derived rather than manually typed. */
function isDerivedLine(line: BudgetLineRow): boolean {
  return line.is_gift_line || line.breakdown_id !== null
}

/**
 * Overrides the effective amount of every roll-up-derived budget line with its
 * rolled-up annual total, treated as an annual figure. A gift line
 * (`is_gift_line`) takes its recipient partition's share (keyed by
 * `gift_recipient_member_id`, `null` for the external line); a generic breakdown
 * line takes its breakdown's item total. A manual line passes through untouched;
 * with no derived line present the input is returned as-is. A derived line
 * missing from the context falls back to zero.
 */
export function applyBreakdownAmounts<T extends BudgetLineRow>(
  lines: readonly T[],
  context: DerivedAmountContext,
): readonly T[] {
  if (!lines.some(isDerivedLine)) {
    return lines
  }
  return lines.map((line) => {
    if (line.is_gift_line) {
      return {
        ...line,
        amount_cents: context.giftTotalsByMember.get(line.gift_recipient_member_id ?? null) ?? 0,
        frequency: 'annual',
      }
    }
    if (line.breakdown_id !== null) {
      return {
        ...line,
        amount_cents: context.genericTotalsByBreakdownId.get(line.breakdown_id) ?? 0,
        frequency: 'annual',
      }
    }
    return line
  })
}
