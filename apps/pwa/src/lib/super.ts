import type { SuperContributionKind } from '../hooks/useSuperContributions'

/** Human-readable labels for each super-contribution kind, for forms and lists. */
export const SUPER_CONTRIBUTION_KINDS: { value: SuperContributionKind; label: string }[] = [
  { value: 'salary_sacrifice', label: 'Salary sacrifice' },
  { value: 'personal_deductible', label: 'Personal (deductible)' },
  { value: 'personal_non_concessional', label: 'Personal (non-concessional)' },
  { value: 'spouse', label: 'Spouse' },
]

/**
 * The account name for a member's super: the fund name when given, otherwise a
 * "<member> Super" fallback so the account is still identifiable.
 */
export function superAccountName(fundName: string | null, memberName: string): string {
  const trimmed = fundName?.trim()
  return trimmed ? trimmed : `${memberName} Super`
}

export {
  accountsWithEffectiveSuperBalances,
  homeLoanLiabilities,
  homeLoanOwedCents,
  netWorthBreakdown,
  superAccountIds,
} from '@nest/household'
export type { EquityHolding, Liability, NetWorthBreakdown } from '@nest/household'
