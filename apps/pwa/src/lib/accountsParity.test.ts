import { describe, expect, it } from 'vitest'
import { splitLeadingEmoji } from './accountName'
import { accountOwnerLabel, groupAccountsByType, ledgerSourceLabel } from './accounts'
import type { Tables } from './database.types'
import type { Account } from './domain'
import { formatCents } from './money'

/**
 * The accounts the native Accounts screen is held to. The rows are written in full,
 * as PostgREST returns them (each table ordered by name); the figures are what
 * `AccountsScreen` shows: each type group (`groupAccountsByType`) with its total,
 * and each account's emoji and label (`splitLeadingEmoji`), owner
 * (`accountOwnerLabel`), source (`ledgerSourceLabel`), balance and badges. The
 * fixture is committed beside the iOS tests (`vitest -u` rewrites it);
 * `AccountsParityTests` decodes the same rows and must list identical groups.
 */
const FIXTURE = '../../../ios/NestTests/Fixtures/accounts-parity.json'
const STAMP = '2026-01-01T00:00:00Z'
const base = { household_id: 'h1', created_at: STAMP, updated_at: STAMP }

const member = (id: string, name: string): Tables<'members'> => ({
  ...base,
  id,
  name,
  user_id: `u-${id}`,
  email: null,
  date_of_birth: null,
  up_connected_at: null,
  up_sync_failed_at: null,
})

const account = (
  id: string,
  name: string,
  type: Account['type'],
  balance_cents: number,
  owner_member_id: string | null,
  extra: Partial<Account> = {},
): Account => ({
  ...base,
  id,
  name,
  type,
  balance_cents,
  owner_member_id,
  source: 'up',
  external_id: `ext-${id}`,
  currency: 'AUD',
  exclude_from_net_worth: false,
  deleted_from_source_at: null,
  ...extra,
})

const members = [member('m1', 'Alex'), member('m2', 'Sam')]
const accounts = [
  account('a1', '🏖️ Holiday', 'savings', 1_250_00, null),
  account('a2', 'Credit card', 'credit', -1_820_55, 'm2', { source: 'redbark' }),
  account('a3', 'Emergency', 'savings', 8_000_00, 'm1', { exclude_from_net_worth: true }),
  account('a4', 'Home loan', 'home_loan', -512_400_00, null, { source: 'redbark' }),
  account('a5', 'Offset', 'offset', 42_000_00, null, { source: 'redbark' }),
  account('a6', 'Old saver', 'savings', 0, 'gone', { deleted_from_source_at: STAMP }),
  account('a7', 'Shares', 'other', 15_000_00, 'm1', { source: 'manual' }),
  account('a8', '💳 Spending', 'transaction', 312_40, 'm1'),
  account('a9', '💳 Spending', 'transaction', 98_10, 'm2'),
]

const expected = groupAccountsByType(accounts).map((group) => ({
  label: group.label,
  total: formatCents(group.totalCents),
  accounts: group.accounts.map((row) => {
    const { emoji, label } = splitLeadingEmoji(row.name)
    return {
      id: row.id,
      emoji,
      label,
      owner: accountOwnerLabel(row, members),
      source: ledgerSourceLabel(row.source),
      balance: formatCents(row.balance_cents),
      deleted: row.deleted_from_source_at !== null,
      excluded: row.exclude_from_net_worth,
    }
  }),
}))

describe('accounts parity fixture', () => {
  it('matches the committed rows and figures', async () => {
    await expect(
      JSON.stringify({ rows: { accounts, members }, expected }, null, 2) + '\n',
    ).toMatchFileSnapshot(FIXTURE)
  })

  it('groups by type in display order, keeping name order within a group', () => {
    expect(expected.map((group) => group.label)).toEqual([
      'Spending',
      'Savings',
      'Offset',
      'Credit',
      'Home loan',
      'Other',
    ])
    expect(expected[1]?.accounts.map((row) => row.id)).toEqual(['a1', 'a3', 'a6'])
  })
})
