import { DEFAULT_ASSUMPTIONS, type RetirementAssumptions } from '@nest/plan'

export const ASSUMPTIONS_STORAGE_KEY = 'super-retirement-assumptions'
export const AGES_STORAGE_KEY = 'super-retirement-ages'
export const PROJECTION_HORIZON_STORAGE_KEY = 'net-worth-projection-horizon'

/**
 * How far the net-worth projection runs: a fixed number of years, or `retirement`
 * to track the retirement-age-derived horizon.
 */
export type ProjectionHorizonOption = '5y' | '10y' | '20y' | '30y' | 'retirement'

/** The horizon selected until the household chooses otherwise. */
export const DEFAULT_PROJECTION_HORIZON_OPTION: ProjectionHorizonOption = 'retirement'

const PROJECTION_HORIZON_OPTIONS = new Set<ProjectionHorizonOption>([
  '5y',
  '10y',
  '20y',
  '30y',
  'retirement',
])

/**
 * Reads the stored projection horizon, falling back to the default when nothing is
 * stored or the stored value is not a recognised option.
 */
export function readProjectionHorizon(): ProjectionHorizonOption {
  const stored = localStorage.getItem(PROJECTION_HORIZON_STORAGE_KEY)
  return stored !== null && PROJECTION_HORIZON_OPTIONS.has(stored as ProjectionHorizonOption)
    ? (stored as ProjectionHorizonOption)
    : DEFAULT_PROJECTION_HORIZON_OPTION
}

/** Persists the household's projection horizon choice. */
export function writeProjectionHorizon(option: ProjectionHorizonOption): void {
  localStorage.setItem(PROJECTION_HORIZON_STORAGE_KEY, option)
}

export const PROJECTION_OPEN_STORAGE_KEY = 'net-worth-projection-open'

/**
 * Whether the net-worth projection section is expanded. Collapsed by default: only
 * an explicit stored `true` opens it.
 */
export function readProjectionOpen(): boolean {
  return localStorage.getItem(PROJECTION_OPEN_STORAGE_KEY) === 'true'
}

/** Persists whether the net-worth projection section is expanded. */
export function writeProjectionOpen(open: boolean): void {
  localStorage.setItem(PROJECTION_OPEN_STORAGE_KEY, open ? 'true' : 'false')
}

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
