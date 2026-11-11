import { describe, expect, it } from 'vitest'
import {
  configsByYear,
  familyMedicareLevySurcharge,
  householdYearSummary,
  salarySacrificeWhatIf,
} from '@nest/tax'
import type { Tables } from './database.types'
import { paygWithheldFromRows, payslipCountByMember } from './payslips'
import {
  availableFinancialYears,
  estimateHouseholdTaxFromRows,
  helpPayoffByMember,
  helpPayoffSummary,
  projectedInterestIncomeInputs,
  superCapSummaryFromRows,
} from './tax'

/**
 * The household the native Tax estimate and EOFY screens are held to. The rows
 * are written in full, as PostgREST returns them, and the figures are what the
 * PWA's `TaxSection` and `EofySection` compute from them with its own lib
 * functions: the estimate, each member's cap summary, HELP payoff, projected
 * interest and payslip count, the household year summary, the Medicare levy
 * surcharge what-if and a salary-sacrifice what-if. The fixture is committed
 * beside the iOS tests (`vitest -u` rewrites it); `TaxParityTests` decodes the
 * same rows, runs the bundled engine and must return identical figures.
 */
const FIXTURE = '../../../ios/NestTests/Fixtures/tax-parity.json'
const NOW = '2026-12-01T00:00:00Z'
const FINANCIAL_YEAR = 2027
const STAMP = '2026-01-01T00:00:00Z'
const base = { household_id: 'h1', created_at: STAMP, updated_at: STAMP }

const member = (id: string, name: string, date_of_birth: string): Tables<'members'> => ({
  ...base,
  id,
  name,
  date_of_birth,
  email: null,
  up_connected_at: null,
  up_sync_failed_at: null,
  user_id: `u-${id}`,
})

const inflow = (overrides: Partial<Tables<'inflows'>>): Tables<'inflows'> => ({
  ...base,
  id: 'i',
  name: 'Inflow',
  type: 'salary',
  member_id: 'm1',
  taxable: true,
  attracts_super: true,
  schedule: 'annual',
  amount_cents: null,
  interval_count: null,
  hourly_rate_cents: null,
  hours_per_period: null,
  starts_on: null,
  ends_on: null,
  paid_on: null,
  pay_anchor_date: null,
  pay_interval_count: null,
  pay_schedule: null,
  arrives_every_pay_period: false,
  one_off_tax_treatment: null,
  years_of_service: null,
  is_joint: false,
  member_split_percent: null,
  ...overrides,
})

const payslip = (id: string, member_id: string, paid_on: string): Tables<'payslip'> => ({
  ...base,
  id,
  member_id,
  paid_on,
  period_start: '2026-08-01',
  period_end: paid_on,
  financial_year: FINANCIAL_YEAR,
  gross_cents: 5_769_00,
  net_cents: 4_300_00,
  super_cents: 692_00,
  tax_withheld_cents: 1_400_00,
  salary_sacrifice_cents: null,
  ytd_gross_cents: null,
  ytd_super_cents: null,
  ytd_tax_withheld_cents: null,
  file_path: id === 'p1' ? 'h1/p1.pdf' : null,
  note: null,
})

const members = [member('m1', 'Ada', '1990-04-02'), member('m2', 'Ben', '1988-09-20')]

const rows = {
  members,
  inflows: [
    inflow({ id: 'i1', name: 'Ada salary', amount_cents: 150_000_00 }),
    inflow({
      id: 'i2',
      name: 'Ben wage',
      member_id: 'm2',
      type: 'wage',
      schedule: 'fortnightly',
      hourly_rate_cents: 55_00,
      hours_per_period: 76,
    }),
    inflow({
      id: 'i3',
      name: 'Joint interest',
      type: 'other',
      member_id: 'm1',
      is_joint: true,
      member_split_percent: 60,
      amount_cents: 2_000_00,
      attracts_super: false,
    }),
    inflow({
      id: 'i4',
      name: 'Bonus',
      type: 'other',
      schedule: null,
      amount_cents: 8_000_00,
      paid_on: '2026-10-15',
      attracts_super: false,
    }),
  ],
  taxProfiles: [
    {
      ...base,
      id: 't1',
      member_id: 'm1',
      financial_year: FINANCIAL_YEAR,
      residency: 'resident' as const,
      has_private_hospital_cover: true,
    },
    {
      ...base,
      id: 't2',
      member_id: 'm2',
      financial_year: FINANCIAL_YEAR,
      residency: 'resident' as const,
      has_private_hospital_cover: false,
    },
  ],
  contributions: [
    {
      ...base,
      id: 'c1',
      member_id: 'm1',
      contributor_member_id: null,
      financial_year: FINANCIAL_YEAR,
      kind: 'salary_sacrifice' as const,
      mode: 'amount' as const,
      amount_cents: 200_00,
      percent_bp: null,
      frequency: 'fortnightly' as const,
      interval_count: null,
      fhss_eligible: false,
    },
    {
      ...base,
      id: 'c2',
      member_id: 'm2',
      contributor_member_id: null,
      financial_year: FINANCIAL_YEAR,
      kind: 'personal_non_concessional' as const,
      mode: 'amount' as const,
      amount_cents: 1_000_00,
      percent_bp: null,
      frequency: 'annual' as const,
      interval_count: null,
      fhss_eligible: false,
    },
  ],
  superProfiles: [
    {
      ...base,
      id: 'sp1',
      member_id: 'm1',
      financial_year: FINANCIAL_YEAR,
      carry_forward_cap_cents: 10_000_00,
      balance_as_of: null,
      fund_name: null,
      linked_account_id: null,
      sg_rate_override: null,
    },
  ],
  helpDebts: [{ ...base, id: 'd1', member_id: 'm2', balance_cents: 18_000_00 }],
  deductions: [
    {
      ...base,
      id: 'x1',
      member_id: 'm1',
      financial_year: FINANCIAL_YEAR,
      deduction_date: '2026-08-01',
      description: 'Laptop',
      category: 'work_expense' as const,
      basis: 'amount' as const,
      amount_cents: 900_00,
      full_amount_cents: 1_500_00,
      work_use_percent: 60,
      distance_km: null,
      work_from_home_hours: null,
      group_id: 'dg1',
    },
  ],
  deductionGroups: [
    {
      ...base,
      id: 'dg1',
      member_id: 'm1',
      financial_year: FINANCIAL_YEAR,
      kind: 'custom',
      name: 'Home office',
    },
  ],
  deductionReceipts: [{ ...base, id: 'r1', deduction_id: 'x1', storage_path: 'h1/laptop.pdf' }],
  payslips: [
    payslip('p1', 'm1', '2026-08-14'),
    payslip('p2', 'm1', '2026-08-28'),
    payslip('p3', 'm2', '2026-08-28'),
  ],
  savingsGoals: [
    {
      ...base,
      id: 'g1',
      name: 'Holiday',
      target_amount_cents: 15_000_00,
      current_balance_cents: 3_000_00,
      annual_interest_bps: 480,
      linked_account_id: 'a1',
      planned_contribution_cents: null,
      queue_position: null,
      target_date: '2027-12-31',
    },
  ],
  savers: [
    {
      ...base,
      id: 'a1',
      name: 'Saver',
      currency: 'AUD',
      deleted_from_source_at: null,
      exclude_from_net_worth: false,
      external_id: 'up-1',
      owner_member_id: 'm1',
      source: 'up' as const,
      type: 'savings' as const,
      balance_cents: 12_000_00,
    },
  ],
  trades: [
    {
      ...base,
      id: 'tr1',
      member_id: 'm1',
      ticker: 'VAS',
      side: 'buy' as const,
      traded_on: '2025-01-10',
      units: 100,
      price_per_unit_microdollars: 90_000_000,
      fee_cents: 995,
      source: 'manual' as const,
      external_id: null,
      document_id: null,
    },
    {
      ...base,
      id: 'tr2',
      member_id: 'm1',
      ticker: 'VAS',
      side: 'sell' as const,
      traded_on: '2026-09-10',
      units: 100,
      price_per_unit_microdollars: 105_000_000,
      fee_cents: 995,
      source: 'manual' as const,
      external_id: null,
      document_id: null,
    },
  ],
  equityGrants: [
    {
      ...base,
      id: 'eg1',
      member_id: 'm2',
      label: 'Employer shares',
      instrument_type: 'share' as const,
      quantity: 50,
      grant_date: '2024-07-01',
      cliff_months: 0,
      price_as_of: null,
      price_per_share_cents: 20_00,
      strike_price_cents: null,
      vesting_frequency: 'annual' as const,
      vesting_period_months: 12,
    },
  ],
  equityExercises: [] as Tables<'equity_exercise'>[],
  equitySales: [
    {
      ...base,
      id: 'es1',
      member_id: 'm2',
      grant_id: 'eg1',
      sold_on: '2026-10-01',
      quantity: 50,
      price_per_share_cents: 30_00,
      fee_cents: 995,
    },
  ],
}

/** The real inflows a planning sandbox edited: Ada's salary is lower in the real rows. */
const baselineInflows = rows.inflows.map((row) =>
  row.id === 'i1' ? { ...row, amount_cents: 140_000_00 } : row,
)

const config = configsByYear[FINANCIAL_YEAR]!
const equity = {
  grants: rows.equityGrants,
  exercises: rows.equityExercises,
  sales: rows.equitySales,
}
const estimateFrom = (inflows: typeof rows.inflows) => {
  const interest = projectedInterestIncomeInputs(rows.savingsGoals, rows.savers, members)
  return {
    interest,
    estimate: estimateHouseholdTaxFromRows(
      inflows,
      rows.taxProfiles,
      rows.contributions,
      rows.helpDebts,
      rows.deductions,
      config,
      paygWithheldFromRows(rows.payslips),
      members,
      interest,
      rows.trades,
      equity,
    ),
  }
}

type Estimate = ReturnType<typeof estimateFrom>['estimate']
const household = (estimate: Estimate) => ({
  annualGrossCents: estimate.annualGrossCents,
  annualTaxCents: estimate.annualTaxCents,
  annualAfterTaxCents: estimate.annualAfterTaxCents,
  annualOneOffGrossCents: estimate.annualOneOffGrossCents,
  fortnightlyGrossCents: estimate.fortnightlyGrossCents,
  fortnightlyTaxCents: estimate.fortnightlyTaxCents,
  fortnightlyAfterTaxCents: estimate.fortnightlyAfterTaxCents,
  members: estimate.members.map((m) => ({
    memberId: m.memberId,
    annualGrossCents: m.annualGrossCents,
    annualConcessionalContributionsCents: m.annualConcessionalContributionsCents,
    annualDeductionsCents: m.annualDeductionsCents,
    annualTaxCents: m.annualTaxCents,
    annualAfterTaxCents: m.annualAfterTaxCents,
    annualOneOffGrossCents: m.annualOneOffGrossCents,
    annualNetCapitalGainCents: m.annualNetCapitalGainCents,
    fortnightlyGrossCents: m.fortnightlyGrossCents,
    fortnightlyTaxCents: m.fortnightlyTaxCents,
    fortnightlyAfterTaxCents: m.fortnightlyAfterTaxCents,
    employmentTerminationCents: m.input.assessableIncome.employmentTerminationCents,
    breakdown: { ...m.breakdown },
  })),
})

const { estimate, interest } = estimateFrom(rows.inflows)
const caps = superCapSummaryFromRows(
  rows.inflows,
  rows.superProfiles,
  rows.contributions,
  config,
  members,
)
const payoff = helpPayoffByMember(estimate, rows.helpDebts, config, new Date(NOW))
const counts = payslipCountByMember(rows.payslips)
const interestByMember = (memberId: string) =>
  interest.filter((i) => i.memberId === memberId).reduce((t, i) => t + (i.amountCents ?? 0), 0)

const adaInput = estimate.members.find((m) => m.memberId === 'm1')!.input
const expected = JSON.parse(
  JSON.stringify({
    taxScreen: {
      financialYear: FINANCIAL_YEAR,
      availableFinancialYears: [...availableFinancialYears],
      deductionRates: {
        centsPerKm: config.carExpense.centsPerKm,
        centsPerHour: config.workFromHome.centsPerHour,
      },
      estimate: household(estimate),
      baseline: household(estimateFrom(baselineInflows).estimate),
      memberExtras: estimate.members.map((m) => ({
        memberId: m.memberId,
        capSummary: caps.get(m.memberId) ?? null,
        helpPayoff: payoff.has(m.memberId)
          ? {
              paidOffFinancialYear: payoff.get(m.memberId)!.paidOffFinancialYear,
              yearsToPayOff: payoff.get(m.memberId)!.yearsToPayOff,
              summary: helpPayoffSummary(payoff.get(m.memberId)!),
            }
          : null,
        projectedInterestCents: interestByMember(m.memberId),
        payslipCount: counts.get(m.memberId) ?? 0,
      })),
    },
    householdYear: [0, 2].map((children) => householdYearSummary(estimate, children, config)),
    mlsWhatIf: [0, 2].map((children) =>
      familyMedicareLevySurcharge(
        estimate.members.map((m) => ({
          incomeForSurchargeCents: m.breakdown.incomeForSurchargeCents,
          hasPrivateHospitalCover: false,
        })),
        children,
        config,
      ),
    ),
    salarySacrifice: salarySacrificeWhatIf(adaInput, 5_000_00, config),
  }),
) as unknown

describe('the native Tax and EOFY parity fixture', () => {
  const text = `${JSON.stringify(
    [
      {
        name: 'a two-member household',
        now: NOW,
        financialYear: FINANCIAL_YEAR,
        rows,
        baselineInflows,
        expected,
      },
    ],
    null,
    2,
  )}\n`

  it('matches what the PWA Tax and EOFY screens compute from the same rows', async () => {
    await expect(text).toMatchFileSnapshot(FIXTURE)
  })

  it('exercises withholding, HELP, a capital gain, interest, a cap summary and an MLS tier', () => {
    const screen = (expected as { taxScreen: ReturnType<typeof Object> }).taxScreen as {
      estimate: {
        members: { annualNetCapitalGainCents: number; breakdown: { paygWithheldCents: number } }[]
      }
      memberExtras: { helpPayoff: unknown; capSummary: unknown; projectedInterestCents: number }[]
    }
    expect(screen.estimate.members.some((m) => m.annualNetCapitalGainCents > 0)).toBe(true)
    expect(screen.estimate.members.some((m) => m.breakdown.paygWithheldCents > 0)).toBe(true)
    expect(screen.memberExtras.some((m) => m.helpPayoff !== null)).toBe(true)
    expect(screen.memberExtras.some((m) => m.capSummary !== null)).toBe(true)
    expect(screen.memberExtras.some((m) => m.projectedInterestCents > 0)).toBe(true)
  })
})
