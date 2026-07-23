import { annualCents } from '@nest/plan'
import type { BreakdownItem } from '../hooks/useBreakdownItems'
import type { Breakdown } from '../hooks/useBreakdowns'
import type { BudgetLine, BudgetLineInput } from '../hooks/useBudgetLines'
import {
  buyerSpendingAccountId,
  giftTotalsByMember,
  type DirectoryAccount,
  type GiftBudget,
  type GiftRecipient,
} from './gifts'

/**
 * The rolled-up annual amounts every derived line reads, resolved per line rather
 * than per breakdown so a gift breakdown can own several lines. A generic
 * breakdown owns one line whose amount is `genericTotalsByBreakdownId`; the single
 * `gift` breakdown owns one line per recipient partition, each taking its share
 * from `giftTotalsByMember` (keyed by member id, `null` for external recipients).
 */
export interface DerivedAmountContext {
  /** Each generic breakdown's summed annualised item total, keyed by breakdown id. */
  genericTotalsByBreakdownId: Map<string, number>
  /** The household's single gift breakdown's id, or `null` when it has none. */
  giftBreakdownId: string | null
  /** The gift spend partitioned by recipient member (`null` = external recipients). */
  giftTotalsByMember: Map<string | null, number>
}

/** The summed annualised total of a generic breakdown's items, in cents. */
function genericTotal(items: BreakdownItem[], breakdownId: string): number {
  return items
    .filter((item) => item.breakdown_id === breakdownId)
    .reduce(
      (total, item) =>
        total + annualCents(item.amount_cents, item.frequency, item.interval_count ?? undefined),
      0,
    )
}

/**
 * Builds the {@link DerivedAmountContext} from the household's breakdowns, generic
 * items, and gift data. Every derived-line amount — in the Budget and Summary
 * tabs and the reconcile pass — resolves from this one context, so the surfaces
 * never drift.
 */
export function derivedAmountContext(
  breakdowns: Breakdown[],
  items: BreakdownItem[],
  giftBudgets: GiftBudget[],
  giftRecipients: GiftRecipient[],
): DerivedAmountContext {
  const genericTotalsByBreakdownId = new Map<string, number>()
  let giftBreakdownId: string | null = null
  for (const breakdown of breakdowns) {
    if (breakdown.kind === 'gift') {
      giftBreakdownId = breakdown.id
    } else {
      genericTotalsByBreakdownId.set(breakdown.id, genericTotal(items, breakdown.id))
    }
  }
  return {
    genericTotalsByBreakdownId,
    giftBreakdownId,
    giftTotalsByMember: giftTotalsByMember(giftBudgets, giftRecipients),
  }
}

/**
 * Each breakdown's overall rolled-up annual total, keyed by breakdown id — the
 * gift breakdown summing every recipient partition — for the Breakdowns list,
 * which shows one total per breakdown rather than the per-partition split.
 */
export function breakdownTotalsByBreakdownId(
  breakdowns: Breakdown[],
  context: DerivedAmountContext,
): Map<string, number> {
  const giftTotal = [...context.giftTotalsByMember.values()].reduce((sum, cents) => sum + cents, 0)
  const totals = new Map<string, number>()
  for (const breakdown of breakdowns) {
    totals.set(
      breakdown.id,
      breakdown.kind === 'gift'
        ? giftTotal
        : (context.genericTotalsByBreakdownId.get(breakdown.id) ?? 0),
    )
  }
  return totals
}

/**
 * How many items each generic breakdown owns, keyed by breakdown id, driving its
 * derived line's existence. A gift breakdown owns no `breakdown_item` rows (its
 * items live in `gift_budget`), so its line lifecycle is driven by
 * {@link DerivedAmountContext.giftTotalsByMember} instead, not this count.
 */
export function breakdownItemCounts(
  breakdowns: Breakdown[],
  items: BreakdownItem[],
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const breakdown of breakdowns) {
    counts.set(breakdown.id, items.filter((item) => item.breakdown_id === breakdown.id).length)
  }
  return counts
}

/** The budget-line writes needed to bring the derived lines in line with the breakdowns. */
export interface BreakdownLineOps {
  create: BudgetLineInput[]
  update: { id: string; input: BudgetLineInput }[]
  remove: string[]
}

/** Whether a group routes via a savings goal rather than a funding account (the DB CHECK bars a destination). */
function groupRoutesViaGoal(group: Breakdown['line_group']): boolean {
  return group === 'savings' || group === 'investments'
}

/** The derived-line fields a breakdown drives, at the given routing and any goal link. */
function derivedInput(
  breakdown: Breakdown,
  totalCents: number,
  name: string,
  giftRecipientMemberId: string | null,
  destinationAccountId: string | null,
  line?: BudgetLine,
): BudgetLineInput {
  return {
    line_group: breakdown.line_group,
    name,
    amount_cents: totalCents,
    frequency: 'annual',
    interval_count: null,
    goal_id: line?.goal_id ?? null,
    breakdown_id: breakdown.id,
    destination_account_id: destinationAccountId,
    gift_recipient_member_id: giftRecipientMemberId,
  }
}

/** Whether a derived line has drifted from the name, group, amount, partition, or routing it should carry. */
function lineDrifted(
  line: BudgetLine,
  breakdown: Breakdown,
  totalCents: number,
  name: string,
  giftRecipientMemberId: string | null,
  destinationAccountId: string | null,
): boolean {
  return (
    line.amount_cents !== totalCents ||
    line.name !== name ||
    line.line_group !== breakdown.line_group ||
    line.frequency !== 'annual' ||
    line.interval_count !== null ||
    (line.gift_recipient_member_id ?? null) !== giftRecipientMemberId ||
    (line.destination_account_id ?? null) !== destinationAccountId
  )
}

/**
 * The funding account a user-routable derived line keeps: its own stored routing,
 * cleared to null under a goal-routed group (which carries no funding account, so
 * a lingering destination would break the DB CHECK).
 */
function preservedDestination(breakdown: Breakdown, line: BudgetLine | undefined): string | null {
  return groupRoutesViaGoal(breakdown.line_group) ? null : (line?.destination_account_id ?? null)
}

/** Queues the create/update to bring one partition's line to the given amount, name, and routing. */
function reconcilePartition(
  breakdown: Breakdown,
  totalCents: number,
  name: string,
  giftRecipientMemberId: string | null,
  destinationAccountId: string | null,
  line: BudgetLine | undefined,
  ops: BreakdownLineOps,
): void {
  if (!line) {
    ops.create.push(
      derivedInput(breakdown, totalCents, name, giftRecipientMemberId, destinationAccountId),
    )
  } else if (
    lineDrifted(line, breakdown, totalCents, name, giftRecipientMemberId, destinationAccountId)
  ) {
    ops.update.push({
      id: line.id,
      input: derivedInput(
        breakdown,
        totalCents,
        name,
        giftRecipientMemberId,
        destinationAccountId,
        line,
      ),
    })
  }
}

/** The derived line's name for a gift partition: the member's own line, else the breakdown's name. */
function giftLineName(
  breakdown: Breakdown,
  memberKey: string | null,
  memberNames: Map<string, string>,
  line: BudgetLine | undefined,
): string {
  if (memberKey === null) {
    return breakdown.name
  }
  const memberName = memberNames.get(memberKey)
  return memberName ? `Gifts for ${memberName}` : (line?.name ?? breakdown.name)
}

/** Reconciles a generic breakdown's single derived line against its item roll-up. */
function reconcileGenericBreakdown(
  breakdown: Breakdown,
  totalCents: number,
  itemCount: number,
  line: BudgetLine | undefined,
  ops: BreakdownLineOps,
): void {
  const destination = preservedDestination(breakdown, line)
  if (itemCount >= 1) {
    reconcilePartition(breakdown, totalCents, breakdown.name, null, destination, line, ops)
  } else if (line?.destination_account_id) {
    // No items left, but the line's routing must survive: keep it at $0.
    reconcilePartition(breakdown, 0, breakdown.name, null, destination, line, ops)
  } else if (line) {
    ops.remove.push(line.id)
  }
}

/**
 * The funding account a gift partition's line carries: for a member partition, the
 * buyer's (the other member's) spending account, auto-derived and never user-set,
 * cleared to null under a goal-routed group; for the external ("others") partition,
 * the line's own user-set routing.
 */
function giftPartitionDestination(
  breakdown: Breakdown,
  memberKey: string | null,
  line: BudgetLine | undefined,
  members: { id: string }[],
  directory: DirectoryAccount[],
): string | null {
  if (memberKey === null) {
    return preservedDestination(breakdown, line)
  }
  return groupRoutesViaGoal(breakdown.line_group)
    ? null
    : buyerSpendingAccountId(memberKey, members, directory)
}

/**
 * Reconciles the gift breakdown's derived lines, one per recipient partition: a
 * member with gift budgets, plus the external-recipients partition (`null` key).
 * A member partition's line exists purely while it has budgets, funded
 * automatically from the buyer's spending account; the external partition's line
 * survives an empty partition at $0 while it carries user-set routing. Any other
 * empty partition's line is removed.
 */
function reconcileGiftBreakdown(
  breakdown: Breakdown,
  totalsByMember: Map<string | null, number>,
  existingLines: BudgetLine[],
  memberNames: Map<string, string>,
  members: { id: string }[],
  directory: DirectoryAccount[],
  ops: BreakdownLineOps,
): void {
  const lineByKey = new Map<string | null, BudgetLine>()
  for (const line of existingLines) {
    lineByKey.set(line.gift_recipient_member_id ?? null, line)
  }

  // Reconcile every partition with budgets, plus the external line whose budgets
  // are gone but whose user-set routing must survive. A member line's routing is
  // auto-derived, so an empty member partition never pins a line.
  const keys = new Set<string | null>(totalsByMember.keys())
  if (lineByKey.get(null)?.destination_account_id) {
    keys.add(null)
  }
  for (const key of keys) {
    const line = lineByKey.get(key)
    const total = totalsByMember.get(key) ?? 0
    const name = giftLineName(breakdown, key, memberNames, line)
    const destination = giftPartitionDestination(breakdown, key, line, members, directory)
    reconcilePartition(breakdown, total, name, key, destination, line, ops)
  }

  // Remove a member line once its budgets are gone, and the external line once it
  // is both empty and unrouted.
  for (const line of existingLines) {
    const key = line.gift_recipient_member_id ?? null
    if (totalsByMember.has(key)) {
      continue
    }
    if (key === null && line.destination_account_id) {
      continue
    }
    ops.remove.push(line.id)
  }
}

/**
 * Computes the app-enforced derived-line lifecycle: a generic breakdown owns
 * exactly one line tracking its name, group, and item roll-up; the gift breakdown
 * owns one line per recipient partition (a member with gift budgets, plus the
 * external-recipients line), each tracking its partition total and named
 * "Gifts for <member>" (the breakdown's own name for the external line).
 *
 * - A partition with budgets/items but no line yields a create.
 * - A line whose name, group, amount, partition, frequency, or routing has drifted
 *   yields an update, keeping a user-routable line's own routing and goal link (a
 *   goal-routed group clears its funding account) while forcing each gift member
 *   line's routing to the buyer's spending account.
 * - A generic or external line with no budgets/items is removed unless it carries a
 *   `destination_account_id`, in which case its routing is preserved and it is kept
 *   at $0; a gift member line is removed as soon as its budgets are gone, since its
 *   routing is auto-derived rather than user-set.
 */
export function reconcileBreakdownLines(
  breakdowns: Breakdown[],
  context: DerivedAmountContext,
  counts: Map<string, number>,
  lines: BudgetLine[],
  memberNames: Map<string, string>,
  members: { id: string }[],
  directory: DirectoryAccount[],
): BreakdownLineOps {
  const ops: BreakdownLineOps = { create: [], update: [], remove: [] }
  for (const breakdown of breakdowns) {
    const breakdownLines = lines.filter((line) => line.breakdown_id === breakdown.id)
    if (breakdown.kind === 'gift') {
      reconcileGiftBreakdown(
        breakdown,
        context.giftTotalsByMember,
        breakdownLines,
        memberNames,
        members,
        directory,
        ops,
      )
    } else {
      reconcileGenericBreakdown(
        breakdown,
        context.genericTotalsByBreakdownId.get(breakdown.id) ?? 0,
        counts.get(breakdown.id) ?? 0,
        breakdownLines[0],
        ops,
      )
    }
  }
  return ops
}
