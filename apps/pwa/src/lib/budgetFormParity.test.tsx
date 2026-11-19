import { describe, expect, it, vi } from 'vitest'
import { annualCents, type Frequency } from '@nest/plan'
import { BudgetLineForm } from '../components/BudgetLineForm'
import { MemberAllowanceForm } from '../components/MemberAllowanceForm'
import { makeBudgetLine, makeMemberAllowance } from '../test/fixtures'
import { fireEvent, render, screen, waitFor } from '../test/render'
import type { AllowanceChoice } from './allowances'
import { isManagementUrlValid, normaliseManagementUrl } from './managementUrl'

/**
 * The budget line and allowance form rules the native forms are held to. Each case
 * opens the PWA's own form on a stored row and records whether it can be saved
 * and the columns its save writes; the link and annualising cases run the PWA's
 * own helpers. The fixture is committed beside the iOS tests (`vitest -u`
 * rewrites it); `BudgetFormParityTests` opens the native form state on the same
 * rows and must agree.
 */
const FIXTURE = '../../../ios/NestTests/Fixtures/budget-form-parity.json'
const STAMP = '2026-01-01T00:00:00Z'
const own: AllowanceChoice = {
  memberId: 'm1',
  name: 'Ada’s allowance',
  remainingAnnualCents: 1_000_00,
}

const line = (id: string, overrides: Parameters<typeof makeBudgetLine>[0]) =>
  makeBudgetLine({ id, created_at: STAMP, updated_at: STAMP, ...overrides })

const lineCases = [
  {
    name: 'a plain needs line',
    line: line('rent', { line_group: 'needs', amount_cents: 2_400_00 }),
    allowances: [],
  },
  {
    name: 'an every-3-weeks line with a funding account and a bare-domain link',
    line: line('netflix', {
      line_group: 'wants',
      amount_cents: 22_99,
      frequency: 'every_n_weeks',
      interval_count: 3,
      destination_account_id: 'a1',
      management_url: 'netflix.com/account',
    }),
    allowances: [],
  },
  {
    name: 'a savings line linked to a goal',
    line: line('holiday', { line_group: 'savings', amount_cents: 300_00, goal_id: 'g1' }),
    allowances: [],
  },
  {
    name: 'a drawn line within what is left',
    line: line('coffee', {
      line_group: 'discretionary',
      amount_cents: 20_00,
      frequency: 'weekly',
      allowance_member_id: 'm1',
    }),
    allowances: [own],
  },
  {
    name: 'a drawn line whose allowance is already overdrawn by others',
    line: line('games', {
      line_group: 'discretionary',
      amount_cents: 50_00,
      frequency: 'monthly',
      allowance_member_id: 'm1',
    }),
    allowances: [{ ...own, remainingAnnualCents: -1_00 }],
  },
  {
    name: 'a discretionary line drawn from an allowance the editor cannot draw from',
    line: line('ben', {
      line_group: 'discretionary',
      amount_cents: 10_00,
      allowance_member_id: 'm2',
      destination_account_id: null,
    }),
    allowances: [own],
  },
  {
    name: 'an every-N-months line with no interval',
    line: line('rates', { line_group: 'needs', amount_cents: 500_00, frequency: 'every_n_months' }),
    allowances: [],
  },
  {
    name: 'a line with a non-http link',
    line: line('bad', {
      line_group: 'wants',
      amount_cents: 1_00,
      management_url: 'ftp://example.com',
    }),
    allowances: [],
  },
  {
    name: 'a zero-amount line',
    line: line('free', { line_group: 'wants', amount_cents: 0 }),
    allowances: [],
  },
]

const allowance = (overrides: Parameters<typeof makeMemberAllowance>[0]) =>
  makeMemberAllowance({ created_at: STAMP, updated_at: STAMP, ...overrides })

const allowanceCases = [
  {
    name: 'an allowance above what is drawn',
    allowance: allowance({ amount_cents: 200_00 }),
    drawnAnnualCents: 1_000_00,
  },
  {
    name: 'an allowance below what is drawn',
    allowance: allowance({ amount_cents: 20_00, frequency: 'monthly' }),
    drawnAnnualCents: 1_000_00,
  },
  {
    name: 'an every-2-months allowance with a funding account',
    allowance: allowance({
      amount_cents: 300_00,
      frequency: 'every_n_months',
      interval_count: 2,
      destination_account_id: 'a1',
    }),
    drawnAnnualCents: 0,
  },
  {
    name: 'an every-N-weeks allowance with no interval',
    allowance: allowance({ frequency: 'every_n_weeks', interval_count: null }),
    drawnAnnualCents: 0,
  },
]

const links = [
  '',
  '   ',
  'netflix.com/account',
  'Example.COM',
  'https://spotify.com/account?x=1',
  'http://example.com',
  'javascript:alert(1)',
  'ftp://example.com',
  'not a url',
  'localhost',
  'https://',
  `https://example.com/${'a'.repeat(2048)}`,
]

const cadences: { amountCents: number; frequency: Frequency; interval: number | null }[] = [
  { amountCents: 100_00, frequency: 'weekly', interval: null },
  { amountCents: 100_00, frequency: 'biannual', interval: null },
  { amountCents: 333_33, frequency: 'every_n_weeks', interval: 3 },
  { amountCents: 100_01, frequency: 'every_n_months', interval: 5 },
  { amountCents: 100_00, frequency: 'every_n_weeks', interval: null },
]

/** Opens `form`, then whether its submit is enabled and, if so, what it saves. */
async function outcome(
  form: React.ReactElement,
  submit: RegExp,
  onSubmit: ReturnType<typeof vi.fn>,
) {
  const { unmount } = render(form)
  const button = screen.getByRole('button', { name: submit })
  const canSubmit = !(button as HTMLButtonElement).disabled
  if (canSubmit) {
    fireEvent.click(button)
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
  }
  unmount()
  return { canSubmit, input: canSubmit ? (onSubmit.mock.calls[0]?.[0] as unknown) : null }
}

describe('the native budget form parity fixture', () => {
  it('matches what the PWA forms and helpers decide', async () => {
    const lines = []
    for (const testCase of lineCases) {
      const onSubmit = vi.fn()
      const result = await outcome(
        <BudgetLineForm
          initial={testCase.line}
          allowances={testCase.allowances}
          onSubmit={onSubmit}
        />,
        /save changes/i,
        onSubmit,
      )
      lines.push({ ...testCase, expected: result })
    }
    const allowances = []
    for (const testCase of allowanceCases) {
      const onSubmit = vi.fn()
      const result = await outcome(
        <MemberAllowanceForm
          memberName="Ada"
          initial={testCase.allowance}
          drawnAnnualCents={testCase.drawnAnnualCents}
          onSubmit={onSubmit}
        />,
        /save changes/i,
        onSubmit,
      )
      allowances.push({ ...testCase, expected: result })
    }
    const text = `${JSON.stringify(
      {
        lines,
        allowances,
        links: links.map((value) => ({
          value,
          valid: isManagementUrlValid(value),
          normalised: normaliseManagementUrl(value),
        })),
        cadences: cadences.map((cadence) => ({
          ...cadence,
          annualCents: annualCents(
            cadence.amountCents,
            cadence.frequency,
            cadence.interval ?? undefined,
          ),
        })),
      },
      null,
      2,
    )}\n`
    await expect(text).toMatchFileSnapshot(FIXTURE)
    expect(lines.filter(({ expected }) => !expected.canSubmit)).toHaveLength(3)
    expect(allowances.filter(({ expected }) => !expected.canSubmit)).toHaveLength(2)
  })
})
