import type { AccountDirectoryEntry } from '../hooks/useAccountDirectory'
import type { BudgetLine } from '../hooks/useBudgetLines'
import type { GiftDiscretionaryBudget, GiftPurchase } from '../hooks/useGifts'
import type { Goal } from '../hooks/useGoals'
import type { Inflow } from '../hooks/useInflows'
import type { Member } from '../hooks/useMembers'
import type { PayslipLineRow } from '../hooks/usePayslipLines'
import type { PayslipRow } from '../hooks/usePayslips'
import type { Saver } from '../hooks/useSavers'
import type { TaxProfile } from '../hooks/useTaxProfiles'
import type { TemporaryItem } from '../hooks/useTemporaryItems'
import type { WishlistItem } from '../hooks/useWishlist'
import {
  GIFT_TRANSACTION_CATEGORY,
  type GiftTransaction,
  type GiftTransactionDismissal,
} from '../lib/giftCandidates'

/** Builds a household member row, overriding any field a test cares about. */
export function makeMember(overrides: Partial<Member> = {}): Member {
  return {
    id: 'm1',
    household_id: 'h1',
    name: 'Will',
    email: null,
    date_of_birth: null,
    user_id: 'u1',
    up_connected_at: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

/** Builds an inflow row, defaulting to a fortnightly taxable salary. */
export function makeInflow(overrides: Partial<Inflow> = {}): Inflow {
  return {
    id: 'i1',
    household_id: 'h1',
    member_id: 'm1',
    name: 'Day job',
    taxable: true,
    attracts_super: true,
    type: 'salary',
    schedule: 'fortnightly',
    interval_count: null,
    pay_schedule: null,
    pay_interval_count: null,
    arrives_every_pay_period: true,
    amount_cents: 500000,
    hourly_rate_cents: null,
    hours_per_period: null,
    starts_on: null,
    ends_on: null,
    paid_on: null,
    one_off_tax_treatment: null,
    years_of_service: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

/**
 * Builds a ONE-OFF inflow row: a taxable severance paid on a single date, with no
 * cadence and none of the machinery a cadence needs, exactly as the database's
 * one-off shape check requires.
 */
export function makeOneOffInflow(overrides: Partial<Inflow> = {}): Inflow {
  return makeInflow({
    id: 'i-oneoff',
    name: 'Severance',
    schedule: null,
    paid_on: '2026-09-12',
    one_off_tax_treatment: 'ordinary',
    amount_cents: 40_000_00,
    ...overrides,
  })
}

/** Builds a payslip row for one fortnight of the default inflow's pay. */
export function makePayslip(overrides: Partial<PayslipRow> = {}): PayslipRow {
  return {
    id: 'ps1',
    household_id: 'h1',
    member_id: 'm1',
    financial_year: 2027,
    period_start: '2026-07-01',
    period_end: '2026-07-14',
    paid_on: '2026-07-15',
    gross_cents: 5_000_00,
    tax_withheld_cents: 1_000_00,
    super_cents: 600_00,
    net_cents: 4_000_00,
    salary_sacrifice_cents: null,
    ytd_gross_cents: null,
    ytd_tax_withheld_cents: null,
    ytd_super_cents: null,
    file_path: null,
    note: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

/** Builds a payslip earnings line, defaulting to the default slip's salary line. */
export function makePayslipLine(overrides: Partial<PayslipLineRow> = {}): PayslipLineRow {
  return {
    id: 'pl1',
    household_id: 'h1',
    payslip_id: 'ps1',
    kind: 'earning',
    source_inflow_id: 'i1',
    tax_component: null,
    label: 'Ordinary Hours',
    amount_cents: 5_000_00,
    attracts_super: true,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

/**
 * Builds a payslip tax line, defaulting to the PAYG component. A tax line names
 * no inflow and carries no super decision, exactly as the stored line's pairing
 * check constraint requires.
 */
export function makePayslipTaxLine(overrides: Partial<PayslipLineRow> = {}): PayslipLineRow {
  return makePayslipLine({
    id: 'pt1',
    kind: 'tax',
    source_inflow_id: null,
    tax_component: 'payg',
    label: 'PAYG',
    amount_cents: 1_000_00,
    attracts_super: null,
    ...overrides,
  })
}

/** Builds a `tax_profile` row: a resident with no private hospital cover. */
export function makeTaxProfile(overrides: Partial<TaxProfile> = {}): TaxProfile {
  return {
    id: 'tp1',
    household_id: 'h1',
    member_id: 'm1',
    financial_year: 2027,
    residency: 'resident',
    has_private_hospital_cover: false,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

/** Builds a savings-goal row with a manual balance and no linked saver. */
export function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'g1',
    household_id: 'h1',
    name: 'Goal',
    target_amount_cents: 1_000_000,
    target_date: null,
    current_balance_cents: 0,
    linked_account_id: null,
    annual_interest_bps: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

/** Builds an accounts row for a synced Up saver. */
export function makeSaver(overrides: Partial<Saver> = {}): Saver {
  return {
    id: 'a1',
    household_id: 'h1',
    owner_member_id: null,
    name: 'Up Saver',
    type: 'savings',
    source: 'up',
    external_id: 'up-a1',
    balance_cents: 0,
    currency: 'AUD',
    exclude_from_net_worth: false,
    deleted_from_source_at: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

/** Builds an `account_directory` identity row (no balance). */
export function makeAccountDirectoryEntry(
  overrides: Partial<AccountDirectoryEntry> = {},
): AccountDirectoryEntry {
  return {
    id: 'a1',
    owner_member_id: null,
    name: 'Up Saver',
    type: 'savings',
    source: 'up',
    deleted_from_source_at: null,
    ...overrides,
  }
}

/** Builds a budget-line row, defaulting to a fortnightly savings line. */
export function makeBudgetLine(overrides: Partial<BudgetLine> = {}): BudgetLine {
  return {
    id: Math.random().toString(),
    household_id: 'h1',
    line_group: 'savings',
    name: 'Line',
    amount_cents: 50_000,
    frequency: 'fortnightly',
    interval_count: null,
    goal_id: null,
    destination_account_id: null,
    breakdown_id: null,
    gift_recipient_member_id: null,
    is_gift_line: false,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

/** Builds a gift-purchase row, defaulting to a hand-entered, budget-linked (unlinked to Up) purchase. */
export function makeGiftPurchase(overrides: Partial<GiftPurchase> = {}): GiftPurchase {
  return {
    id: 'p1',
    household_id: 'h1',
    gift_budget_id: 'b1',
    gift_discretionary_budget_id: null,
    recipient_id: null,
    amount_cents: 30_00,
    description: 'Book',
    purchased_on: '2026-11-01',
    transaction_id: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

/** Builds the household's discretionary gift buffer row. */
export function makeGiftDiscretionaryBudget(
  overrides: Partial<GiftDiscretionaryBudget> = {},
): GiftDiscretionaryBudget {
  return {
    id: 'gdb1',
    household_id: 'h1',
    budgeted_amount_cents: 100_00,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

/** Builds a synced Up gift-category transaction: settled, and signed negative as a debit. */
export function makeGiftTransaction(overrides: Partial<GiftTransaction> = {}): GiftTransaction {
  return {
    id: 't1',
    household_id: 'h1',
    account_id: 'a1',
    member_id: 'm1',
    category_id: null,
    posted_at: '2026-11-20T02:30:00+00:00',
    amount_cents: -45_00,
    description: 'Bookshop',
    notes: null,
    kind: 'expense',
    status: 'settled',
    source: 'up',
    external_id: 'up-t1',
    external_category: GIFT_TRANSACTION_CATEGORY,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

/** Builds a "not a gift" dismissal for a synced gift transaction. */
export function makeGiftTransactionDismissal(
  overrides: Partial<GiftTransactionDismissal> = {},
): GiftTransactionDismissal {
  return {
    id: 'd1',
    household_id: 'h1',
    transaction_id: 't1',
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

/** Builds a temporary-item row with a dated contribution. */
export function makeTemporaryItem(overrides: Partial<TemporaryItem> = {}): TemporaryItem {
  return {
    id: 't1',
    household_id: 'h1',
    name: 'Holiday',
    contribution_cents: 12000,
    target_date: '2027-08-03',
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

/** Builds a wishlist item, defaulting to an untagged aspirational purchase. */
export function makeWishlistItem(overrides: Partial<WishlistItem> = {}): WishlistItem {
  return {
    id: 'w1',
    household_id: 'h1',
    name: 'Espresso machine',
    amount_cents: 1_200_00,
    member_id: null,
    note: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}
