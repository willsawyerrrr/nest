import { splitOneOffPayment, type OneOffPaymentSplit, type TaxYearConfig } from '@nest/tax'
import type { InflowInput, OneOffTaxTreatment } from '../hooks/useInflows'
import { atPreservationAgeOn, ENGINE_ONE_OFF_TREATMENTS } from './tax'

/** The treatment a taxable one-off starts on: assessable in full, at marginal rates. */
const DEFAULT_TREATMENT: OneOffTaxTreatment = 'ordinary'

/** The recurrence fields an inflow form decides between, whichever mode it is in. */
export type RecurrenceInput = Pick<
  InflowInput,
  'paid_on' | 'one_off_tax_treatment' | 'years_of_service'
>

/**
 * The one-off fields an inflow form holds while it is being edited. `yearsOfService`
 * is the raw `NumberInput` value, so it carries the empty string a figure not yet
 * typed leaves behind.
 */
export interface OneOffDraft {
  readonly paidOn: string | null
  readonly treatment: OneOffTaxTreatment
  readonly yearsOfService: number | string
}

/**
 * The draft an inflow form opens with: the saved one-off's own fields, or the empty
 * draft a recurring inflow and a brand-new one both start from. A recurring inflow
 * stores none of these, so switching it to a one-off begins with nothing filled in
 * rather than with figures it never had.
 */
export function oneOffDraftFrom(inflow: {
  paid_on: string | null
  one_off_tax_treatment: OneOffTaxTreatment | null
  years_of_service: number | null
}): OneOffDraft {
  return {
    paidOn: inflow.paid_on,
    treatment: inflow.one_off_tax_treatment ?? DEFAULT_TREATMENT,
    yearsOfService: inflow.years_of_service ?? '',
  }
}

/** The draft a form with no inflow to edit opens with: nothing said yet. */
export const EMPTY_ONE_OFF_DRAFT: OneOffDraft = {
  paidOn: null,
  treatment: DEFAULT_TREATMENT,
  yearsOfService: '',
}

/** Whether a one-off draft carries the treatment's own extra figure, and needs one. */
function needsYearsOfService(draft: OneOffDraft, taxable: boolean): boolean {
  return taxable && draft.treatment === 'genuine_redundancy'
}

/**
 * Whether a one-off draft says enough to save: the date the money lands on, and —
 * for a genuine redundancy — the completed years of service its tax-free amount is
 * priced from, which the database requires of that treatment alone.
 */
export function isOneOffDraftComplete(draft: OneOffDraft, taxable: boolean): boolean {
  return (
    draft.paidOn !== null && (!needsYearsOfService(draft, taxable) || draft.yearsOfService !== '')
  )
}

/**
 * The recurrence columns a one-off writes. A non-taxable one-off — a gift — carries
 * no treatment and so no years of service either, the two being a taxable payment's
 * concern alone.
 */
export function oneOffRecurrenceInput(draft: OneOffDraft, taxable: boolean): RecurrenceInput {
  return {
    paid_on: draft.paidOn,
    one_off_tax_treatment: taxable ? draft.treatment : null,
    years_of_service: needsYearsOfService(draft, taxable) ? Number(draft.yearsOfService) : null,
  }
}

/** The recurrence columns a recurring inflow writes: none of them, it having a cadence. */
export const RECURRING_RECURRENCE_INPUT: RecurrenceInput = {
  paid_on: null,
  one_off_tax_treatment: null,
  years_of_service: null,
}

/**
 * How a taxable one-off of `amountCents` splits under its treatment, for showing back
 * before the payment is saved — or null where the draft cannot be split yet: a
 * non-taxable payment, which is not taxed at all, or one with no amount or no date to
 * price the member's age against.
 *
 * The split is measured against NO other income, which is the whole-of-income cap's
 * best case: the cap on a non-excluded termination payment falls as the member's other
 * taxable income rises, so the concessional part here is the most that can be
 * concessional. The FY estimate applies the member's real income.
 */
export function previewOneOffSplit(
  draft: OneOffDraft,
  taxable: boolean,
  amountCents: number | null,
  dateOfBirth: string | null,
  config: TaxYearConfig,
): OneOffPaymentSplit | null {
  if (!taxable || amountCents === null || draft.paidOn === null) {
    return null
  }
  return splitOneOffPayment(
    {
      treatment: ENGINE_ONE_OFF_TREATMENTS[draft.treatment],
      amountCents,
      ...(draft.yearsOfService !== '' && { yearsOfService: Number(draft.yearsOfService) }),
      atPreservationAge: atPreservationAgeOn(dateOfBirth, draft.paidOn, config),
    },
    0,
    config,
  )
}
