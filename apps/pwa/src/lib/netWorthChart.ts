import { netWorthColors } from './tokens'

/**
 * Token colours for the projection rows, from the net-worth colour map — the same
 * source the view-section glyphs draw from, so a band and its glyph cannot drift.
 * Assets take the cool teal / indigo / violet of the Super, Other-accounts, and
 * Equity groups; liabilities keep warm debt tones (the cost-red `negative` family
 * for HELP and orange for debt accounts) for their tooltip swatches even though
 * they are not plotted; the net-worth line takes the brand lime.
 */
export const NET_WORTH_SERIES_COLORS = {
  super: netWorthColors.superannuation,
  cash: netWorthColors.cash,
  equity: netWorthColors.equity,
  help: netWorthColors.liability,
  debt: netWorthColors.debtAccount,
  total: netWorthColors.total,
} as const

/** A single row of the projection data, carrying every component for the tooltip. */
export interface NetWorthProjectionRow {
  year: string
  super: number
  cash: number
  equity: number
  help: number
  debt: number
  total: number
}

/** One itemised tooltip line: a coloured swatch, a label, and a signed amount. */
export interface ProjectionTooltipItem {
  label: string
  color: string
  cents: number
}

/**
 * The itemised tooltip lines for a projection row: each present asset (positive)
 * followed by each present liability (a negative amount), omitting zero components.
 * The net-worth total is rendered separately.
 */
export function projectionTooltipItems(row: NetWorthProjectionRow): ProjectionTooltipItem[] {
  const items: ProjectionTooltipItem[] = []
  if (row.super > 0) {
    items.push({ label: 'Super', color: NET_WORTH_SERIES_COLORS.super, cents: row.super })
  }
  if (row.cash > 0) {
    items.push({ label: 'Cash & other', color: NET_WORTH_SERIES_COLORS.cash, cents: row.cash })
  }
  if (row.equity > 0) {
    items.push({ label: 'Equity', color: NET_WORTH_SERIES_COLORS.equity, cents: row.equity })
  }
  if (row.help > 0) {
    items.push({ label: 'HELP debt', color: NET_WORTH_SERIES_COLORS.help, cents: -row.help })
  }
  if (row.debt > 0) {
    items.push({ label: 'Debt accounts', color: NET_WORTH_SERIES_COLORS.debt, cents: -row.debt })
  }
  return items
}
