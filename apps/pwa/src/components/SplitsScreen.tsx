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
import {
  assignmentsByAccount,
  isRecommendedSplitAccount,
  paySplitNeedsUpdate,
  roundCentsUpToStep,
} from '@nest/plan'
import type { AccountDirectoryEntry } from '../hooks/useAccountDirectory'
import type { BudgetLine } from '../hooks/useBudgetLines'
import type { Goal } from '../hooks/useGoals'
import { useSortPreference } from '../hooks/useSortPreference'
import { accountLabel } from '../lib/accountName'
import { formatCents, formatPerFortnight } from '../lib/money'
import { sortBy, type SortPreference } from '../lib/sort'
import { AccountIcon } from './AccountIcon'
import { FortnightlyAmount } from './FortnightlyAmount'

/** Pay splits are typed into Up in round figures; cents-exact amounts add no value. */
const ROUND_STEP_CENTS = 5_00

/** One routed account: the account and its recommended fortnightly split. */
interface SplitRowData {
  account: AccountDirectoryEntry
  fortnightlyCents: number
}

/** Which field the split rows are ordered by. */
type SortKey = 'title' | 'amount'

const SORT_STORAGE_KEY = 'splits-sort'
const DEFAULT_SORT: SortPreference<SortKey> = { key: 'title', direction: 'asc' }

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'title', label: 'Title' },
  { value: 'amount', label: 'Amount' },
]

/**
 * Compares two rows by the chosen key for ascending order. `title` compares the
 * displayed account labels (the leading emoji stripped, as shown); `amount`
 * compares the fortnightly split.
 */
function compareRows(key: SortKey): (a: SplitRowData, b: SplitRowData) => number {
  return (a, b) =>
    key === 'title'
      ? accountLabel(a.account.name).localeCompare(accountLabel(b.account.name))
      : a.fortnightlyCents - b.fortnightlyCents
}

interface SplitsScreenProps {
  accounts: AccountDirectoryEntry[]
  lines: BudgetLine[]
  goals: Goal[]
  /**
   * The split currently configured for each account, keyed by account id — a
   * source-agnostic concept. Today it arrives from the household's app-side
   * confirmation; if the bank's API ever exposes the real configured split, this
   * map is fed from there instead, with no change to the comparison here.
   */
  configuredByAccount: Map<string, number>
  /**
   * The spending account the household's pay lands in — the split source — or null
   * when none is designated. When set, pay stays here and every other routed
   * account becomes a recommended split; until then, only savers are recommended.
   */
  payAccountId: string | null
  /** Designates (or, with null, clears) the household's pay account. */
  onSetPayAccount: (accountId: string | null) => void | Promise<void>
  /** Records the amount the household has confirmed as set in Up for an account. */
  onConfirm: (accountId: string, fortnightlyCents: number) => void | Promise<void>
}

/** Whether an account is a synced Up saver (as opposed to a spending transaction account). */
function isSaver(account: AccountDirectoryEntry): boolean {
  return account.source === 'up' && account.type === 'savings'
}

/** Whether an account is a spending account (a transaction account, pay-account-eligible). */
function isSpending(account: AccountDirectoryEntry): boolean {
  return account.type === 'transaction'
}

/** One routed account that stays put: its name and the fortnightly amount that stays. */
function StaysRow({
  account,
  fortnightlyCents,
}: {
  account: AccountDirectoryEntry
  fortnightlyCents: number
}) {
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
        <Group gap={8} wrap="nowrap" align="baseline" style={{ flexShrink: 0 }}>
          {rounded !== fortnightlyCents && (
            <Text size="xs" c="dimmed">
              {formatCents(fortnightlyCents)} exact
            </Text>
          )}
          <FortnightlyAmount cents={rounded} />
        </Group>
      </Group>
    </Card>
  )
}

/**
 * A routed account's recommended fortnightly split with drift against what is
 * currently configured. When the rounded recommendation differs from the
 * configured amount (or it has never been confirmed), the row is flagged, shows
 * the change, and offers a Confirm to record the new amount; otherwise it renders
 * plainly, with no status indicator. The configured amount is source-agnostic —
 * see `SplitsScreenProps`.
 */
function RecommendedSplitRow({
  account,
  fortnightlyCents,
  configuredCents,
  onConfirm,
}: {
  account: AccountDirectoryEntry
  fortnightlyCents: number
  configuredCents: number | null
  onConfirm: (accountId: string, fortnightlyCents: number) => void | Promise<void>
}) {
  const rounded = roundCentsUpToStep(fortnightlyCents, ROUND_STEP_CENTS)
  const needsUpdate = paySplitNeedsUpdate(rounded, configuredCents)
  return (
    <Card
      withBorder
      radius="md"
      p="sm"
      style={needsUpdate ? { borderLeft: '3px solid var(--mantine-color-yellow-6)' } : undefined}
    >
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
          <AccountIcon name={account.name} size={16} />
          <Text fw={600} size="sm" truncate>
            {accountLabel(account.name)}
          </Text>
          {needsUpdate && (
            <Badge size="xs" variant="light" color="yellow">
              Update
            </Badge>
          )}
        </Group>
        <Group gap={8} wrap="nowrap" align="baseline" style={{ flexShrink: 0 }}>
          {rounded !== fortnightlyCents && (
            <Text size="xs" c="dimmed">
              {formatCents(fortnightlyCents)} exact
            </Text>
          )}
          <FortnightlyAmount cents={rounded} />
        </Group>
      </Group>
      {needsUpdate && (
        <Group justify="space-between" wrap="nowrap" gap="sm" mt={6}>
          <Text size="xs" c="dimmed">
            {configuredCents === null
              ? 'Not set in Up yet'
              : `was ${formatCents(configuredCents)} → ${formatPerFortnight(rounded)}`}
          </Text>
          <Button size="compact-xs" variant="light" onClick={() => onConfirm(account.id, rounded)}>
            {configuredCents === null ? 'Mark as set' : 'Confirm'}
          </Button>
        </Group>
      )}
    </Card>
  )
}

/**
 * Recommended fortnightly pay splits, one per account funded by budget lines. The
 * plan computes what each account's split should be, and the household mirrors it
 * into Up by hand. The household designates the spending account its pay lands in;
 * pay stays there while every other routed account — the other spending accounts
 * and the savers — is a recommended split. Until a pay account is chosen, only
 * savers are recommended and spending accounts are shown as staying put. Each
 * recommended row compares its recommendation against the split currently
 * configured for that account (`configuredByAccount`) and, when they differ, flags
 * the drift and offers a Confirm to record the new amount. Savings/Investments
 * lines route via their goal's linked saver; every other line routes via its own
 * funding account. Presentational — persistence lives in the caller.
 */
export function SplitsScreen({
  accounts,
  lines,
  goals,
  configuredByAccount,
  payAccountId,
  onSetPayAccount,
  onConfirm,
}: SplitsScreenProps) {
  const { byAccount, unassignedFortnightlyCents } = assignmentsByAccount(
    lines.map((line) => ({
      group: line.line_group,
      amountCents: line.amount_cents,
      frequency: line.frequency,
      interval: line.interval_count ?? undefined,
      goalId: line.goal_id,
      destinationAccountId: line.destination_account_id,
    })),
    goals.map((goal) => ({ id: goal.id, linkedAccountId: goal.linked_account_id })),
  )

  const {
    key: sortKey,
    direction: sortDirection,
    setKey,
    toggleDirection,
  } = useSortPreference(SORT_STORAGE_KEY, DEFAULT_SORT)

  const hasPayAccount = payAccountId !== null
  const spendingAccounts = accounts.filter(isSpending)

  const accountById = new Map(accounts.map((account) => [account.id, account]))
  const rows = Object.entries(byAccount)
    .map(([id, fortnightlyCents]) => ({ account: accountById.get(id), fortnightlyCents }))
    .filter((row): row is SplitRowData => row.account !== undefined)

  const isRecommended = (row: SplitRowData) =>
    isRecommendedSplitAccount(
      { isPayAccount: row.account.id === payAccountId, isSaver: isSaver(row.account) },
      hasPayAccount,
    )

  const comparator = compareRows(sortKey)
  const recommendedRows = sortBy(rows.filter(isRecommended), comparator, sortDirection)
  const staysRows = sortBy(
    rows.filter((row) => !isRecommended(row)),
    comparator,
    sortDirection,
  )
  const nothingRouted = rows.length === 0 && unassignedFortnightlyCents === 0

  const rowsToUpdate = recommendedRows.filter((row) =>
    paySplitNeedsUpdate(
      roundCentsUpToStep(row.fortnightlyCents, ROUND_STEP_CENTS),
      configuredByAccount.get(row.account.id) ?? null,
    ),
  ).length

  return (
    <Stack gap="md">
      <Title order={2} visibleFrom="sm">
        Pay splits
      </Title>

      <Text size="sm" c="dimmed">
        Up can’t read or set pay splits, so these are recommendations: set each account’s pay split
        in Up to match. Amounts are the fortnightly total of the budget lines routed to each
        account, rounded up to the nearest $5.
      </Text>

      {spendingAccounts.length > 0 && (
        <Select
          label="Paid into"
          description="The spending account your pay lands in. Every other spending account and saver is then a recommended split."
          placeholder="Choose a spending account"
          data={spendingAccounts.map((account) => ({
            value: account.id,
            label: accountLabel(account.name),
          }))}
          value={payAccountId}
          onChange={(value) => void onSetPayAccount(value)}
          clearable
        />
      )}

      {!hasPayAccount && spendingAccounts.length > 0 && (
        <Alert color="blue" variant="light" title="Choose the account you’re paid into">
          Pick the spending account your pay lands in above. Once set, your other spending accounts
          join the recommended pay splits alongside your savers.
        </Alert>
      )}

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
            onChange={(value) => value && setKey(value as SortKey)}
            allowDeselect={false}
          />
          <ActionIcon
            variant="default"
            size="lg"
            aria-label="Toggle sort direction"
            onClick={toggleDirection}
          >
            {sortDirection === 'asc' ? '↑' : '↓'}
          </ActionIcon>
        </Group>
      )}

      {recommendedRows.length > 0 && (
        <Stack gap="xs">
          <Group gap="xs" align="center">
            <Title order={3} size="h5">
              Recommended pay splits
            </Title>
            {rowsToUpdate > 0 && (
              <Badge size="sm" variant="light" color="yellow">
                {rowsToUpdate} to update
              </Badge>
            )}
          </Group>
          {recommendedRows.map((row) => (
            <RecommendedSplitRow
              key={row.account.id}
              account={row.account}
              fortnightlyCents={row.fortnightlyCents}
              configuredCents={configuredByAccount.get(row.account.id) ?? null}
              onConfirm={onConfirm}
            />
          ))}
        </Stack>
      )}

      {staysRows.length > 0 && (
        <Stack gap="xs">
          <Title order={3} size="h5">
            {hasPayAccount ? 'Stays in your pay account' : 'Stays in your spending account'}
          </Title>
          {hasPayAccount && (
            <Text size="xs" c="dimmed">
              Pay lands here — no transfer needed.
            </Text>
          )}
          {staysRows.map((row) => (
            <StaysRow
              key={row.account.id}
              account={row.account}
              fortnightlyCents={row.fortnightlyCents}
            />
          ))}
        </Stack>
      )}

      {unassignedFortnightlyCents > 0 && (
        <Alert color="yellow" variant="light" title="Unassigned">
          {formatPerFortnight(unassignedFortnightlyCents)} comes from budget lines not yet routed to
          an account. Set a “Funded from” account on those lines, or link their Savings goal to an
          Up saver, to fold them into a split.
        </Alert>
      )}
    </Stack>
  )
}
