import {
  previewOneOffPaymentSplit,
  toIncomeInput,
  type InflowRow,
  type StoredOneOffTaxTreatment,
} from '@nest/household'
import {
  annualInflowGrossCents,
  describePerPayment,
  fortnightlyCents,
  type Frequency,
  type PerPayment,
} from '@nest/plan'
import {
  annualGrossCents,
  configsByYear,
  financialYearForDate,
  FY2027_CONFIG,
  type OneOffPaymentSplit,
} from '@nest/tax'

/** An inflow as the list reads it: the row's columns the fortnightly figure depends on. */
export interface InflowListRow extends InflowRow {
  id: string
}

/** The input of {@link summariseInflows}. */
export interface InflowsInput {
  inflows: InflowListRow[]
}

/** One inflow's fortnightly-normalised gross, null for a one-off, which has none. */
export interface InflowFortnightly {
  inflowId: string
  fortnightlyCents: number | null
}

/**
 * Each inflow's fortnightly figure, as the Inflows list shows it: its annualised gross
 * drawn per fortnight, or null for a ONE-OFF, which has no fortnightly reading at all
 * (dividing a payment that lands once by 26 states a figure 25 fortnights never see).
 */
export function summariseInflows(input: InflowsInput) {
  const items: InflowFortnightly[] = input.inflows.map((inflow) => ({
    inflowId: inflow.id,
    fortnightlyCents:
      inflow.paid_on != null
        ? null
        : fortnightlyCents(annualGrossCents(toIncomeInput(inflow)), 'annual'),
  }))
  return { items }
}

/** The input of {@link previewInflowDraft}: what the add/edit form has entered so far. */
export interface InflowDraftInput {
  /** ISO 8601 instant; it picks the tax year the one-off split is read against. */
  now: string
  isWage: boolean
  schedule: Frequency
  interval?: number
  /** Present once entered; a wage needs both `hourlyRateCents` and `hoursPerPeriod`. */
  amountCents?: number
  hourlyRateCents?: number
  hoursPerPeriod?: number
  /** The pay cadence; null when money arrives on the amount's own frequency. */
  payCadence: Frequency | null
  payInterval?: number
  /** A taxable one-off with an amount and a date, whose split to show. */
  oneOff?: {
    treatment: StoredOneOffTaxTreatment
    amountCents: number
    yearsOfService?: number
    dateOfBirth: string | null
    paidOn: string
  }
}

/** What the form shows back before anything is saved. */
export interface InflowDraftPreview {
  statedAnnualCents: number | null
  perPayment: PerPayment | null
  split: OneOffPaymentSplit | null
}

/**
 * The figures the inflow form derives from its draft: the annual total the amount
 * states, what one payment on the pay cadence comes to, and a taxable one-off's split
 * under its treatment. The same arithmetic the payslip expectation and the estimate use.
 */
export function previewInflowDraft(input: InflowDraftInput): InflowDraftPreview {
  const entered = input.isWage
    ? input.hourlyRateCents !== undefined && input.hoursPerPeriod !== undefined
    : input.amountCents !== undefined
  const statedAnnualCents = entered
    ? annualInflowGrossCents({
        type: input.isWage ? 'wage' : 'other',
        schedule: input.schedule,
        ...(input.interval !== undefined && { interval: input.interval }),
        ...(input.isWage
          ? {
              hourlyRateCents: input.hourlyRateCents ?? 0,
              hoursPerPeriod: input.hoursPerPeriod ?? 0,
            }
          : { amountCents: input.amountCents ?? 0 }),
      })
    : null
  const config = configsByYear[financialYearForDate(new Date(input.now))] ?? FY2027_CONFIG
  return {
    statedAnnualCents,
    perPayment: describePerPayment(
      statedAnnualCents,
      input.schedule,
      input.interval,
      input.payCadence,
      input.payInterval,
    ),
    split: input.oneOff ? previewOneOffPaymentSplit(input.oneOff, config) : null,
  }
}
