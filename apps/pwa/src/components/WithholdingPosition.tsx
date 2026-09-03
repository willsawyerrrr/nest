import { Stack, Text } from '@mantine/core'
import type { TaxBreakdown } from '@nest/tax'
import { moneyColor } from '../lib/money'
import { ComparedAmount } from './ComparedAmount'
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
export function WithholdingPosition({
  breakdown,
  baseline,
}: {
  breakdown: TaxBreakdown
  /** The same breakdown from the real rows, for the `real → proposed` balance move in planning mode. */
  baseline?: TaxBreakdown | undefined
}) {
  const { paygWithheldCents, totalLiabilityCents, balanceCents } = breakdown
  const color = moneyColor(-balanceCents)
  // A move that keeps the direction (still a refund, still a bill) reads as a
  // delta on the same magnitude; one that flips it just shows the new figure,
  // the surrounding words already having changed.
  const sameDirection =
    baseline !== undefined && Math.sign(baseline.balanceCents) === Math.sign(balanceCents)
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
            Tracking toward a{' '}
            <ComparedAmount
              span
              fw={600}
              baselineCents={
                sameDirection ? Math.abs(baseline.balanceCents) : Math.abs(balanceCents)
              }
              proposedCents={Math.abs(balanceCents)}
            />{' '}
            {balanceCents < 0 ? 'refund' : 'bill'}.
          </>
        )}
      </Text>
    </Stack>
  )
}
