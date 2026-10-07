/**
 * The `pay-split` flow with its I/O injected, so the shape — resolve the
 * caller's household, load the routing rows, derive each account's recommended
 * fortnightly split — is unit-tested without a database. `index.ts` wires the
 * real service-role reads.
 *
 * It answers "how does my pay split": the same recommendation the PWA Splits tab
 * shows, computed by the shared `@nest/plan` routing (`assignmentsByAccount`,
 * `isRecommendedSplitAccount`, `roundCentsUpToStep`) from the household's budget
 * lines, goals, allowances, and pay account.
 */

import {
  type AssignableAllowance,
  type AssignableLine,
  assignmentsByAccount,
  type BudgetGroup,
  type Frequency,
  isRecommendedSplitAccount,
  roundCentsUpToStep,
} from '@nest/plan'
import type { CallerError } from '../_shared/caller.ts'

/** Pay splits are typed into a bank's app in round figures, so each is rounded up to the nearest $5. */
const ROUND_STEP_CENTS = 5_00

/** The `budget_line` columns this reads. */
export interface BudgetLineRow {
  id: string
  name: string
  line_group: BudgetGroup
  amount_cents: number
  frequency: Frequency
  interval_count: number | null
  goal_id: string | null
  destination_account_id: string | null
  allowance_member_id: string | null
}

/** The `savings_goal` columns this reads. */
export interface GoalRow {
  id: string
  linked_account_id: string | null
}

/** The `member_allowance` columns this reads. */
export interface AllowanceRow {
  member_id: string
  amount_cents: number
  frequency: Frequency
  interval_count: number | null
  destination_account_id: string | null
}

/** The `members` columns this reads. */
export interface MemberRow {
  id: string
  name: string
}

/** The `accounts` columns this reads. */
export interface AccountRow {
  id: string
  name: string
  source: string
  type: string
}

/** Everything the routing reads for one household. */
export interface PaySplitRows {
  budgetLines: readonly BudgetLineRow[]
  goals: readonly GoalRow[]
  allowances: readonly AllowanceRow[]
  members: readonly MemberRow[]
  accounts: readonly AccountRow[]
  /** The account the household's pay lands in, or `null` when none is designated. */
  payAccountId: string | null
}

/** One account's fortnightly figure in the response. */
export interface PaySplitAccount {
  accountId: string
  /** The account's name with any leading emoji stripped. */
  name: string
  /** The fortnightly amount, rounded up to the nearest $5. */
  fortnightlyCents: number
}

/** The `pay-split` response body. */
export interface PaySplitBody {
  /** Whether the household has designated the account its pay lands in. */
  hasPayAccount: boolean
  /** The recommended transfers out of the pay account, by name. */
  splits: PaySplitAccount[]
  /** The sum of `splits`. */
  totalCents: number
  /** Routed accounts whose amount stays put (the pay account, or spending accounts until one is designated). */
  stays: PaySplitAccount[]
  /** The fortnightly total of budget items not yet routed to an account. */
  unassignedFortnightlyCents: number
}

/** A leading emoji (an Up account icon) with its optional joiners and modifiers. */
const LEADING_EMOJI =
  /^(?:\p{Extended_Pictographic}(?:\u{FE0F}|\u{200D}\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*)/u

/** An account name with any leading emoji stripped; an emoji-only name is kept whole. */
export function accountLabel(name: string): string {
  const trimmed = name.trim()
  const match = trimmed.match(LEADING_EMOJI)
  if (!match) {
    return trimmed
  }
  const label = trimmed.slice(match[0].length).trim()
  return label === '' ? trimmed : label
}

/** Shapes the household's rows into the recommended splits, mirroring the Splits tab. */
export function shapePaySplit(rows: PaySplitRows): PaySplitBody {
  const lines: AssignableLine[] = rows.budgetLines.map((line) => ({
    id: line.id,
    name: line.name,
    group: line.line_group,
    amountCents: line.amount_cents,
    frequency: line.frequency,
    ...(line.interval_count != null && { interval: line.interval_count }),
    goalId: line.goal_id,
    destinationAccountId: line.destination_account_id,
    allowanceMemberId: line.allowance_member_id,
  }))
  const allowances: AssignableAllowance[] = rows.allowances.flatMap((row) => {
    const member = rows.members.find((candidate) => candidate.id === row.member_id)
    return member
      ? [{
        memberId: row.member_id,
        amountCents: row.amount_cents,
        frequency: row.frequency,
        ...(row.interval_count != null && { interval: row.interval_count }),
        name: `${member.name}’s allowance`,
        destinationAccountId: row.destination_account_id,
      }]
      : []
  })
  const { byAccount, unassignedFortnightlyCents } = assignmentsByAccount(
    lines,
    rows.goals.map((goal) => ({ id: goal.id, linkedAccountId: goal.linked_account_id })),
    allowances,
  )

  const accountById = new Map(rows.accounts.map((account) => [account.id, account]))
  const hasPayAccount = rows.payAccountId !== null
  const splits: PaySplitAccount[] = []
  const stays: PaySplitAccount[] = []
  for (const [accountId, exactCents] of Object.entries(byAccount)) {
    const account = accountById.get(accountId)
    if (!account) {
      continue
    }
    const entry = {
      accountId,
      name: accountLabel(account.name),
      fortnightlyCents: roundCentsUpToStep(exactCents, ROUND_STEP_CENTS),
    }
    const recommended = isRecommendedSplitAccount(
      {
        isPayAccount: accountId === rows.payAccountId,
        isSaver: account.source !== 'manual' && account.type === 'savings',
      },
      hasPayAccount,
    )
    ;(recommended ? splits : stays).push(entry)
  }
  const byName = (a: PaySplitAccount, b: PaySplitAccount) => a.name.localeCompare(b.name)
  splits.sort(byName)
  stays.sort(byName)

  return {
    hasPayAccount,
    splits,
    totalCents: splits.reduce((total, split) => total + split.fortnightlyCents, 0),
    stays,
    unassignedFortnightlyCents,
  }
}

export interface PaySplitDeps {
  /** Resolves the caller's household from their JWT, or the error to return. */
  resolveHousehold: () => Promise<{ householdId: string } | { error: CallerError }>
  /** Loads the household's routing rows. */
  loadRows: (householdId: string) => Promise<PaySplitRows>
}

export interface PaySplitResult {
  status: number
  body: unknown
}

export async function runPaySplit(deps: PaySplitDeps): Promise<PaySplitResult> {
  const resolved = await deps.resolveHousehold()
  if ('error' in resolved) {
    return { status: resolved.error.status, body: { error: resolved.error.message } }
  }
  return { status: 200, body: shapePaySplit(await deps.loadRows(resolved.householdId)) }
}
