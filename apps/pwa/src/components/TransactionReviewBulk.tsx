import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Anchor, Button, Checkbox, Group, Select, Stack, Text } from '@mantine/core'
import {
  reviewErrorMessage,
  reviewErrorNeedsConnections,
  type CategoryGroup,
} from '../lib/transactionReview'

/** A bulk action's failures, by transaction, kept to say which ones are still waiting. */
export type BulkFailure = { label: string; code: string | null }[]

/** Why each transaction a bulk action could not save is still waiting, with a Connections link where that is the fix. */
export function BulkFailureAlert({
  failure,
  onClose,
}: {
  failure: BulkFailure
  onClose: () => void
}) {
  const needsConnections = failure.some(({ code }) => reviewErrorNeedsConnections(code))
  return (
    <Alert
      color="negative"
      variant="light"
      p="xs"
      withCloseButton
      onClose={onClose}
      title={`${failure.length} couldn't be saved and ${failure.length === 1 ? 'is' : 'are'} still waiting for review`}
    >
      <Stack gap={2}>
        {failure.map(({ label, code }, index) => (
          <Text key={index} size="sm">
            {label}: {reviewErrorMessage(code)}
          </Text>
        ))}
        {needsConnections && (
          <Anchor component={Link} to="/settings/connections" size="sm">
            Open Connections
          </Anchor>
        )}
      </Stack>
    </Alert>
  )
}

/**
 * Select all, the selected count, and the bulk actions: mark the selection
 * reviewed as it stands, or set one category on all of it.
 */
export function BulkBar({
  selectable,
  selectedCount,
  groups,
  busy,
  onSelectAll,
  onReviewMany,
  onCategoriseMany,
}: {
  selectable: number
  selectedCount: number
  groups: CategoryGroup[]
  busy: 'review' | 'categorise' | null
  onSelectAll: (selected: boolean) => void
  onReviewMany: () => void
  onCategoriseMany: (categoryId: string) => void
}) {
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const none = selectedCount === 0
  return (
    <Group gap="sm" wrap="wrap" align="flex-end">
      <Checkbox
        size="xs"
        label={none ? 'Select all' : `${selectedCount} selected`}
        checked={selectedCount === selectable}
        indeterminate={!none && selectedCount < selectable}
        onChange={(event) => onSelectAll(event.currentTarget.checked)}
        disabled={busy !== null}
        style={{ alignSelf: 'center' }}
      />
      {!none && (
        <>
          <Button
            size="xs"
            variant="light"
            loading={busy === 'review'}
            disabled={busy === 'categorise'}
            onClick={onReviewMany}
          >
            Mark reviewed
          </Button>
          <Group gap="xs" wrap="nowrap" align="flex-end">
            <Select
              size="xs"
              aria-label="Category for selected"
              placeholder="Set category"
              data={groups}
              value={categoryId}
              onChange={setCategoryId}
              searchable
              disabled={busy !== null}
              w={200}
            />
            <Button
              size="xs"
              disabled={categoryId === null || busy === 'review'}
              loading={busy === 'categorise'}
              onClick={() => categoryId !== null && onCategoriseMany(categoryId)}
            >
              Apply
            </Button>
          </Group>
        </>
      )}
    </Group>
  )
}
