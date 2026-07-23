import { annualCents } from '@nest/plan'
import type { BreakdownItem } from '../hooks/useBreakdownItems'
import type { Breakdown } from '../hooks/useBreakdowns'
import type { BudgetLine, BudgetLineInput } from '../hooks/useBudgetLines'
import { giftTotalsByMember, type GiftBudget, type GiftRecipient } from './gifts'

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

/** The derived-line fields a breakdown drives, preserving the line's routing and any goal link. */
function derivedInput(
  breakdown: Breakdown,
  totalCents: number,
  name: string,
  giftRecipientMemberId: string | null,
  line?: BudgetLine,
): BudgetLineInput {
  // A goal-routed group carries no funding account, so a lingering destination
  // is cleared to keep the DB CHECK satisfied when a breakdown moves to one.
  const destinationAccountId = groupRoutesViaGoal(breakdown.line_group)
    ? null
    : (line?.destination_account_id ?? null)
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

/** Whether a derived line has drifted from the name, group, amount, or partition it should carry. */
function lineDrifted(
  line: BudgetLine,
  breakdown: Breakdown,
  totalCents: number,
  name: string,
  giftRecipientMemberId: string | null,
): boolean {
  return (
    line.amount_cents !== totalCents ||
    line.name !== name ||
    line.line_group !== breakdown.line_group ||
    line.frequency !== 'annual' ||
    line.interval_count !== null ||
    (line.gift_recipient_member_id ?? null) !== giftRecipientMemberId ||
    (groupRoutesViaGoal(breakdown.line_group) && line.destination_account_id !== null)
  )
}

/** Queues the create/update to bring one partition's line to the given amount and name. */
function reconcilePartition(
  breakdown: Breakdown,
  totalCents: number,
  name: string,
  giftRecipientMemberId: string | null,
  line: BudgetLine | undefined,
  ops: BreakdownLineOps,
): void {
  if (!line) {
    ops.create.push(derivedInput(breakdown, totalCents, name, giftRecipientMemberId))
  } else if (lineDrifted(line, breakdown, totalCents, name, giftRecipientMemberId)) {
    ops.update.push({
      id: line.id,
      input: derivedInput(breakdown, totalCents, name, giftRecipientMemberId, line),
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
  if (itemCount >= 1) {
    reconcilePartition(breakdown, totalCents, breakdown.name, null, line, ops)
  } else if (line?.destination_account_id) {
    // No items left, but the line's routing must survive: keep it at $0.
    reconcilePartition(breakdown, 0, breakdown.name, null, line, ops)
  } else if (line) {
    ops.remove.push(line.id)
  }
}

/**
 * Reconciles the gift breakdown's derived lines, one per recipient partition: a
 * member with gift budgets, plus the external-recipients partition (`null` key).
 * A partition with budgets owns a line at its total; a partition whose budgets are
 * gone but whose line still carries routing survives at $0; any other empty
 * partition's line is removed.
 */
function reconcileGiftBreakdown(
  breakdown: Breakdown,
  totalsByMember: Map<string | null, number>,
  existingLines: BudgetLine[],
  memberNames: Map<string, string>,
  ops: BreakdownLineOps,
): void {
  const lineByKey = new Map<string | null, BudgetLine>()
  for (const line of existingLines) {
    lineByKey.set(line.gift_recipient_member_id ?? null, line)
  }

  // Reconcile every partition with budgets, plus any routed line whose budgets
  // are gone (so its Splits routing is preserved rather than dropped).
  const keys = new Set<string | null>(totalsByMember.keys())
  for (const line of existingLines) {
    if (line.destination_account_id) {
      keys.add(line.gift_recipient_member_id ?? null)
    }
  }
  for (const key of keys) {
    const line = lineByKey.get(key)
    const total = totalsByMember.get(key) ?? 0
    const name = giftLineName(breakdown, key, memberNames, line)
    reconcilePartition(breakdown, total, name, key, line, ops)
  }

  // Remove any gift line whose partition has neither budgets nor routing.
  for (const line of existingLines) {
    const key = line.gift_recipient_member_id ?? null
    if (!totalsByMember.has(key) && !line.destination_account_id) {
      ops.remove.push(line.id)
    }
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
 * - A line whose name, group, amount, partition, or frequency has drifted yields
 *   an update, keeping the line's routing and goal link; a line under a
 *   goal-routed group has its funding account cleared.
 * - A partition with no budgets/items whose line is empty yields a remove, unless
 *   the line carries a `destination_account_id`, in which case its routing is
 *   preserved and it is kept at $0.
 */
export function reconcileBreakdownLines(
  breakdowns: Breakdown[],
  context: DerivedAmountContext,
  counts: Map<string, number>,
  lines: BudgetLine[],
  memberNames: Map<string, string>,
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
