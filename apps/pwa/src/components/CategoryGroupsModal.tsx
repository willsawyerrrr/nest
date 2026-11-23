import { useState } from 'react'
import { Group, Modal, Select, Stack, Text, Title } from '@mantine/core'
import type { CategoryGroup } from '../hooks/useCategoryGroups'
import { BUDGET_GROUPS, groupLabel } from '../lib/budgetGroups'
import type { BudgetGroup } from '../lib/domain'

const DEFAULT = 'default'
const NONE = 'none'

interface CategoryGroupsModalProps {
  opened: boolean
  onClose: () => void
  /** Every Up child category; null while loading. */
  categories: CategoryGroup[] | null
  onSetGroup: (categoryId: string, group: BudgetGroup | null) => Promise<void>
  onResetGroup: (categoryId: string) => Promise<void>
}

/** The Select value for a category: its override's group, `none`, or `default`. */
function selection(category: CategoryGroup): string {
  if (category.override === undefined) {
    return DEFAULT
  }
  return category.override ?? NONE
}

/**
 * The Up category → budget group map, editable per category: each child
 * category, under its parent, picks the shared default, a group, or no group.
 */
export function CategoryGroupsModal({
  opened,
  onClose,
  categories,
  onSetGroup,
  onResetGroup,
}: CategoryGroupsModalProps) {
  const [error, setError] = useState<string | null>(null)

  const change = async (category: CategoryGroup, value: string | null) => {
    setError(null)
    try {
      if (value === DEFAULT) {
        await onResetGroup(category.id)
      } else {
        await onSetGroup(category.id, value === NONE ? null : (value as BudgetGroup))
      }
    } catch {
      setError(`Couldn’t change ${category.name}’s group. Try again.`)
    }
  }

  const parents = [...new Set((categories ?? []).map((category) => category.parentName))]

  return (
    <Modal opened={opened} onClose={onClose} title="Category groups">
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          The budget group each Up category’s spend counts toward.
        </Text>
        {error && (
          <Text size="sm" c="red" role="alert">
            {error}
          </Text>
        )}
        {categories === null && <Text size="sm">Loading…</Text>}
        {parents.map((parent) => (
          <Stack key={parent} gap="xs">
            <Title order={4} size="h6">
              {parent}
            </Title>
            {categories
              ?.filter((category) => category.parentName === parent)
              .map((category) => (
                <Group key={category.id} justify="space-between" wrap="nowrap">
                  <Text size="sm">{category.name}</Text>
                  <Select
                    size="xs"
                    w={170}
                    aria-label={`${category.name} group`}
                    allowDeselect={false}
                    value={selection(category)}
                    onChange={(value) => void change(category, value)}
                    data={[
                      {
                        value: DEFAULT,
                        label: `Default (${category.defaultGroup ? groupLabel(category.defaultGroup) : 'No group'})`,
                      },
                      ...BUDGET_GROUPS,
                      { value: NONE, label: 'No group' },
                    ]}
                  />
                </Group>
              ))}
          </Stack>
        ))}
      </Stack>
    </Modal>
  )
}
