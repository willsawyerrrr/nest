import { describe, expect, it } from 'vitest'
import { breakdown, breakdownItems, NOW, rows } from '../test/summaryRows'
import { derivedAmountContext } from './breakdowns'
import { summariseHousehold } from './summary'

/**
 * The household the native Summary screen is held to (`summaryRows`). The
 * figures are what the PWA's own
 * `summariseHousehold` produces from them. The fixture is committed beside the
 * iOS tests (`vitest -u` rewrites it), which decode the same rows, assemble the engine input the screen
 * does, run the bundled engine, and must return identical figures.
 */
const FIXTURE = '../../../ios/NestTests/Fixtures/summary-parity.json'
const expected = JSON.parse(
  JSON.stringify(
    summariseHousehold({
      inflows: rows.inflows,
      budgetLines: rows.budgetLines,
      memberAllowances: rows.memberAllowances,
      taxProfiles: rows.taxProfiles,
      contributions: rows.contributions,
      helpDebts: rows.helpDebts,
      deductions: rows.deductions,
      members: rows.members,
      goals: rows.savingsGoals,
      accounts: rows.savers.map((account) => ({
        id: account.id ?? '',
        balance_cents: account.balance_cents ?? 0,
        owner_member_id: account.owner_member_id,
      })),
      derivedAmounts: derivedAmountContext([breakdown], breakdownItems, [], [], null),
      temporaryItems: rows.temporaryItems,
      now: new Date(NOW),
    }),
  ),
) as unknown

describe('the native Summary parity fixture', () => {
  const text = `${JSON.stringify([{ name: 'a two-member household', now: NOW, rows, expected }], null, 2)}\n`

  it('matches what the PWA Summary computes from the same rows', async () => {
    await expect(text).toMatchFileSnapshot(FIXTURE)
  })

  it('exercises derived lines, an allowance, a one-off and a saver-linked goal', () => {
    expect(expected).toMatchObject({ oneOffCents: expect.any(Number) })
    const summary = expected as { oneOffCents: number; allowances: unknown[] }
    expect(summary.oneOffCents).toBeGreaterThan(0)
    expect(summary.allowances).toHaveLength(1)
  })
})
