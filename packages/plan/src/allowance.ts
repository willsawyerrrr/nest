/**
 * Per-member spending allowance: a discretionary envelope for one household
 * member, and the budget lines drawn from it. Money stays pooled — the allowance
 * is a budgeting envelope — so a drawn line is one person's expense paid out of
 * their allowance and counts AGAINST it, never on top of it. The database refuses
 * to draw more than the allowance provides, so a member never overdraws.
 */

import type { BudgetLine, Frequency, Money } from './index.ts'
import { annualCents, fortnightlyCents } from './normalize.ts'
import type { Amounts } from './summary.ts'

/** A member's allowance: an amount on a frequency, the Discretionary outgoing for that person. */
export interface MemberAllowance {
  readonly memberId: string
  readonly amountCents: Money
  readonly frequency: Frequency
  /** The interval N for the `every_n_weeks`/`every_n_months` cadences. */
  readonly interval?: number
}

/**
 * One member's allowance reconciled against the lines drawn from it. The
 * allowance is the Discretionary outgoing for the person: drawn lines count
 * against it, never beyond it.
 */
export interface AllowanceSummary {
  readonly memberId: string
  readonly allowance: Amounts
  /** The total drawn from the allowance; zero where the drawn lines are not readable to the caller. */
  readonly drawn: Amounts
  /** The allowance less what is drawn. */
  readonly remaining: Amounts
}

/** A budget line that may be drawn from a member's allowance. */
type DrawableLine = Pick<BudgetLine, 'amountCents' | 'frequency' | 'interval' | 'allowanceMemberId'>

/**
 * Whether `line` is drawn from one of `allowances`. A line naming a member with
 * no allowance is an ordinary line: there is no envelope to count it against.
 */
export function isDrawnFromAllowance(
  line: Pick<BudgetLine, 'allowanceMemberId'>,
  allowances: readonly Pick<MemberAllowance, 'memberId'>[],
): boolean {
  return (
    line.allowanceMemberId != null &&
    allowances.some((allowance) => allowance.memberId === line.allowanceMemberId)
  )
}

function amountsOf(line: Pick<DrawableLine, 'amountCents' | 'frequency' | 'interval'>): Amounts {
  return {
    fortnightlyCents: fortnightlyCents(line.amountCents, line.frequency, line.interval),
    annualCents: annualCents(line.amountCents, line.frequency, line.interval),
  }
}

/**
 * Reconciles each allowance against the lines drawn from it, in allowance order.
 */
export function summariseAllowances(
  lines: readonly DrawableLine[],
  allowances: readonly MemberAllowance[],
): AllowanceSummary[] {
  return allowances.map((member) => {
    const allowance = amountsOf(member)
    const drawn = lines
      .filter((line) => line.allowanceMemberId === member.memberId)
      .map(amountsOf)
      .reduce(
        (total, amounts) => ({
          fortnightlyCents: total.fortnightlyCents + amounts.fortnightlyCents,
          annualCents: total.annualCents + amounts.annualCents,
        }),
        { fortnightlyCents: 0, annualCents: 0 },
      )
    return {
      memberId: member.memberId,
      allowance,
      drawn,
      remaining: {
        fortnightlyCents: allowance.fortnightlyCents - drawn.fortnightlyCents,
        annualCents: allowance.annualCents - drawn.annualCents,
      },
    }
  })
}
