import {
  corroborateNetPay,
  financialYearPeriod,
  modelledNetCents,
  PERIOD_END_DAYS_AFTER,
  type NetPayCorroboration,
  type PayslipVariance,
  type SalaryCreditCandidate,
} from '@nest/plan'
import type { PayslipRow } from '../hooks/usePayslips'
import type { Tables } from './database.types'
import { isoDate } from './dates'

/** The `transactions` columns a salary credit is read from. */
export const SALARY_CREDIT_COLUMNS =
  'id,posted_at,amount_cents,member_id,description,transaction_type'

export type SalaryCreditRow = Pick<
  Tables<'transactions'>,
  'id' | 'posted_at' | 'amount_cents' | 'member_id' | 'description' | 'transaction_type'
>

/**
 * The instants a financial year's salary credits are loaded between: a day before
 * the year opens, so a slip paid on 1 July finds a credit processed early, through
 * the longest match window past its close, so a slip paid on 30 June finds one that
 * landed after a weekend.
 */
export function salaryCreditBounds(financialYear: number): { from: string; to: string } {
  const { periodStart, periodEnd } = financialYearPeriod(financialYear)
  const from = new Date(`${periodStart}T00:00:00`)
  from.setDate(from.getDate() - 1)
  const to = new Date(`${periodEnd}T00:00:00`)
  to.setDate(to.getDate() + PERIOD_END_DAYS_AFTER + 1)
  return { from: from.toISOString(), to: to.toISOString() }
}

/** Maps a `transactions` row to the candidate the corroboration reads, on its local date. */
export function toSalaryCreditCandidate(row: SalaryCreditRow): SalaryCreditCandidate {
  return {
    id: row.id,
    postedOn: isoDate(new Date(row.posted_at)),
    amountCents: row.amount_cents,
    memberId: row.member_id,
    payer: row.description,
    transactionType: row.transaction_type,
  }
}

/**
 * Corroborates the year's payslips against the household's income credits, each
 * slip carrying the plan's net for its period from the variance its card renders.
 */
export function netPayCorroboration(
  financialYear: number,
  memberIds: readonly string[],
  payslips: readonly PayslipRow[],
  variances: ReadonlyMap<string, PayslipVariance>,
  credits: readonly SalaryCreditRow[],
): NetPayCorroboration {
  return corroborateNetPay(
    financialYear,
    memberIds,
    payslips.map((payslip) => {
      const variance = variances.get(payslip.id)
      return {
        id: payslip.id,
        memberId: payslip.member_id,
        paidOn: payslip.paid_on,
        periodStart: payslip.period_start,
        periodEnd: payslip.period_end,
        netCents: payslip.net_cents,
        modelledNetCents: variance ? modelledNetCents(variance) : null,
      }
    }),
    credits.map(toSalaryCreditCandidate),
  )
}
