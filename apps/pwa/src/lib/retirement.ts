import type { SuperProjectionInput } from '@nest/plan'

/**
 * Household-level retirement-projection assumptions, shared across members and
 * persisted in localStorage. Ages are held separately, per member. Percentages
 * are whole numbers as shown in the UI (7 = 7%), converted to decimal rates when
 * building the projection input.
 */
export interface RetirementAssumptions {
  /** Age each member's super is assumed to be accessed at (default preservation age). */
  retirementAge: number
  /** Expected nominal annual fund return, as a percentage. */
  expectedReturnPct: number
  /** Expected annual inflation, as a percentage, used to deflate to today's dollars. */
  inflationPct: number
  /** Year-on-year growth of the annual contribution, as a percentage. */
  contributionGrowthPct: number
}

/** Default retirement age when none is stored — the FY2027 preservation age. */
const DEFAULT_RETIREMENT_AGE = 60

/** Assumptions used until the household edits them. */
export const DEFAULT_ASSUMPTIONS: RetirementAssumptions = {
  retirementAge: DEFAULT_RETIREMENT_AGE,
  expectedReturnPct: 7,
  inflationPct: 2.5,
  contributionGrowthPct: 0,
}

export const ASSUMPTIONS_STORAGE_KEY = 'super-retirement-assumptions'
export const AGES_STORAGE_KEY = 'super-retirement-ages'

/** A member's current age keyed by member id; missing when not yet entered. */
export type MemberAges = Record<string, number>

/** Reads the number at `key`, or `fallback` when absent, unparseable, or non-finite. */
function readNumber(raw: unknown, fallback: number): number {
  const value = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(value) ? value : fallback
}

/**
 * Reads the stored assumptions, filling any missing or invalid field from
 * `DEFAULT_ASSUMPTIONS` so the result is always complete and finite.
 */
export function readAssumptions(): RetirementAssumptions {
  try {
    const stored = localStorage.getItem(ASSUMPTIONS_STORAGE_KEY)
    if (!stored) {
      return DEFAULT_ASSUMPTIONS
    }
    const parsed = JSON.parse(stored) as Partial<RetirementAssumptions>
    return {
      retirementAge: readNumber(parsed.retirementAge, DEFAULT_ASSUMPTIONS.retirementAge),
      expectedReturnPct: readNumber(
        parsed.expectedReturnPct,
        DEFAULT_ASSUMPTIONS.expectedReturnPct,
      ),
      inflationPct: readNumber(parsed.inflationPct, DEFAULT_ASSUMPTIONS.inflationPct),
      contributionGrowthPct: readNumber(
        parsed.contributionGrowthPct,
        DEFAULT_ASSUMPTIONS.contributionGrowthPct,
      ),
    }
  } catch {
    return DEFAULT_ASSUMPTIONS
  }
}

/** Persists the household's assumptions. */
export function writeAssumptions(assumptions: RetirementAssumptions): void {
  localStorage.setItem(ASSUMPTIONS_STORAGE_KEY, JSON.stringify(assumptions))
}

/** Reads the stored per-member ages, or an empty map when absent or unparseable. */
export function readMemberAges(): MemberAges {
  try {
    const stored = localStorage.getItem(AGES_STORAGE_KEY)
    if (!stored) {
      return {}
    }
    const parsed = JSON.parse(stored) as Record<string, unknown>
    const ages: MemberAges = {}
    for (const [memberId, value] of Object.entries(parsed)) {
      const age = Number(value)
      if (Number.isFinite(age)) {
        ages[memberId] = age
      }
    }
    return ages
  } catch {
    return {}
  }
}

/**
 * Returns a new ages map with `memberId` set to `age` (or removed when `age` is
 * null), and persists it. The input map is not mutated.
 */
export function setMemberAge(ages: MemberAges, memberId: string, age: number | null): MemberAges {
  const next = { ...ages }
  if (age === null) {
    delete next[memberId]
  } else {
    next[memberId] = age
  }
  localStorage.setItem(AGES_STORAGE_KEY, JSON.stringify(next))
  return next
}

/** Whole years from `currentAge` to `retirementAge`, never negative. */
export function yearsToRetirement(currentAge: number, retirementAge: number): number {
  return Math.max(0, Math.round(retirementAge - currentAge))
}

/**
 * Builds the pure `projectSuperBalance` input from a member's balance, net annual
 * contribution, and age together with the household assumptions — converting the
 * whole-number percentages to decimal rates and the ages to a year count.
 */
export function toProjectionInput(
  currentBalanceCents: number,
  netAnnualContributionCents: number,
  currentAge: number,
  assumptions: RetirementAssumptions,
): SuperProjectionInput {
  return {
    currentBalanceCents,
    annualContributionCents: netAnnualContributionCents,
    years: yearsToRetirement(currentAge, assumptions.retirementAge),
    nominalReturnRate: assumptions.expectedReturnPct / 100,
    inflationRate: assumptions.inflationPct / 100,
    contributionGrowthRate: assumptions.contributionGrowthPct / 100,
  }
}
