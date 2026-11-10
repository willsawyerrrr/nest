import { describe, expect, it } from 'vitest'
import { FY2027_CONFIG } from '@nest/tax'
import type { Tables } from './database.types'
import {
  payslipReconciliation,
  payslipTotalsFromRows,
  payslipVariancesById,
  payslipYearPositionsFromRows,
  reportedYearToDateFromRows,
  unmeasuredPositionsFor,
} from './payslips'
import { estimateHouseholdTaxFromRows } from './tax'

/**
 * The household the native Payslips screen is held to. The rows are written in
 * full, as PostgREST returns them, and the figures are what the PWA computes from
 * them: each slip's variance against the household tax estimate, and each member's
 * year to date, reported running totals and position on pay no period measures
 * (`PayslipsSection` and `PayslipsScreen`). The fixture is committed beside the iOS
 * tests (`vitest -u` rewrites it); `PayslipsParityTests` decodes the same rows, runs
 * the bundled engine over the screen's own input assembly and must return identical
 * figures.
 */
const FIXTURE = '../../../ios/NestTests/Fixtures/payslips-parity.json'
const FINANCIAL_YEAR = 2027
const STAMP = '2026-01-01T00:00:00Z'
const base = { household_id: 'h1', created_at: STAMP, updated_at: STAMP }

const member = (id: string, name: string): Tables<'members'> => ({
  ...base,
  id,
  name,
  date_of_birth: '1990-04-02',
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

const payslip = (overrides: Partial<Tables<'payslip'>>): Tables<'payslip'> => ({
  ...base,
  id: 'p',
  member_id: 'm1',
  financial_year: FINANCIAL_YEAR,
  period_start: '2026-07-06',
  period_end: '2026-07-19',
  paid_on: '2026-07-22',
  gross_cents: 0,
  tax_withheld_cents: 0,
  super_cents: 0,
  net_cents: 0,
  salary_sacrifice_cents: null,
  ytd_gross_cents: null,
  ytd_tax_withheld_cents: null,
  ytd_super_cents: null,
  file_path: null,
  note: null,
  ...overrides,
})

const line = (
  id: string,
  payslip_id: string,
  overrides: Partial<Tables<'payslip_line'>>,
): Tables<'payslip_line'> => ({
  ...base,
  id,
  payslip_id,
  kind: 'earning',
  label: 'Line',
  amount_cents: 0,
  source_inflow_id: null,
  tax_component: null,
  attracts_super: true,
  ...overrides,
})

const members = [member('m1', 'Ada'), member('m2', 'Ben')]
const inflows = [
  inflow({
    id: 'salary',
    name: 'Salary',
    amount_cents: 130_000_00,
    pay_schedule: 'fortnightly',
    arrives_every_pay_period: true,
  }),
  inflow({
    id: 'oncall',
    name: 'On-call allowance',
    type: 'other',
    schedule: 'fortnightly',
    amount_cents: 300_00,
    pay_schedule: 'fortnightly',
  }),
  inflow({
    id: 'bonus',
    name: 'Bonus',
    type: 'other',
    schedule: null,
    amount_cents: 5_000_00,
    paid_on: '2026-10-15',
    one_off_tax_treatment: 'ordinary',
  }),
  inflow({
    id: 'wage',
    name: 'Wage',
    member_id: 'm2',
    type: 'wage',
    schedule: 'fortnightly',
    hourly_rate_cents: 40_00,
    hours_per_period: 76,
    pay_schedule: 'fortnightly',
    arrives_every_pay_period: true,
  }),
]
const taxProfiles: Tables<'tax_profile'>[] = members.map(({ id }) => ({
  ...base,
  id: `tp-${id}`,
  member_id: id,
  financial_year: FINANCIAL_YEAR,
  residency: 'resident',
  has_private_hospital_cover: false,
}))
const helpDebts: Tables<'help_debt'>[] = [
  { ...base, id: 'hd1', member_id: 'm1', balance_cents: 20_000_00 },
]
const payslips = [
  payslip({
    id: 'p3',
    period_start: '2026-10-05',
    period_end: '2026-10-18',
    paid_on: '2026-10-21',
    gross_cents: 9_800_00,
    tax_withheld_cents: 2_700_00,
    super_cents: 1_127_00,
    net_cents: 7_100_00,
    ytd_gross_cents: 40_000_00,
    ytd_tax_withheld_cents: 10_000_00,
    ytd_super_cents: 4_600_00,
  }),
  payslip({
    id: 'p2',
    period_start: '2026-07-20',
    period_end: '2026-08-02',
    paid_on: null,
    gross_cents: 5_300_00,
    tax_withheld_cents: 1_300_00,
    super_cents: 600_00,
    salary_sacrifice_cents: 100_00,
    net_cents: 4_000_00,
  }),
  payslip({
    id: 'p1',
    gross_cents: 5_000_00,
    tax_withheld_cents: 1_250_00,
    super_cents: 575_00,
    net_cents: 3_750_00,
  }),
  payslip({
    id: 'p4',
    member_id: 'm2',
    gross_cents: 3_040_00,
    tax_withheld_cents: 600_00,
    super_cents: 350_00,
    net_cents: 2_440_00,
  }),
]
const lines = [
  line('l1', 'p3', { label: 'Salary', amount_cents: 5_000_00, source_inflow_id: 'salary' }),
  line('l2', 'p3', { label: 'On call', amount_cents: 300_00, source_inflow_id: 'oncall' }),
  line('l3', 'p3', { label: 'Bonus', amount_cents: 4_500_00, source_inflow_id: 'bonus' }),
  line('l4', 'p3', {
    kind: 'tax',
    label: 'PAYG',
    amount_cents: 2_500_00,
    attracts_super: null,
    tax_component: 'payg',
  }),
  line('l5', 'p3', {
    kind: 'tax',
    label: 'STSL',
    amount_cents: 200_00,
    attracts_super: null,
    tax_component: 'stsl',
  }),
  line('l6', 'p2', { label: 'Expenses', amount_cents: 200_00, attracts_super: false }),
  line('l7', 'p2', { label: 'Salary', amount_cents: 5_000_00, source_inflow_id: 'salary' }),
]

const config = FY2027_CONFIG
const estimate = estimateHouseholdTaxFromRows(
  inflows,
  taxProfiles,
  [],
  helpDebts,
  [],
  config,
  undefined,
  members,
)
const reconciliation = payslipReconciliation(inflows, lines)

const expected = {
  members: members.map(({ id }) => {
    const own = payslips.filter((row) => row.member_id === id)
    const variances = payslipVariancesById(
      own,
      reconciliation,
      estimate.members.find((each) => each.memberId === id),
      config,
    )
    return {
      memberId: id,
      variances: own.map((row) => ({ payslipId: row.id, variance: variances.get(row.id)! })),
      totals: payslipTotalsFromRows(own),
      reported: reportedYearToDateFromRows(own),
      positions: payslipYearPositionsFromRows(own, variances),
      unmeasured: unmeasuredPositionsFor(own, variances, reconciliation, FINANCIAL_YEAR),
    }
  }),
}

describe('the native Payslips parity fixture', () => {
  const text = `${JSON.stringify(
    [
      {
        name: 'two members, itemised and unitemised slips',
        financialYear: FINANCIAL_YEAR,
        rows: {
          members,
          inflows,
          taxProfiles,
          contributions: [],
          helpDebts,
          deductions: [],
          payslips,
          lines,
        },
        expected,
      },
    ],
    null,
    2,
  )}\n`

  it('matches what the PWA Payslips screen computes from the same rows', async () => {
    await expect(text).toMatchFileSnapshot(FIXTURE)
  })

  it('exercises itemised, part-measured and unmeasured pay', () => {
    const [ada] = expected.members
    expect(ada!.variances.some(({ variance }) => variance.lineGroups.length > 1)).toBe(true)
    expect(ada!.unmeasured.length).toBeGreaterThan(0)
    expect(ada!.reported).not.toBeNull()
  })
})
