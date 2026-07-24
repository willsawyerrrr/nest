import { accruedBalanceCents } from '@nest/plan'
import type { Account } from '../hooks/useAccounts'
import type { SuperContributionKind } from '../hooks/useSuperContributions'
import type { SuperProfile } from '../hooks/useSuperProfiles'

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

/** The set of account ids linked as a member's super balance, across all profiles. */
export function superAccountIds(profiles: readonly SuperProfile[]): Set<string> {
  return new Set(
    profiles.map((profile) => profile.linked_account_id).filter((id): id is string => id !== null),
  )
}

/**
 * Returns `accounts` with each super account's `balance_cents` replaced by its
 * effective balance today (baseline + accrued contributions for the account's
 * member). Non-super accounts, and super accounts whose profile has no as-of
 * date, are returned unchanged.
 */
export function accountsWithEffectiveSuperBalances(
  accounts: readonly Account[],
  profiles: readonly SuperProfile[],
  netContributionByMember: ReadonlyMap<string, number>,
  today: Date,
): Account[] {
  const profileByAccountId = new Map(
    profiles
      .filter((profile) => profile.linked_account_id !== null)
      .map((profile) => [profile.linked_account_id as string, profile]),
  )
  return accounts.map((account) => {
    const profile = profileByAccountId.get(account.id)
    if (!profile) {
      return account
    }
    return {
      ...account,
      balance_cents: accruedBalanceCents(
        account.balance_cents,
        profile.balance_as_of,
        netContributionByMember.get(profile.member_id) ?? 0,
        today,
      ),
    }
  })
}

/** A named liability that reduces net worth, e.g. a member's HELP debt. */
export interface Liability {
  label: string
  balanceCents: number
}

/**
 * A named equity holding that adds to net worth: the current vested value of a
 * member's equity grant, already valued as of the reporting date.
 */
export interface EquityHolding {
  label: string
  valueCents: number
}

/**
 * Net worth split into super vs other accounts, equity holdings, and
 * liabilities, each with a subtotal and a grand total, alongside the accounts the
 * household has excluded from net-worth tracking (surfaced so they can be toggled
 * back, never counted in the totals). The grand total is assets (super, other,
 * and vested equity) less liabilities.
 */
export interface NetWorthBreakdown {
  superAccounts: Account[]
  otherAccounts: Account[]
  excludedAccounts: Account[]
  equityHoldings: EquityHolding[]
  liabilities: Liability[]
  superTotalCents: number
  otherTotalCents: number
  equityTotalCents: number
  liabilitiesTotalCents: number
  totalCents: number
}

/** The sum of every account's `balance_cents`. */
function sumBalances(accounts: readonly Account[]): number {
  return accounts.reduce((total, account) => total + account.balance_cents, 0)
}

/**
 * Splits the included accounts into super accounts (those whose id is a
 * `super_account_id`) and everything else, with per-group subtotals. Accounts
 * flagged `exclude_from_net_worth` are collected separately and left out of every
 * subtotal and the total. The grand total is assets (super, other accounts, and
 * the supplied vested `equityHoldings`) less the supplied `liabilities` (e.g.
 * each member's HELP debt).
 */
export function netWorthBreakdown(
  accounts: readonly Account[],
  superIds: ReadonlySet<string>,
  liabilities: readonly Liability[] = [],
  equityHoldings: readonly EquityHolding[] = [],
): NetWorthBreakdown {
  const excludedAccounts = accounts.filter((account) => account.exclude_from_net_worth)
  const includedAccounts = accounts.filter((account) => !account.exclude_from_net_worth)
  const superAccounts = includedAccounts.filter((account) => superIds.has(account.id))
  const otherAccounts = includedAccounts.filter((account) => !superIds.has(account.id))
  const superTotalCents = sumBalances(superAccounts)
  const otherTotalCents = sumBalances(otherAccounts)
  const equityTotalCents = equityHoldings.reduce((total, holding) => total + holding.valueCents, 0)
  const liabilitiesTotalCents = liabilities.reduce(
    (total, liability) => total + liability.balanceCents,
    0,
  )
  return {
    superAccounts,
    otherAccounts,
    excludedAccounts,
    equityHoldings: [...equityHoldings],
    liabilities: [...liabilities],
    superTotalCents,
    otherTotalCents,
    equityTotalCents,
    liabilitiesTotalCents,
    totalCents: superTotalCents + otherTotalCents + equityTotalCents - liabilitiesTotalCents,
  }
}
