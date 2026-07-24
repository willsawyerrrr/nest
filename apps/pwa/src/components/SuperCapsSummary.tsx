import { Alert, Stack, Text } from '@mantine/core'
import { formatCents } from '../lib/money'
import type { SuperCapSummary as SuperCapSummaryData } from '../lib/tax'

/** A compact `$X of $CAP used` line, with the amount emphasised. */
function CapLine({
  label,
  usedCents,
  capCents,
}: {
  label: string
  usedCents: number
  capCents: number
}) {
  return (
    <Text size="xs" c="dimmed">
      {label}:{' '}
      <Text span fw={600} c="var(--mantine-color-text)">
        {formatCents(usedCents)}
      </Text>{' '}
      of {formatCents(capCents)} used
    </Text>
  )
}

/**
 * A member's contribution-cap status: concessional and non-concessional usage
 * against their caps (warning when either is exceeded) and the estimated
 * government co-contribution when it applies. Compact and mobile-first, sitting
 * under the member's super card.
 */
export function SuperCapsSummary({ summary }: { summary: SuperCapSummaryData }) {
  return (
    <Stack gap={6}>
      <div>
        <CapLine
          label="Concessional"
          usedCents={summary.concessionalCents}
          capCents={summary.concessionalCapCents}
        />
        <Text size="xs" c="dimmed">
          Cap includes carry-forward from prior years.
        </Text>
        {summary.concessionalOverCap && (
          <Alert color="red" variant="light" p="xs" mt="xxs">
            <Text size="xs">
              Over the concessional cap ({formatCents(summary.concessionalCapCents)}). Excess is
              taxed at your marginal rate.
            </Text>
          </Alert>
        )}
      </div>

      <div>
        <CapLine
          label="Non-concessional"
          usedCents={summary.nonConcessionalCents}
          capCents={summary.nonConcessionalCapCents}
        />
        <Text size="xs" c="dimmed">
          Bring-forward may allow up to 3&times; the cap.
        </Text>
        {summary.nonConcessionalOverCap && (
          <Alert color="red" variant="light" p="xs" mt="xxs">
            <Text size="xs">
              Over the non-concessional cap ({formatCents(summary.nonConcessionalCapCents)}) —
              unless bring-forward applies.
            </Text>
          </Alert>
        )}
      </div>

      {summary.coContributionCents > 0 && (
        <Alert color="teal" variant="light" p="xs">
          <Text size="xs">
            Estimated government co-contribution {formatCents(summary.coContributionCents)}, added
            to super.
          </Text>
        </Alert>
      )}
    </Stack>
  )
}
