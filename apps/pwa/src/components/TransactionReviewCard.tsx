import { Link } from 'react-router-dom'
import { Button, Group, Stack, Text } from '@mantine/core'
import { AppCard } from './AppCard'

/**
 * The Summary's prompt to review new Up transactions, linking to the review
 * screen. Renders nothing when there are none.
 */
export function TransactionReviewCard({ count }: { count: number }) {
  if (count <= 0) {
    return null
  }
  return (
    <AppCard density="compact">
      <Group justify="space-between" wrap="nowrap">
        <Stack gap={0}>
          <Text fw={600}>{count} to review</Text>
          <Text size="sm" c="dimmed">
            Confirm the category of your new Up {count === 1 ? 'transaction' : 'transactions'}.
          </Text>
        </Stack>
        <Button size="compact-sm" variant="light" component={Link} to="/transactions/review">
          Review
        </Button>
      </Group>
    </AppCard>
  )
}
