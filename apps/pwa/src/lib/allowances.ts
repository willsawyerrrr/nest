import {
  summariseAllowances,
  type AssignableAllowance,
  type MemberAllowance as PlanAllowance,
} from '@nest/plan'
import type { BudgetLine } from '../hooks/useBudgetLines'
import type { MemberAllowance } from '../hooks/useMemberAllowances'

/** The name a member's allowance goes by in lists and pickers, e.g. `Ada’s allowance`. */
export function allowanceName(memberName: string): string {
  return `${memberName}’s allowance`
}

/** An allowance row in the plan's shape. */
export function toPlanAllowance(row: MemberAllowance): PlanAllowance {
  return {
    memberId: row.member_id,
    amountCents: row.amount_cents,
    frequency: row.frequency,
    ...(row.interval_count != null && { interval: row.interval_count }),
  }
}

/** A budget line in the shape the plan's allowance reconciliation reads. */
export function toPlanDrawableLine(line: BudgetLine) {
  return {
    amountCents: line.amount_cents,
    frequency: line.frequency,
    ...(line.interval_count != null && { interval: line.interval_count }),
    allowanceMemberId: line.allowance_member_id,
  }
}

/** The allowances with their display name and funding account, ready for pay-split routing. */
export function toAssignableAllowances(
  rows: readonly MemberAllowance[],
  members: readonly { id: string; name: string }[],
): AssignableAllowance[] {
  return rows.flatMap((row) => {
    const member = members.find((candidate) => candidate.id === row.member_id)
    return member
      ? [
          {
            ...toPlanAllowance(row),
            name: allowanceName(member.name),
            destinationAccountId: row.destination_account_id,
          },
        ]
      : []
  })
}

/** The message of the database's refusal to overdraw an allowance. */
const ALLOWANCE_OVERDRAWN = 'allowance_overdrawn'

/** Whether `error` is the database refusing to overdraw an allowance. */
export function isAllowanceOverdrawn(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    error.message === ALLOWANCE_OVERDRAWN
  )
}

/** The copy shown when saving an item is refused because it would overdraw an allowance. */
export const ITEM_OVERDRAWS_ALLOWANCE =
  'That is more than is left in the allowance. Lower the amount, or draw it from elsewhere.'

/** The copy shown when lowering an allowance is refused because it would fall below what is drawn. */
export const ALLOWANCE_BELOW_DRAWN =
  'An allowance cannot be lowered below what is already drawn from it.'

/** The copy shown when saving planning changes is refused because an item would overdraw an allowance. */
export const PLAN_OVERDRAWS_ALLOWANCE =
  'An item would draw more than an allowance provides. Nothing was lost; lower the item or raise the allowance, then try again.'

/** An allowance a line can be drawn from, with the annual amount still undrawn. */
export interface AllowanceChoice {
  memberId: string
  name: string
  /** The allowance's annual amount less what the readable lines draw from it. */
  remainingAnnualCents: number
}

/** The signed-in member's allowance as a choice for a drawn line, with what is left to draw. */
export function allowanceChoices(
  allowances: readonly { name: string; allowance: PlanAllowance }[],
  lines: readonly BudgetLine[],
  memberId: string | null,
): AllowanceChoice[] {
  const summaries = summariseAllowances(
    lines.map(toPlanDrawableLine),
    allowances.map(({ allowance }) => allowance),
  )
  return allowances.flatMap(({ name, allowance }) => {
    const summary = summaries.find((candidate) => candidate.memberId === allowance.memberId)
    return allowance.memberId === memberId && summary
      ? [{ memberId, name, remainingAnnualCents: summary.remaining.annualCents }]
      : []
  })
}
