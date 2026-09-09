/**
 * Shapes a household's raw rows into the `@nest/tax` engine's inputs and runs
 * the whole-household estimate. The row shaping works against the loose
 * interfaces in `rows.ts`; the tax MATH — brackets, LITO, the Medicare levy,
 * HELP repayment, Division 293, the one-off concession — stays in `@nest/tax`'s
 * `estimateHouseholdTax`.
 */

import {
  estimateHouseholdTax,
  type HouseholdTaxEstimate,
  type IncomeInput,
  type Residency,
  type TaxProfileInput,
  type TaxYearConfig,
} from '@nest/tax'
import type {
  DeductionRow,
  HelpDebtRow,
  InflowRow,
  MemberRow,
  SuperContributionRow,
  TaxProfileRow,
} from '../rows.ts'
import { currentTaxConfig } from './config.ts'
import { inflowIncomeInputs } from './income.ts'
import { atPreservationAgeOn } from './oneOff.ts'
import {
  concessionalByMember,
  deductionsByMember,
  grossByMemberFromInflows,
  helpDebtCentsByMember,
} from './superBases.ts'

/**
 * Maps a `tax_profile` row to the tax engine's `TaxProfileInput`. The member's
 * HELP balance lives in a separate `help_debt` row, threaded in as
 * `helpDebtCents`.
 */
function toTaxProfileInput(profile: TaxProfileRow, helpDebtCents: number): TaxProfileInput {
  const residency: Residency =
    profile.residency === 'foreign_resident' ? 'foreignResident' : 'resident'
  return {
    memberId: profile.member_id,
    residency,
    privateHospitalCover: profile.has_private_hospital_cover,
    helpDebtCents,
  }
}

/**
 * Estimates the household's tax for a financial year from raw inflow,
 * tax-profile, and HELP-debt rows, using `config` (defaulting to the current
 * financial year, falling back to FY2027). Only taxable inflows feed the
 * estimate. Each member's HELP balance is threaded in from `helpDebts`; a
 * member with a HELP balance but no tax profile still contributes a resident,
 * cover-less profile so their repayment is assessed. Concessional super
 * contributions, when supplied, reduce each member's taxable income and
 * after-tax cash; deductions, when supplied, reduce each member's taxable
 * income only (so tax falls and after-tax cash rises). `paygWithheld`, when
 * supplied, gives each member's actual tax withheld for the year — summed from
 * their payslips, each slip's tax total including any STSL — which the engine nets
 * against their liability as
 * `breakdown.balanceCents` (positive owing, negative a refund). It changes no tax
 * figure: omitting it leaves every liability and after-tax total identical.
 * `members`, when supplied, gives each member's date of birth, which decides the
 * concessional rate on a one-off termination payment; a member whose date of birth
 * is absent or unset is read as below preservation age — the higher rate. Its ids
 * also name the household's two members, so a joint inflow's annualised amount is
 * split between the member it names and the other one — both in the income
 * build-up ({@link inflowIncomeInputs}) and in the per-member gross salary a
 * percent-of-salary contribution is set against ({@link grossByMemberFromInflows}).
 * `extraIncomes`, when supplied, are synthetic income inputs concatenated with
 * the mapped inflows — projected savings interest
 * ({@link projectedInterestIncomeInputs}), assessable as `other` income and
 * carrying no effective window, so the same figure reaches this whole-year
 * estimate and the budget's active-now rerun.
 */
export function estimateHouseholdTaxFromRows(
  inflows: readonly InflowRow[],
  profiles: readonly TaxProfileRow[],
  contributions: readonly SuperContributionRow[] = [],
  helpDebts: readonly HelpDebtRow[] = [],
  deductions: readonly DeductionRow[] = [],
  config: TaxYearConfig = currentTaxConfig(),
  paygWithheld?: ReadonlyMap<string, number>,
  members: readonly MemberRow[] = [],
  extraIncomes: readonly IncomeInput[] = [],
): HouseholdTaxEstimate {
  // Keyed to allow a null member id, which a taxable inflow can carry: it simply
  // matches no member, and an unknown date of birth reads as the higher rate.
  const dateOfBirthByMember = new Map<string | null, string | null>(
    members.map((member) => [member.id, member.date_of_birth]),
  )
  const memberIds = members.map((member) => member.id)
  const incomes = [
    ...inflows
      .filter((inflow) => inflow.taxable)
      .flatMap((inflow) =>
        inflowIncomeInputs(
          inflow,
          memberIds,
          inflow.paid_on != null &&
            atPreservationAgeOn(
              dateOfBirthByMember.get(inflow.member_id) ?? null,
              inflow.paid_on,
              config,
            ),
        ),
      ),
    ...extraIncomes,
  ]
  // Per-member annual gross salary, the base for percent-of-salary contributions.
  // A joint inflow's amount is split across the household's two members, matching
  // the income build-up above.
  const grossByMember = grossByMemberFromInflows(inflows, config, memberIds)
  const helpByMember = helpDebtCentsByMember(helpDebts)
  const profileInputByMember = new Map(
    profiles.map((profile) => [
      profile.member_id,
      toTaxProfileInput(profile, helpByMember.get(profile.member_id) ?? 0),
    ]),
  )
  // A member with a HELP balance but no tax profile still needs their repayment
  // assessed, so synthesise a default profile carrying that balance.
  for (const [memberId, helpDebtCents] of helpByMember) {
    if (helpDebtCents > 0 && !profileInputByMember.has(memberId)) {
      profileInputByMember.set(memberId, {
        memberId,
        residency: 'resident',
        privateHospitalCover: false,
        helpDebtCents,
      })
    }
  }
  return estimateHouseholdTax(
    incomes,
    [...profileInputByMember.values()],
    config,
    concessionalByMember(contributions, grossByMember),
    deductionsByMember(deductions),
    paygWithheld,
  )
}
