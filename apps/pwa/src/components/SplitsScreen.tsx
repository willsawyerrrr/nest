import { useLocalStorage } from '@mantine/hooks'
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Select,
  Stack,
  Text,
  Title,
} from '@mantine/core'
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

/** One routed account: the account and its recommended fortnightly split. */
interface SplitRowData {
  account: Account
  fortnightlyCents: number
}

/** Which field the split rows are ordered by. */
type SortKey = 'title' | 'amount'

/** Which way a sorted order runs. */
type SortDirection = 'asc' | 'desc'

/** The persisted sort preference for the split rows. */
interface SortPreference {
  key: SortKey
  direction: SortDirection
}

const SORT_STORAGE_KEY = 'splits-sort'
const DEFAULT_SORT: SortPreference = { key: 'title', direction: 'asc' }

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'title', label: 'Title' },
  { value: 'amount', label: 'Amount' },
]

/**
 * Orders rows by the chosen key and direction, sorting a copy so the caller's
 * array is untouched. `title` compares the displayed account labels (the leading
 * emoji stripped, as shown); `amount` compares the fortnightly split. Both sort
 * ascending then reverse for descending.
 */
function sortRows(rows: SplitRowData[], key: SortKey, direction: SortDirection): SplitRowData[] {
  const sorted = [...rows].sort((a, b) =>
    key === 'title'
      ? accountLabel(a.account.name).localeCompare(accountLabel(b.account.name))
      : a.fortnightlyCents - b.fortnightlyCents,
  )
  return direction === 'desc' ? sorted.reverse() : sorted
}

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

  const [sort, setSort] = useLocalStorage<SortPreference>({
    key: SORT_STORAGE_KEY,
    defaultValue: DEFAULT_SORT,
    getInitialValueInEffect: false,
  })
  const { key: sortKey, direction: sortDirection } = sort

  const accountById = new Map(accounts.map((account) => [account.id, account]))
  const rows = Object.entries(byAccount)
    .map(([id, fortnightlyCents]) => ({ account: accountById.get(id), fortnightlyCents }))
    .filter((row): row is SplitRowData => row.account !== undefined)

  const saverRows = sortRows(
    rows.filter((row) => isSaver(row.account)),
    sortKey,
    sortDirection,
  )
  const otherRows = sortRows(
    rows.filter((row) => !isSaver(row.account)),
    sortKey,
    sortDirection,
  )
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

      {!nothingRouted && (
        <Group gap="xs" wrap="nowrap" justify="flex-end">
          <Select
            aria-label="Sort by"
            data={SORT_OPTIONS}
            value={sortKey}
            onChange={(value) =>
              value && setSort((current) => ({ ...current, key: value as SortKey }))
            }
            allowDeselect={false}
          />
          <ActionIcon
            variant="default"
            size="lg"
            aria-label="Toggle sort direction"
            onClick={() =>
              setSort((current) => ({
                ...current,
                direction: current.direction === 'asc' ? 'desc' : 'asc',
              }))
            }
          >
            {sortDirection === 'asc' ? '↑' : '↓'}
          </ActionIcon>
        </Group>
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
