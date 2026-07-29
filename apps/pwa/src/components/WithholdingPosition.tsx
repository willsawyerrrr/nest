import { Stack, Text } from '@mantine/core'
import type { TaxBreakdown } from '@nest/tax'
import { moneyColor } from '../lib/money'
import { MoneyText } from './MoneyText'

/**
 * Where a financial year's actual withholding sits against the estimated
 * liability: what the member's payslips have had withheld, and the refund or bill
 * the two imply (`balanceCents`, positive when owing). The refund direction takes
 * the positive tone and the bill direction the negative one — money coming back
 * versus money still to find. Shared by the Tax and EOFY tabs so both name the
 * same position in the same words; each decides for itself when a member has
 * enough actuals for a position to mean anything.
 */
export function WithholdingPosition({ breakdown }: { breakdown: TaxBreakdown }) {
  const { paygWithheldCents, totalLiabilityCents, balanceCents } = breakdown
  const color = moneyColor(-balanceCents)
  return (
    <Stack gap={2}>
      <Text size="sm">
        Withheld so far <MoneyText span fw={600} cents={paygWithheldCents} /> of{' '}
        <MoneyText span cents={totalLiabilityCents} /> estimated tax.
      </Text>
      <Text size="sm" {...(color !== undefined && { c: color })}>
        {balanceCents === 0 ? (
          'Tracking toward no refund or bill.'
        ) : (
          <>
            Tracking toward a <MoneyText span fw={600} cents={Math.abs(balanceCents)} />{' '}
            {balanceCents < 0 ? 'refund' : 'bill'}.
          </>
        )}
      </Text>
    </Stack>
  )
}
