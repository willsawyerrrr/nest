import type { BudgetLine } from '../hooks/useBudgetLines'
import { accountLabel } from './accountName'
import type { BudgetGroup } from './domain'

/** Whether lines in a group route via a savings goal rather than a funding account. */
function groupLinksGoal(group: BudgetGroup): boolean {
  return group === 'savings' || group === 'investments'
}

/** Where a budget line sends its money, ready to render as a route badge. */
export interface LineRoute {
  /** The account/saver name the icon is derived from. */
  iconName: string
  /** The route's emoji-stripped display text. */
  label: string
  /** The badge's hover text. */
  title: string
}

/**
 * The route a line displays: a Savings/Investments line names its linked goal,
 * iconed by the goal's linked saver; every other line names its funding account.
 * Undefined when the line is unrouted or the target is not in the supplied data.
 */
export function resolveRoute(
  line: BudgetLine,
  goals: { id: string; name: string; linkedAccountId?: string | null }[],
  accountNames: Map<string, string>,
): LineRoute | undefined {
  if (groupLinksGoal(line.line_group)) {
    const goal = line.goal_id ? goals.find((g) => g.id === line.goal_id) : undefined
    if (!goal) {
      return undefined
    }
    const label = accountLabel(goal.name)
    const linkedName = goal.linkedAccountId ? accountNames.get(goal.linkedAccountId) : undefined
    return { iconName: linkedName ?? goal.name, label, title: `Goal: ${label}` }
  }
  const name = line.destination_account_id
    ? accountNames.get(line.destination_account_id)
    : undefined
  if (!name) {
    return undefined
  }
  const label = accountLabel(name)
  return { iconName: name, label, title: `Funded from ${label}` }
}
