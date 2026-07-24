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
 * The rolled-up annual amounts every derived line reads, resolved per line. A
 * generic breakdown owns one line whose amount is `genericTotalsByBreakdownId`;
 * each gift line (keyed by `is_gift_line`) takes its share from
 * `giftTotalsByMember` (keyed by member id, `null` for external recipients).
 */
export interface DerivedAmountContext {
  /** Each generic breakdown's summed annualised item total, keyed by breakdown id. */
  genericTotalsByBreakdownId: Map<string, number>
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
 * never drift. Breakdowns are generic; the gift roll-up reads gift data alone.
 */
export function derivedAmountContext(
  breakdowns: Breakdown[],
  items: BreakdownItem[],
  giftBudgets: GiftBudget[],
  giftRecipients: GiftRecipient[],
): DerivedAmountContext {
  const genericTotalsByBreakdownId = new Map<string, number>()
  for (const breakdown of breakdowns) {
    genericTotalsByBreakdownId.set(breakdown.id, genericTotal(items, breakdown.id))
  }
  return {
    genericTotalsByBreakdownId,
    giftTotalsByMember: giftTotalsByMember(giftBudgets, giftRecipients),
  }
}

/**
 * Each generic breakdown's rolled-up annual total, keyed by breakdown id, for the
 * Breakdowns list, which shows one total per breakdown.
 */
export function breakdownTotalsByBreakdownId(
  breakdowns: Breakdown[],
  context: DerivedAmountContext,
): Map<string, number> {
  const totals = new Map<string, number>()
  for (const breakdown of breakdowns) {
    totals.set(breakdown.id, context.genericTotalsByBreakdownId.get(breakdown.id) ?? 0)
  }
  return totals
}

/**
 * How many items each generic breakdown owns, keyed by breakdown id, driving its
 * derived line's existence. Gift lines carry no `breakdown_item` rows (their
 * amounts live in `gift_budget`), so their lifecycle is driven by
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

/** The default budget group a brand-new gift line seeds into (a member line keeps its own group thereafter). */
const GIFT_LINE_DEFAULT_GROUP: Breakdown['line_group'] = 'wants'

/** The stable name of the external ("others") gift line — the one recipient partition with no household member. */
const EXTERNAL_GIFT_LINE_NAME = 'Gifts'

/** Whether a group routes via a savings goal rather than a funding account (the DB CHECK bars a destination). */
function groupRoutesViaGoal(group: Breakdown['line_group']): boolean {
  return group === 'savings' || group === 'investments'
}

/** The derived-line fields a roll-up drives, at the given effective group, routing, source, and any goal link. */
function derivedInput(
  breakdownId: string | null,
  isGiftLine: boolean,
  group: Breakdown['line_group'],
  totalCents: number,
  name: string,
  giftRecipientMemberId: string | null,
  destinationAccountId: string | null,
  line?: BudgetLine,
): BudgetLineInput {
  return {
    line_group: group,
    name,
    amount_cents: totalCents,
    frequency: 'annual',
    interval_count: null,
    goal_id: line?.goal_id ?? null,
    breakdown_id: breakdownId,
    destination_account_id: destinationAccountId,
    gift_recipient_member_id: giftRecipientMemberId,
    is_gift_line: isGiftLine,
  }
}

/** Whether a derived line has drifted from the name, group, amount, partition, or routing it should carry. */
function lineDrifted(
  line: BudgetLine,
  group: Breakdown['line_group'],
  totalCents: number,
  name: string,
  giftRecipientMemberId: string | null,
  destinationAccountId: string | null,
): boolean {
  return (
    line.amount_cents !== totalCents ||
    line.name !== name ||
    line.line_group !== group ||
    line.frequency !== 'annual' ||
    line.interval_count !== null ||
    (line.gift_recipient_member_id ?? null) !== giftRecipientMemberId ||
    (line.destination_account_id ?? null) !== destinationAccountId
  )
}

/**
 * The funding account a user-routable derived line keeps: its own stored routing,
 * cleared to null under a goal-routed effective group (which carries no funding
 * account, so a lingering destination would break the DB CHECK).
 */
function preservedDestination(
  group: Breakdown['line_group'],
  line: BudgetLine | undefined,
): string | null {
  return groupRoutesViaGoal(group) ? null : (line?.destination_account_id ?? null)
}

/** Queues the create/update to bring one partition's line to the given amount, name, group, source, and routing. */
function reconcilePartition(
  breakdownId: string | null,
  isGiftLine: boolean,
  group: Breakdown['line_group'],
  totalCents: number,
  name: string,
  giftRecipientMemberId: string | null,
  destinationAccountId: string | null,
  line: BudgetLine | undefined,
  ops: BreakdownLineOps,
): void {
  if (!line) {
    ops.create.push(
      derivedInput(
        breakdownId,
        isGiftLine,
        group,
        totalCents,
        name,
        giftRecipientMemberId,
        destinationAccountId,
      ),
    )
  } else if (
    lineDrifted(line, group, totalCents, name, giftRecipientMemberId, destinationAccountId)
  ) {
    ops.update.push({
      id: line.id,
      input: derivedInput(
        breakdownId,
        isGiftLine,
        group,
        totalCents,
        name,
        giftRecipientMemberId,
        destinationAccountId,
        line,
      ),
    })
  }
}

/** The derived line's name for a gift partition: the member's own line, else the stable external-line name. */
function giftLineName(
  memberKey: string | null,
  memberNames: Map<string, string>,
  line: BudgetLine | undefined,
): string {
  if (memberKey === null) {
    return EXTERNAL_GIFT_LINE_NAME
  }
  const memberName = memberNames.get(memberKey)
  return memberName ? `Gifts for ${memberName}` : (line?.name ?? EXTERNAL_GIFT_LINE_NAME)
}

/**
 * Reconciles a generic breakdown's single derived line against its item roll-up.
 * Its effective group is the breakdown's own group, so the line always tracks the
 * breakdown's group.
 */
function reconcileGenericBreakdown(
  breakdown: Breakdown,
  totalCents: number,
  itemCount: number,
  line: BudgetLine | undefined,
  ops: BreakdownLineOps,
): void {
  const group = breakdown.line_group
  const destination = preservedDestination(group, line)
  if (itemCount >= 1) {
    reconcilePartition(
      breakdown.id,
      false,
      group,
      totalCents,
      breakdown.name,
      null,
      destination,
      line,
      ops,
    )
  } else if (line?.destination_account_id) {
    // No items left, but the line's routing must survive: keep it at $0.
    reconcilePartition(breakdown.id, false, group, 0, breakdown.name, null, destination, line, ops)
  } else if (line) {
    ops.remove.push(line.id)
  }
}

/**
 * The funding account a gift partition's line carries: for a member partition, the
 * buyer's (the other member's) spending account, auto-derived and never user-set,
 * cleared to null under a goal-routed effective group; for the external ("others")
 * partition, the line's own user-set routing.
 */
function giftPartitionDestination(
  group: Breakdown['line_group'],
  memberKey: string | null,
  line: BudgetLine | undefined,
  members: { id: string }[],
  directory: DirectoryAccount[],
): string | null {
  if (memberKey === null) {
    return preservedDestination(group, line)
  }
  return groupRoutesViaGoal(group) ? null : buyerSpendingAccountId(memberKey, members, directory)
}

/**
 * Reconciles the household's gift lines against its gift data alone, keyed off
 * `budget_line.is_gift_line` — no breakdown involved. It yields one line per
 * recipient partition: a member with gift budgets, plus the external-recipients
 * partition (`null` key). A member partition's line exists purely while it has
 * budgets, funded automatically from the buyer's spending account; the external
 * partition's line survives an empty partition at $0 while it carries user-set
 * routing. Any other empty partition's line is removed. Each member line's group
 * is its own line's group (a brand-new gift line seeds {@link GIFT_LINE_DEFAULT_GROUP}),
 * so a gift line's group is per-line and never overwritten by reconcile. Every
 * line it writes is stamped `is_gift_line: true` and `breakdown_id: null`.
 */
export function reconcileGiftLines(
  totalsByMember: Map<string | null, number>,
  lines: BudgetLine[],
  memberNames: Map<string, string>,
  members: { id: string }[],
  directory: DirectoryAccount[],
): BreakdownLineOps {
  const ops: BreakdownLineOps = { create: [], update: [], remove: [] }
  const giftLines = lines.filter((line) => line.is_gift_line)
  const lineByKey = new Map<string | null, BudgetLine>()
  for (const line of giftLines) {
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
    const name = giftLineName(key, memberNames, line)
    // Preserve the line's own group; a brand-new gift line seeds the default.
    const group = line?.line_group ?? GIFT_LINE_DEFAULT_GROUP
    const destination = giftPartitionDestination(group, key, line, members, directory)
    reconcilePartition(null, true, group, total, name, key, destination, line, ops)
  }

  // Remove a member line once its budgets are gone, and the external line once it
  // is both empty and unrouted.
  for (const line of giftLines) {
    const key = line.gift_recipient_member_id ?? null
    if (totalsByMember.has(key)) {
      continue
    }
    if (key === null && line.destination_account_id) {
      continue
    }
    ops.remove.push(line.id)
  }
  return ops
}

/**
 * Computes the app-enforced derived-line lifecycle for generic breakdowns: each
 * owns exactly one line tracking its name, group, and item roll-up, linked by
 * `budget_line.breakdown_id`. Gift lines are reconciled separately by
 * {@link reconcileGiftLines}; a `kind === 'gift'` breakdown (should one linger
 * during a data migration) is skipped here.
 *
 * A generic line's group tracks its breakdown's group.
 *
 * - A breakdown with items but no line yields a create.
 * - A line whose name, group, amount, source, frequency, or routing has drifted
 *   yields an update, keeping the line's own routing and goal link (a goal-routed
 *   group clears its funding account).
 * - A line with no items is removed unless it carries a `destination_account_id`,
 *   in which case its routing is preserved and it is kept at $0.
 */
export function reconcileBreakdownLines(
  breakdowns: Breakdown[],
  context: DerivedAmountContext,
  counts: Map<string, number>,
  lines: BudgetLine[],
): BreakdownLineOps {
  const ops: BreakdownLineOps = { create: [], update: [], remove: [] }
  for (const breakdown of breakdowns) {
    if (breakdown.kind === 'gift') {
      continue
    }
    const breakdownLines = lines.filter((line) => line.breakdown_id === breakdown.id)
    reconcileGenericBreakdown(
      breakdown,
      context.genericTotalsByBreakdownId.get(breakdown.id) ?? 0,
      counts.get(breakdown.id) ?? 0,
      breakdownLines[0],
      ops,
    )
  }
  return ops
}
