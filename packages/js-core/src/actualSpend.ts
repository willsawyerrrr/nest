import {
  actualSpendByGroup,
  payCycleAnchor,
  spendFortnight,
  type ActualSpendRow,
  type PayCycleInflow,
} from '@nest/plan'

/** The input of {@link spendFortnightOf}. */
export interface SpendFortnightInput {
  /** The household's inflows as stored, never planning mode's, so the pay cycle stays put. */
  inflows: PayCycleInflow[]
  /** The local date (`YYYY-MM-DD`) the current fortnight holds. */
  today: string
  /** Whole fortnights from the current one; negative is earlier. */
  offset: number
}

/** The pay-cycle fortnight the Budget screen reconciles: today's, moved `offset` fortnights. */
export function spendFortnightOf(input: SpendFortnightInput) {
  return spendFortnight(payCycleAnchor(input.inflows), input.today, input.offset)
}

/** The input of {@link actualSpendOf}: the `budget_actual_spend` RPC's rows. */
export interface ActualSpendInput {
  rows: ActualSpendRow[]
}

/** Each budget group's spend over the period, and the spend in no group. */
export function actualSpendOf(input: ActualSpendInput) {
  return actualSpendByGroup(input.rows)
}
