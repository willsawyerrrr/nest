import { Badge, Button, Card, Group, Stack, Text } from '@mantine/core'
import type { Member } from '../hooks/useMembers'
import type { Income } from '../hooks/useIncomes'
import { formatCents } from '../lib/money'

interface IncomeListProps {
  incomes: Income[]
  members: Member[]
  onEdit: (income: Income) => void
  onDelete: (id: string) => void
}

/** Describes an income's entered amount: a flat amount, or a wage's rate × hours. */
function describeAmount(income: Income): string {
  if (income.type === 'wage') {
    const rate = formatCents(income.hourly_rate_cents ?? 0)
    return `${rate} × ${income.hours_per_period ?? 0} hrs`
  }
  return formatCents(income.amount_cents ?? 0)
}

/** Presentational list of the household's incomes with edit/delete controls. */
export function IncomeList({ incomes, members, onEdit, onDelete }: IncomeListProps) {
  const memberName = (id: string) => members.find((member) => member.id === id)?.name ?? 'Unknown'

  if (incomes.length === 0) {
    return (
      <Text c="dimmed" ta="center">
        No incomes yet. Add one to get started.
      </Text>
    )
  }

  return (
    <Stack gap="sm">
      {incomes.map((income) => (
        <Card key={income.id} withBorder radius="md" p="md">
          <Stack gap="sm">
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Stack gap={2} style={{ minWidth: 0 }}>
                <Text fw={600}>{income.name}</Text>
                <Text size="sm" c="dimmed">
                  {memberName(income.member_id)}
                </Text>
                <Text size="lg" fw={700}>
                  {describeAmount(income)}
                </Text>
              </Stack>
              <Group gap={4}>
                <Badge variant="light" tt="capitalize">
                  {income.type}
                </Badge>
                <Badge variant="outline" tt="capitalize">
                  {income.schedule}
                </Badge>
              </Group>
            </Group>
            <Group grow>
              <Button variant="light" size="sm" onClick={() => onEdit(income)}>
                Edit
              </Button>
              <Button variant="subtle" color="red" size="sm" onClick={() => onDelete(income.id)}>
                Delete
              </Button>
            </Group>
          </Stack>
        </Card>
      ))}
    </Stack>
  )
}
