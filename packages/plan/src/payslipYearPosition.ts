/**
 * The financial year so far held against the plan, summed from the payslips
 * entered. Each figure — gross, tax withheld, super — is the sum of the
 * expectations already measured for the individual slips, never an annual
 * projection multiplied by the share of the year elapsed.
 *
 * Summing the slips' own expectations compares like with like. It asks what the
 * plan projected for the periods that were actually recorded, so a member who has
 * not entered last fortnight's slip yet reads as on plan rather than a fortnight's
 * pay behind, and a year of on-plan slips reads as on plan on whatever date it is
 * looked at. Apportioning an annual figure by elapsed time would instead measure
 * how up to date the data entry is, which is the job of the reported year-to-date
 * cross-check rather than of a plan position.
 *
 * It also makes a total and the cards under it two readings of one measurement:
 * the same {@link PayslipVariance} the card renders is what the year adds up, so
 * the two cannot disagree.
 */

import type { Money } from './index.ts'
import type { PayslipVariance } from './payslip.ts'

/**
 * One payslip as the year's position reads it: the actual figures it paid,
 * alongside the variance already measured for its own card. Gross and withheld
 * come from the slip because the variance carries only the expected side of them;
 * super comes from the variance, which is where the slip's employer super and
 * salary sacrifice are already added into the one concessional total the
 * expectation is built to match.
 */
export interface PayslipPositionRow {
  readonly grossCents: Money
  readonly taxWithheldCents: Money
  readonly variance: PayslipVariance
}

/**
 * One year-to-date figure held against the plan.
 *
 * The two counts are the point of the shape. `expectedCents`, `actualCents`, and
 * `varianceCents` are summed over the `coveredCount` slips whose expectation is
 * known — not over all `payslipCount` of them — because a slip with no
 * expectation has nothing to be above or below. Such a slip is left out of BOTH
 * sides rather than held against nil, which would report every dollar it paid as
 * a surplus and turn an unmapped slip into a windfall. Where the counts differ
 * the position therefore speaks for part of the year, and a reader has to be told
 * so: `coveredCount` is what says how much of it.
 *
 * `expectedCents` and `varianceCents` are null only where no slip carried an
 * expectation at all, which reads as nothing to compare rather than as on plan.
 */
export interface PayslipYearPosition {
  /**
   * The covered slips' actuals summed — the side of the year the variance
   * measures, which is the whole year's actual only when every slip is covered.
   */
  readonly actualCents: Money
  readonly expectedCents: Money | null
  readonly varianceCents: Money | null
  /** Slips whose expectation was known, and so counted on both sides. */
  readonly coveredCount: number
  /** Slips considered, whether or not they carried an expectation. */
  readonly payslipCount: number
}

/** A member's year to date against the plan, one position per figure. */
export interface PayslipYearPositions {
  readonly gross: PayslipYearPosition
  readonly taxWithheld: PayslipYearPosition
  readonly super: PayslipYearPosition
}

/** One figure of one slip: what it paid, and what the plan expected of it. */
interface PositionFigure {
  readonly actualCents: Money
  readonly expectedCents: Money | null
}

/** Sums one figure across the slips carrying an expectation for it. */
function positionOf(figures: readonly PositionFigure[]): PayslipYearPosition {
  let actualCents = 0
  let expectedCents: Money | null = null
  let coveredCount = 0
  for (const figure of figures) {
    if (figure.expectedCents === null) {
      continue
    }
    actualCents += figure.actualCents
    expectedCents = (expectedCents ?? 0) + figure.expectedCents
    coveredCount += 1
  }
  return {
    actualCents,
    expectedCents,
    varianceCents: expectedCents === null ? null : actualCents - expectedCents,
    coveredCount,
    payslipCount: figures.length,
  }
}

/**
 * Measures a member's financial year against the plan: their gross, withholding,
 * and super each summed over the slips whose expectation is known and held
 * against those slips' expectations summed. Pass one member's rows for one
 * financial year; no rows yields three positions covering nothing.
 *
 * The three are counted separately because a slip may carry one figure's
 * expectation and not another's — a slip nothing on which names a projection has
 * no gross to expect, while its withholding is still apportioned from the
 * member's estimated liability — so each figure reports the slips it really
 * covers rather than the weakest of the three.
 */
export function payslipYearPositions(rows: readonly PayslipPositionRow[]): PayslipYearPositions {
  return {
    gross: positionOf(
      rows.map((row) => ({
        actualCents: row.grossCents,
        expectedCents: row.variance.expectedGrossCents,
      })),
    ),
    taxWithheld: positionOf(
      rows.map((row) => ({
        actualCents: row.taxWithheldCents,
        expectedCents: row.variance.expectedTaxWithheldCents,
      })),
    ),
    super: positionOf(
      rows.map((row) => ({
        actualCents: row.variance.actualSuperCents,
        expectedCents: row.variance.expectedSuperCents,
      })),
    ),
  }
}
