import { Box, Group, rem, Stack, Text } from '@mantine/core'
import type { TaxBreakdown } from '@nest/tax'
import { formatCents } from '../lib/money'
import { taxWaterfallSteps, type WaterfallStep } from '../lib/taxWaterfall'
import { chartColors } from '../lib/tokens'
import { MoneyText } from './MoneyText'

/**
 * The bar colour for a step: income and take-home in the positive tone, the
 * concessional-super diversion in the salary-sacrifice brand, and each tax
 * reduction in the tax (negative) family — so income reads apart from what is
 * taken out of it. All refs resolve from the shared design tokens.
 */
function stepColor(step: WaterfallStep): string {
  if (step.kind !== 'reduction') {
    return 'var(--mantine-color-positive-filled)'
  }
  return step.key === 'concessional-super' ? chartColors.sacrifice : chartColors.tax
}

/** A step's label, its floating bar on the shared cash axis, and — for a reduction — the amount taken. */
function WaterfallRow({ step, maxCents }: { step: WaterfallStep; maxCents: number }) {
  const leftPct = (step.startCents / maxCents) * 100
  const widthPct = ((step.endCents - step.startCents) / maxCents) * 100
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
            width: `${Math.max(widthPct, 0.5)}%`,
            backgroundColor: stepColor(step),
            borderRadius: 'var(--mantine-radius-xs)',
          }}
        />
      </Box>
      <Box w={rem(84)} style={{ flexShrink: 0 }}>
        {step.kind === 'reduction' && (
          <MoneyText span size="xs" c="dimmed" ta="right" cents={-step.amountCents} />
        )}
      </Box>
    </Group>
  )
}

/**
 * A horizontal waterfall of a member's income build-up: gross income at full
 * width, each concessional-super and tax reduction stepping down as a floating
 * bar, and take-home as the remaining positive bar — reading the estimate's own
 * figures (`taxWaterfallSteps`). The endpoint magnitudes are the card's gross and
 * take-home headline figures, so only the reductions between them carry an amount.
 * Renders nothing until there is gross income to divide.
 */
export function TaxWaterfall({
  grossCents,
  concessionalCents,
  breakdown,
  afterTaxCents,
}: {
  grossCents: number
  concessionalCents: number
  breakdown: TaxBreakdown
  afterTaxCents: number
}) {
  if (grossCents <= 0) {
    return null
  }
  const steps = taxWaterfallSteps({ grossCents, concessionalCents, breakdown, afterTaxCents })
  const maxCents = Math.max(...steps.map((step) => step.endCents))
  return (
    <Box component="figure" m={0} aria-label="Income build-up">
      <Stack gap={6}>
        {steps.map((step) => (
          <WaterfallRow key={step.key} step={step} maxCents={maxCents} />
        ))}
      </Stack>
    </Box>
  )
}
