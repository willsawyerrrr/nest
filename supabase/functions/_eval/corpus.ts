/**
 * The synthetic labelled corpus the extraction eval runs over: payslips,
 * deduction receipts and trade documents, plus documents that are none of those.
 *
 * Every figure, name and date is generated from a fixed seed, so the corpus is
 * reproducible and holds no real person's data. Each document is a table of
 * printed rows that the Swift renderer lays out as a PDF and a PNG; the label is
 * the raw text an ideal extractor reports, in the shape the edge functions'
 * `readRawFields` produce, so both engines are scored through the same shaping.
 *
 * `deno run --allow-write corpus.ts <dir>` writes `<dir>/corpus.json`.
 */

import type { RawDeductionFields } from '../deduction-extract/fields.ts'
import type { RawPayslipFields, RawPayslipTaxLine } from '../payslip-extract/fields.ts'
import type { RawTrade, RawTradeDocument } from '../trade-extract/fields.ts'

export type DocKind = 'payslip' | 'deduction' | 'trade' | 'other'

/** One printed row: a label and the right-hand cells, left to right. */
export type Row = string[]

interface BaseDoc {
  id: string
  /** The financial year the extractor is told the document is being added to. */
  financialYear: number
  rows: Row[]
}

export type CorpusDoc =
  | BaseDoc & { kind: 'payslip'; label: RawPayslipFields }
  | BaseDoc & { kind: 'deduction'; label: RawDeductionFields }
  | BaseDoc & { kind: 'trade'; label: RawTradeDocument }
  | BaseDoc & { kind: 'other' }

/** A small seeded generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const money = (cents: number): string =>
  `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2 })}`

const pad = (n: number): string => String(n).padStart(2, '0')
const iso = (d: Date): string => d.toISOString().slice(0, 10)
const au = (d: Date): string =>
  `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
const addDays = (d: Date, days: number): Date => new Date(d.getTime() + days * 86_400_000)

const EMPLOYERS = ['Harbour Logistics Pty Ltd', 'Example Health Services', 'Northgate Retail Group']
/** A payslip label with nothing read. */
export const NO_FIELDS = {
  not_payslip_reason: null,
  period_start: null,
  period_end: null,
  paid_on: null,
  gross: null,
  tax_withheld: null,
  super: null,
  net: null,
  salary_sacrifice: null,
  ytd_gross: null,
  ytd_tax_withheld: null,
  ytd_super: null,
  earnings_lines: [],
  tax_lines: [],
} satisfies Omit<RawPayslipFields, 'is_payslip'>

interface PayslipOptions {
  /** First pay of the financial year: year-to-date equals this period. */
  firstPay?: boolean
  /** Adds an STSL component beside PAYG withholding. */
  stsl?: boolean
  /** Prints no super and no year-to-date columns. */
  bare?: boolean
  /** Adds a row printed in the year-to-date column alone. */
  ytdOnlyRow?: boolean
  /** Salary-sacrificed super. */
  sacrifice?: boolean
}

function payslip(index: number, options: PayslipOptions = {}): CorpusDoc {
  const next = rng(1000 + index)
  const start = new Date(Date.UTC(2025, 8, 1 + 14 * index))
  const end = addDays(start, 13)
  const paid = addDays(end, 3)
  const hours = 76
  const rate = 3200 + Math.floor(next() * 2200)
  const base = hours * rate
  const overtime = options.bare ? 0 : Math.round(next() * 6) * 100 * 120
  const gross = base + overtime
  const payg = Math.round(gross * 0.21)
  const stsl = options.stsl ? Math.round(gross * 0.04) : 0
  const tax = payg + stsl
  const sacrifice = options.sacrifice ? Math.round(gross * 0.05) : 0
  const net = gross - tax - sacrifice
  const superCents = Math.round((gross - sacrifice) * 0.12)
  const periods = options.firstPay ? 1 : 3 + index
  const ytd = (cents: number): number => cents * periods
  const columns = options.bare ? 1 : 2

  const cells = (cents: number, ytdCents?: number): Row =>
    columns === 1 ? [money(cents)] : [money(cents), ytdCents === undefined ? '' : money(ytdCents)]
  const label = (period: number | null, ytdCents: number | null) => ({
    period_amount: period === null ? null : money(period),
    ytd_amount: options.bare || ytdCents === null ? null : money(ytdCents),
  })

  const earnings = [{ label: 'Ordinary Hours', ...label(base, ytd(base)) }]
  if (overtime > 0) earnings.push({ label: 'Overtime 1.5x', ...label(overtime, ytd(overtime)) })
  if (options.ytdOnlyRow) {
    earnings.push({ label: 'Annual Leave Loading', ...label(null, 184_500) })
  }
  const taxLines: RawPayslipTaxLine[] = [{
    label: 'PAYG Withholding',
    ...label(payg, ytd(payg)),
    component: 'payg',
  }]
  if (stsl > 0) {
    taxLines.push({
      label: 'STSL Component',
      ...label(stsl, ytd(stsl)),
      component: 'stsl',
    })
  }

  const header: Row = columns === 1 ? ['This pay'] : ['This pay', 'Year to date']
  const rows: Row[] = [
    [EMPLOYERS[index % EMPLOYERS.length]],
    ['PAYSLIP'],
    ['Employee', `Sample Employee ${index + 1}`],
    ['Pay period', `${au(start)} to ${au(end)}`],
    ['Payment date', au(paid)],
    [],
    ['EARNINGS', ...header],
    ...earnings.map((line) => [
      line.label,
      ...(line.period_amount === null
        ? ['', line.ytd_amount ?? '']
        : [line.period_amount, ...(columns === 2 ? [line.ytd_amount ?? ''] : [])]),
    ]),
    ['TOTAL GROSS', ...cells(gross, ytd(gross))],
    [],
    ['TAX', ...header],
    ...taxLines.map((line) => [
      line.label,
      line.period_amount!,
      ...(columns === 2 ? [line.ytd_amount ?? ''] : []),
    ]),
    ['TOTAL TAX', ...cells(tax, ytd(tax))],
  ]
  if (sacrifice > 0) rows.push([], ['Salary sacrifice super', ...cells(sacrifice)])
  rows.push([], ['NET PAY', money(net)])
  if (!options.bare) {
    rows.push([], ['Employer super (SG 12%)', ...cells(superCents, ytd(superCents))])
  }

  return {
    id: `payslip-${index + 1}`,
    kind: 'payslip',
    financialYear: 2026,
    rows,
    label: {
      is_payslip: true,
      ...NO_FIELDS,
      period_start: iso(start),
      period_end: iso(end),
      paid_on: iso(paid),
      gross: money(gross),
      tax_withheld: money(tax),
      super: options.bare ? null : money(superCents),
      net: money(net),
      salary_sacrifice: sacrifice > 0 ? money(sacrifice) : null,
      ytd_gross: options.bare ? null : money(ytd(gross)),
      ytd_tax_withheld: options.bare ? null : money(ytd(tax)),
      ytd_super: options.bare ? null : money(ytd(superCents)),
      earnings_lines: earnings,
      tax_lines: taxLines,
    },
  }
}

const NO_RECEIPT = {
  not_receipt_reason: null,
  description: null,
  deduction_date: null,
  amount: null,
} satisfies Omit<RawDeductionFields, 'is_receipt'>

interface ReceiptOptions {
  merchant: string | null
  /** What the receipt is for when it prints no merchant. */
  item?: string
  /** Prints a due date beside the invoice date. */
  dueDate?: boolean
  /** Prints cash tendered and change beneath the total. */
  tendered?: boolean
  lines: [string, number][]
}

function receipt(index: number, options: ReceiptOptions): CorpusDoc {
  const next = rng(2000 + index)
  const date = new Date(Date.UTC(2026, 0, 5 + Math.floor(next() * 120)))
  const total = options.lines.reduce((sum, [, cents]) => sum + cents, 0)
  const gst = Math.round(total / 11)
  const rows: Row[] = [
    options.merchant ? [options.merchant.toUpperCase()] : ['TAX INVOICE'],
    ['ABN 11 000 000 000'],
    [options.dueDate ? 'Invoice date' : 'Date', au(date)],
  ]
  if (options.dueDate) rows.push(['Due date', au(addDays(date, 14))])
  rows.push([], ...options.lines.map(([name, cents]): Row => [name, money(cents)]), [])
  rows.push(['GST included', money(gst)], ['TOTAL', money(total)])
  if (options.tendered) {
    const tendered = Math.ceil(total / 5000) * 5000
    rows.push(['Cash tendered', money(tendered)], ['Change', money(tendered - total)])
  }
  return {
    id: `receipt-${index + 1}`,
    kind: 'deduction',
    financialYear: 2026,
    rows,
    label: {
      is_receipt: true,
      ...NO_RECEIPT,
      description: options.merchant ?? options.item ?? null,
      deduction_date: iso(date),
      amount: money(total),
    },
  }
}

interface TradeInput {
  ticker: string
  side: 'Buy' | 'Sell'
  units: number
  /** Price in microdollars. */
  price: number
  fee: number
}

function priceText(microdollars: number, places: number): string {
  return `$${(microdollars / 1e6).toFixed(places)}`
}

function trades(index: number, inputs: TradeInput[], places = 4, compact = false): CorpusDoc {
  const next = rng(3000 + index)
  const date = new Date(Date.UTC(2026, 1, 2 + Math.floor(next() * 60)))
  const rows: Row[] = [
    ['Example Securities Pty Ltd'],
    ['CONTRACT NOTE'],
    ['Trade date', au(date)],
    [],
    ['Security', 'Buy/Sell', 'Units', 'Price', 'Brokerage'],
    ...inputs.map((t): Row => [
      t.ticker,
      t.side,
      t.units.toLocaleString('en-AU'),
      priceText(t.price, places),
      money(t.fee),
    ]),
  ]
  const label: RawTrade[] = inputs.map((t) => ({
    ticker: t.ticker,
    side: t.side.toLowerCase(),
    trade_date: iso(date),
    units: t.units.toLocaleString('en-AU'),
    price_per_unit: priceText(t.price, places),
    brokerage_fee: money(t.fee),
  }))
  return {
    id: compact ? `trades-statement-${inputs.length}` : `trades-${index + 1}`,
    kind: 'trade',
    financialYear: 2026,
    rows,
    label: { is_trade_document: true, trades: label },
  }
}

function statementTrades(count: number): TradeInput[] {
  const next = rng(4000)
  const tickers = ['VAS', 'VGS', 'NDQ', 'A200', 'IVV', 'VAF']
  return Array.from({ length: count }, (_, i) => ({
    ticker: tickers[i % tickers.length],
    side: next() < 0.7 ? 'Buy' : 'Sell',
    units: 10 + Math.floor(next() * 400),
    price: Math.round((20 + next() * 150) * 1e4) * 100,
    fee: 995 + Math.floor(next() * 3) * 500,
  }))
}

const OTHER_DOCS: CorpusDoc[] = [
  {
    id: 'other-letter',
    kind: 'other',
    financialYear: 2026,
    rows: [
      ['Riverside Community Library'],
      ['Membership renewal'],
      [],
      ['Dear member,'],
      ['Your library membership expires on 30/06/2026.'],
      ['Renew online at no charge.'],
    ],
  },
  {
    id: 'other-bank',
    kind: 'other',
    financialYear: 2026,
    rows: [
      ['Example Bank'],
      ['Account summary'],
      ['Opening balance', '$2,310.55'],
      ['Closing balance', '$2,845.10'],
      ['Interest earned', '$1.12'],
    ],
  },
]

/** The whole corpus, in a stable order. */
export function buildCorpus(): CorpusDoc[] {
  return [
    payslip(0),
    payslip(1, { stsl: true }),
    payslip(2, { firstPay: true }),
    payslip(3, { ytdOnlyRow: true, sacrifice: true }),
    payslip(4, { bare: true }),
    payslip(5, { stsl: true, ytdOnlyRow: true }),
    receipt(0, {
      merchant: 'Bright Office Supplies',
      lines: [['Ergonomic mouse', 5995], ['USB-C hub', 8900]],
    }),
    receipt(1, {
      merchant: 'Metro Tech Repairs',
      dueDate: true,
      lines: [['Laptop screen repair', 24_900]],
    }),
    receipt(2, {
      merchant: 'Corner Stationers',
      tendered: true,
      lines: [['Notebooks x3', 1485], ['Pens', 695]],
    }),
    receipt(3, { merchant: null, item: 'Standing desk', lines: [['Standing desk', 54_900]] }),
    receipt(4, {
      merchant: 'Harbour Safety Gear',
      lines: [['Steel cap boots', 18_950], ['Hi-vis vest', 2495], ['Gloves', 1295]],
    }),
    trades(0, [{ ticker: 'VAS', side: 'Buy', units: 120, price: 98_450_000, fee: 1995 }]),
    trades(1, [
      { ticker: 'VGS', side: 'Buy', units: 1250, price: 131_250_000, fee: 1995 },
      { ticker: 'NDQ', side: 'Sell', units: 80, price: 55_103_400, fee: 995 },
      { ticker: 'A200', side: 'Buy', units: 400, price: 142_610_000, fee: 1995 },
    ]),
    trades(2, [{ ticker: 'IVV', side: 'Sell', units: 35, price: 61_220_000, fee: 1500 }]),
    trades(3, statementTrades(40), 4, true),
    ...OTHER_DOCS,
  ]
}

if (import.meta.main) {
  const dir = Deno.args[0]
  if (!dir) throw new Error('usage: corpus.ts <output dir>')
  await Deno.mkdir(dir, { recursive: true })
  await Deno.writeTextFile(`${dir}/corpus.json`, JSON.stringify(buildCorpus(), null, 2))
}
