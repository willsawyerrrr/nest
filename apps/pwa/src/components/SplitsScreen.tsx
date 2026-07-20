import { Alert, Badge, Button, Card, Group, Stack, Text, Title } from '@mantine/core'
import { IconRefresh } from '@tabler/icons-react'
import { assignmentsByAccount, roundCentsUpToStep } from '@nest/plan'
import type { Account } from '../hooks/useAccounts'
import type { BudgetLine } from '../hooks/useBudgetLines'
import type { Goal } from '../hooks/useGoals'
import { accountLabel } from '../lib/accountName'
import { formatCents } from '../lib/money'
import { AccountIcon } from './AccountIcon'

/** Pay splits are typed into Up in round figures; cents-exact amounts add no value. */
const ROUND_STEP_CENTS = 5_00

interface SplitsScreenProps {
  accounts: Account[]
  lines: BudgetLine[]
  goals: Goal[]
  onRefresh: () => void
  refreshing: boolean
  refreshError: string | null
}

/** Whether an account is a synced Up saver (as opposed to the everyday transaction account). */
function isSaver(account: Account): boolean {
  return account.source === 'up' && account.type === 'savings'
}

/** One routed account: its name, the recommended fortnightly split, and the cents-exact figure. */
function SplitRow({ account, fortnightlyCents }: { account: Account; fortnightlyCents: number }) {
  const rounded = roundCentsUpToStep(fortnightlyCents, ROUND_STEP_CENTS)
  return (
    <Card withBorder radius="md" p="sm">
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
          <AccountIcon name={account.name} size={16} />
          <Text fw={600} size="sm" truncate>
            {accountLabel(account.name)}
          </Text>
        </Group>
        <Stack gap={0} align="flex-end" style={{ flexShrink: 0 }}>
          <Group gap={2} wrap="nowrap" align="baseline">
            <Text fw={700} size="sm">
              {formatCents(rounded)}
            </Text>
            <Text size="xs" c="dimmed">
              / fn
            </Text>
          </Group>
          {rounded !== fortnightlyCents && (
            <Text size="xs" c="dimmed">
              {formatCents(fortnightlyCents)} exact
            </Text>
          )}
        </Stack>
      </Group>
    </Card>
  )
}

/**
 * Recommended fortnightly pay splits, one per account funded by budget lines.
 * Up's API can neither read nor set pay-split config, so this is recommend-only:
 * the plan computes what each saver's split should be, and the household mirrors
 * it into Up by hand. Savings/Investments lines route via their goal's linked
 * saver; every other line routes via its own funding account. Presentational —
 * persistence and Up sync live in the caller.
 */
export function SplitsScreen({
  accounts,
  lines,
  goals,
  onRefresh,
  refreshing,
  refreshError,
}: SplitsScreenProps) {
  const { byAccount, unassignedFortnightlyCents } = assignmentsByAccount(
    lines.map((line) => ({
      group: line.line_group,
      amountCents: line.amount_cents,
      frequency: line.frequency,
      intervalWeeks: line.interval_weeks ?? undefined,
      goalId: line.goal_id,
      destinationAccountId: line.destination_account_id,
    })),
    goals.map((goal) => ({ id: goal.id, linkedAccountId: goal.linked_account_id })),
  )

  const accountById = new Map(accounts.map((account) => [account.id, account]))
  const rows = Object.entries(byAccount)
    .map(([id, fortnightlyCents]) => ({ account: accountById.get(id), fortnightlyCents }))
    .filter(
      (row): row is { account: Account; fortnightlyCents: number } => row.account !== undefined,
    )
    .sort((a, b) => a.account.name.localeCompare(b.account.name))

  const saverRows = rows.filter((row) => isSaver(row.account))
  const otherRows = rows.filter((row) => !isSaver(row.account))
  const nothingRouted = rows.length === 0 && unassignedFortnightlyCents === 0

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center" wrap="nowrap">
        <Title order={2}>Splits</Title>
        <Button
          variant="light"
          size="xs"
          leftSection={<IconRefresh size={16} />}
          onClick={onRefresh}
          loading={refreshing}
        >
          Refresh
        </Button>
      </Group>

      {refreshError && (
        <Alert color="red" variant="light">
          {refreshError}
        </Alert>
      )}

      <Text size="sm" c="dimmed">
        Up can’t read or set pay splits, so these are recommendations: set each saver’s pay split in
        Up to match. Amounts are the fortnightly total of the budget lines routed to each account,
        rounded up to the nearest $5.
      </Text>

      {nothingRouted && (
        <Text c="dimmed" size="sm">
          Route budget lines to an account — set “Funded from” on a line, or link a Savings goal to
          an Up saver — to see recommended splits here.
        </Text>
      )}

      {saverRows.length > 0 && (
        <Stack gap="xs">
          <Group gap="xs" align="center">
            <Title order={3} size="h5">
              Recommended pay splits
            </Title>
            <Badge size="sm" variant="light" color="teal">
              set in Up
            </Badge>
          </Group>
          {saverRows.map((row) => (
            <SplitRow
              key={row.account.id}
              account={row.account}
              fortnightlyCents={row.fortnightlyCents}
            />
          ))}
        </Stack>
      )}

      {otherRows.length > 0 && (
        <Stack gap="xs">
          <Title order={3} size="h5">
            Stays in your everyday account
          </Title>
          {otherRows.map((row) => (
            <SplitRow
              key={row.account.id}
              account={row.account}
              fortnightlyCents={row.fortnightlyCents}
            />
          ))}
        </Stack>
      )}

      {unassignedFortnightlyCents > 0 && (
        <Alert color="yellow" variant="light" title="Unassigned">
          {formatCents(unassignedFortnightlyCents)} / fn comes from budget lines not yet routed to
          an account. Set a “Funded from” account on those lines, or link their Savings goal to an
          Up saver, to fold them into a split.
        </Alert>
      )}
    </Stack>
  )
}
