import {
  assessableByMemberFromInflows,
  grossByMemberFromInflows,
  netAnnualSuperContributionByMember,
  superCapSummaryByMember,
  type InflowRow,
  type MemberIdRow,
  type SuperCapSummary,
  type SuperContributionRow,
  type SuperProfileRow,
} from '@nest/household'
import {
  accruedBalanceCents,
  DEFAULT_ASSUMPTIONS,
  projectSuperBalance,
  toProjectionInput,
  yearsToRetirement,
  type RetirementAssumptions,
} from '@nest/plan'
import { configsByYear, financialYearForDate, FY2027_CONFIG } from '@nest/tax'

/** A member's super balance as last confirmed, from their linked account. */
export interface SuperBaseline {
  memberId: string
  baselineCents: number
  /** The `YYYY-MM-DD` date the baseline was confirmed; null when it is current. */
  balanceAsOf: string | null
}

/** The input of {@link summariseSuper}. */
export interface SuperInput {
  inflows: InflowRow[]
  profiles: SuperProfileRow[]
  contributions: SuperContributionRow[]
  members: MemberIdRow[]
  baselines: SuperBaseline[]
  /** ISO 8601 instant; it picks the financial year's config and the balances' accrual. */
  now: string
}

/** One member's super figures. */
export interface MemberSuper {
  memberId: string
  /** Cap usage; null for a member with neither a contribution nor a profile. */
  caps: SuperCapSummary | null
  netAnnualContributionCents: number
  /** The baseline plus the contributions accrued since it was confirmed. */
  effectiveBalanceCents: number
}

/**
 * Each member's cap summary, net annual contribution and effective balance at
 * `input.now`, with the preservation age and default assumptions of that year.
 */
export function summariseSuper(input: SuperInput) {
  const now = new Date(input.now)
  const config = configsByYear[financialYearForDate(now)] ?? FY2027_CONFIG
  const memberIds = input.members.map((member) => member.id)
  const gross = grossByMemberFromInflows(input.inflows, config, memberIds)
  const assessable = assessableByMemberFromInflows(input.inflows, config, memberIds)
  const caps = superCapSummaryByMember(
    input.contributions,
    input.profiles,
    gross,
    assessable,
    config,
  )
  const net = netAnnualSuperContributionByMember(input.contributions, gross, assessable, config)
  const members: MemberSuper[] = input.members.map(({ id }) => {
    const baseline = input.baselines.find((candidate) => candidate.memberId === id)
    const netAnnualContributionCents = net.get(id) ?? 0
    return {
      memberId: id,
      caps: caps.get(id) ?? null,
      netAnnualContributionCents,
      effectiveBalanceCents: accruedBalanceCents(
        baseline?.baselineCents ?? 0,
        baseline?.balanceAsOf ?? null,
        netAnnualContributionCents,
        now,
      ),
    }
  })
  return {
    preservationAge: config.super.preservationAge,
    defaultAssumptions: DEFAULT_ASSUMPTIONS,
    members,
  }
}

/** The input of {@link projectSuper}: each member's balance, contribution and age. */
export interface SuperProjectionsInput {
  entries: {
    currentBalanceCents: number
    netAnnualContributionCents: number
    /** The member's current age; null when not entered. */
    age: number | null
  }[]
  assumptions: RetirementAssumptions
}

/**
 * Each entry's balance at retirement (nominal and today's dollars) and years to
 * retirement, in input order; null for an entry without an age.
 */
export function projectSuper(input: SuperProjectionsInput) {
  return input.entries.map((entry) => {
    if (entry.age === null) {
      return null
    }
    const projection = projectSuperBalance(
      toProjectionInput(
        entry.currentBalanceCents,
        entry.netAnnualContributionCents,
        entry.age,
        input.assumptions,
      ),
    )
    return {
      ...projection,
      yearsToRetirement: yearsToRetirement(entry.age, input.assumptions.retirementAge),
    }
  })
}
