/**
 * Pay-split routing: which account funds each budget line, and the fortnightly
 * amount to send to each. A Savings/Investments line routes through its goal's
 * linked account; every other line routes through its own destination. Summed
 * per account, the totals are the fixed-dollar pay splits the household mirrors
 * into Up by hand — the plan is the source of truth, Up holds the real splits.
 */

import type { BudgetGroup, BudgetLine, Money } from './index.ts'
import { fortnightlyCents } from './normalize.ts'

/** A budget line with its optional routing: a funding goal, or a direct destination account. */
export interface AssignableLine extends BudgetLine {
  /** The line's id, a stable key for its entry in an account's breakdown. */
  readonly id: string
  /** The line's name, shown in an account's breakdown. */
  readonly name: string
  /** Goal a Savings/Investments line funds; the goal's linked account supplies the route. */
  readonly goalId?: string | null
  /** Account a non-Savings/Investments line is funded from. */
  readonly destinationAccountId?: string | null
}

/** One budget line behind an account's split: its identity and its fortnightly share of the total. */
export interface AssignmentLine {
  readonly id: string
  readonly name: string
  readonly fortnightlyCents: Money
}

/** A goal and the account (a synced Up saver) it draws its balance from, if any. */
export interface RoutableGoal {
  readonly id: string
  readonly linkedAccountId?: string | null
}

/** Per-account fortnightly totals, plus the total of lines that resolve to no account. */
export interface AccountAssignments {
  readonly byAccount: Readonly<Record<string, Money>>
  /**
   * The budget lines behind each account's total, keyed by account id and in
   * input order. Each account's lines sum to its `byAccount` total.
   */
  readonly linesByAccount: Readonly<Record<string, readonly AssignmentLine[]>>
  readonly unassignedFortnightlyCents: Money
}

/** The two groups whose destination is derived from their goal, not set directly. */
const GOAL_ROUTED_GROUPS: ReadonlySet<BudgetGroup> = new Set<BudgetGroup>([
  'savings',
  'investments',
])

/**
 * Resolves the account that funds a line: a Savings/Investments line routes
 * through its goal's `linkedAccountId`; every other line uses its own
 * `destinationAccountId`. Returns null when the route is unset — a
 * Savings/Investments line with no goal or an unlinked goal, or another line
 * with no destination.
 */
export function resolveDestinationAccountId(
  line: AssignableLine,
  goals: readonly RoutableGoal[],
): string | null {
  if (GOAL_ROUTED_GROUPS.has(line.group)) {
    const goal = goals.find((candidate) => candidate.id === line.goalId)
    return goal?.linkedAccountId ?? null
  }
  return line.destinationAccountId ?? null
}

/**
 * Groups lines by their resolved funding account, summing each group's
 * fortnightly amount and keeping the contributing lines behind it. Lines that
 * resolve to no account fall into `unassignedFortnightlyCents`. Routing is
 * date-independent, so no `now` is needed.
 */
export function assignmentsByAccount(
  lines: readonly AssignableLine[],
  goals: readonly RoutableGoal[],
): AccountAssignments {
  const byAccount: Record<string, Money> = {}
  const linesByAccount: Record<string, AssignmentLine[]> = {}
  let unassignedFortnightlyCents = 0
  for (const line of lines) {
    const fortnightly = fortnightlyCents(line.amountCents, line.frequency, line.interval)
    const accountId = resolveDestinationAccountId(line, goals)
    if (accountId === null) {
      unassignedFortnightlyCents += fortnightly
    } else {
      byAccount[accountId] = (byAccount[accountId] ?? 0) + fortnightly
      ;(linesByAccount[accountId] ??= []).push({
        id: line.id,
        name: line.name,
        fortnightlyCents: fortnightly,
      })
    }
  }
  return { byAccount, linesByAccount, unassignedFortnightlyCents }
}

/**
 * Whether a recommended split differs from what is currently configured for the
 * account, so the Splits tab should prompt a re-confirm. A null configured
 * amount means the split has never been confirmed and always needs updating.
 * Source-agnostic: the configured amount may come from an app-side confirmation
 * or, in future, from the bank's API.
 */
export function paySplitNeedsUpdate(
  recommendedCents: Money,
  configuredCents: Money | null,
): boolean {
  return configuredCents === null || configuredCents !== recommendedCents
}

/**
 * Whether a routed account belongs in the recommended pay splits (a transfer
 * destination the household mirrors into Up) rather than the "stays" section
 * (the pay account itself, where pay lands with no transfer needed). Once the
 * household has designated a pay account, every other routed account — the other
 * spending accounts and the savers — is a split destination; until then, only
 * savers are, and spending accounts are shown as staying put.
 */
export function isRecommendedSplitAccount(
  account: { readonly isPayAccount: boolean; readonly isSaver: boolean },
  hasPayAccount: boolean,
): boolean {
  return hasPayAccount ? !account.isPayAccount : account.isSaver
}

/**
 * Rounds an amount up to the next multiple of `stepCents`, never below it — the
 * figure a person types into Up, where cents-exact splits add no value and a
 * recommended split should never fund a line short. An exact multiple is left
 * unchanged; a non-positive step returns the amount unchanged.
 */
export function roundCentsUpToStep(amountCents: Money, stepCents: Money): Money {
  if (stepCents <= 0) {
    return amountCents
  }
  return Math.ceil(amountCents / stepCents) * stepCents
}
