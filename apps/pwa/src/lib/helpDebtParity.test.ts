import { describe, expect, it } from 'vitest'
import type { Tables } from './database.types'
import { centsToDollars, dollarsToCents, formatCents } from './money'

/**
 * The HELP balances the native HELP debt screen is held to. The rows are written in full,
 * as PostgREST returns them; the figures are what `HelpDebtScreen` shows for each member
 * (the balance, and the editor's starting value) and the cents a typed balance saves as.
 * The fixture is committed beside the iOS tests (`vitest -u` rewrites it);
 * `HelpDebtParityTests` decodes the same rows and must list and save the same.
 */
const FIXTURE = '../../../ios/NestTests/Fixtures/help-debt-parity.json'
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

const debt = (id: string, member_id: string, balance_cents: number): Tables<'help_debt'> => ({
  ...base,
  id,
  member_id,
  balance_cents,
})

const members = [member('m1', 'Alex'), member('m2', 'Jo'), member('m3', 'Sam')]
const helpDebts = [debt('d1', 'm1', 45_210_99), debt('d2', 'm3', 0)]

const listed = members.map((row) => {
  const balance = helpDebts.find((d) => d.member_id === row.id)?.balance_cents
  const initial = centsToDollars(balance)
  return {
    id: row.id,
    name: row.name,
    balance: formatCents(balance ?? 0),
    input: initial === '' ? '' : initial.toLocaleString('en-AU', { minimumFractionDigits: 2 }),
  }
})

/** What `MemberHelpDebtForm` saves for a typed value: `dollarsToCents(…) ?? 0`. */
const typed = ['45210.99', '1234.5', '0.07', '0', ''].map((text) => ({
  text,
  cents: dollarsToCents(text === '' ? '' : Number(text)) ?? 0,
}))

describe('HELP debt parity fixture', () => {
  it('matches the committed rows and figures', async () => {
    await expect(
      JSON.stringify({ rows: { members, helpDebts }, expected: listed, typed }, null, 2) + '\n',
    ).toMatchFileSnapshot(FIXTURE)
  })

  it('shows a member with no row at zero and an empty editor', () => {
    expect(listed[1]).toMatchObject({ balance: '$0.00', input: '' })
  })
})
