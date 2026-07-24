import { Box, Group, rem, Stack, Text } from '@mantine/core'
import type { TaxBreakdown } from '@nest/tax'
import { formatCents } from '../lib/money'
import { taxWaterfallSteps, type WaterfallStep } from '../lib/taxWaterfall'
import { chartColors } from '../lib/tokens'
import { MoneyText } from './MoneyText'

/**
 * The bar colour for a step: income and take-home in the positive tone, the
 * concessional-super diversion in the salary-sacrifice brand, deductions in the
 * neutral buffer tone (they touch taxable income, not cash), and each tax
 * component in the tax (negative) family. All refs resolve from the shared tokens.
 */
function stepColor(step: WaterfallStep): string {
  switch (step.kind) {
    case 'income':
    case 'result':
      return 'var(--mantine-color-positive-filled)'
    case 'super':
      return chartColors.sacrifice
    case 'deduction':
      return chartColors.buffer
    default:
      return chartColors.tax
  }
}

/** A step's label, its floating bar on the shared money axis, and — for a mid-flow step — the amount moved. */
function WaterfallRow({ step, maxCents }: { step: WaterfallStep; maxCents: number }) {
  const leftPct = Math.max((step.startCents / maxCents) * 100, 0)
  const widthPct = Math.max(((step.endCents - step.startCents) / maxCents) * 100, 0.5)
  const endpoint = step.kind === 'income' || step.kind === 'result'
  return (
    <Group gap="sm" wrap="nowrap">
      <Text size="xs" c="dimmed" w={rem(116)} style={{ flexShrink: 0 }} truncate>
        {step.label}
      </Text>
      <Box style={{ position: 'relative', flex: 1, height: rem(14) }}>
        <Box
          title={`${step.label}: ${formatCents(step.amountCents)}`}
          style={{
            position: 'absolute',
            insetBlock: 0,
            left: `${leftPct}%`,
            width: `${widthPct}%`,
            backgroundColor: stepColor(step),
            borderRadius: 'var(--mantine-radius-xs)',
          }}
        />
      </Box>
      <Box w={rem(84)} style={{ flexShrink: 0 }}>
        {!endpoint && (
          <MoneyText
            span
            size="xs"
            c="dimmed"
            ta="right"
            cents={step.increase ? step.amountCents : -step.amountCents}
          />
        )}
      </Box>
    </Group>
  )
}

/**
 * A horizontal waterfall of a member's income build-up: gross income at full
 * width, then deductions, the concessional-super diversion, and each tax
 * component stepping down to the remaining take-home bar — reading the estimate's
 * own figures (`taxWaterfallSteps`). Deductions are returned as a `Deductions
 * kept` step, since they cut taxable income and tax but not the cash kept; a
 * caption notes this whenever a deduction shows. The gross and take-home
 * endpoints are the card's headline figures, so only the steps between them carry
 * a printed amount. Renders nothing until there is gross income to divide.
 */
export function TaxWaterfall({
  grossCents,
  deductionsCents,
  concessionalCents,
  breakdown,
  afterTaxCents,
}: {
  grossCents: number
  deductionsCents: number
  concessionalCents: number
  breakdown: TaxBreakdown
  afterTaxCents: number
}) {
  if (grossCents <= 0) {
    return null
  }
  const steps = taxWaterfallSteps({
    grossCents,
    deductionsCents,
    concessionalCents,
    breakdown,
    afterTaxCents,
  })
  const maxCents = Math.max(...steps.map((step) => step.endCents))
  const hasDeductions = steps.some((step) => step.key === 'deductions')
  return (
    <Box component="figure" m={0} aria-label="Income build-up">
      <Stack gap={6}>
        {steps.map((step) => (
          <WaterfallRow key={step.key} step={step} maxCents={maxCents} />
        ))}
      </Stack>
      {hasDeductions && (
        <Text component="figcaption" size="xs" c="dimmed" mt="xs">
          Deductions lower taxable income and tax, not the cash you keep.
        </Text>
      )}
    </Box>
  )
}
