import type { AssignableAllowance, MemberAllowance as PlanAllowance } from '@nest/plan'
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
