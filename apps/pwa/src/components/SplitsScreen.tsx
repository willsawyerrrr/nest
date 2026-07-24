import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
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
import { AppCard } from './AppCard'
import { FortnightlyAmount } from './FortnightlyAmount'
import { ListRow } from './ListRow'
import { PageSection } from './PageSection'

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

/** An account's identity column: its icon and displayed (emoji-stripped) name, growing to fill. */
function AccountName({ name }: { name: string }) {
  return (
    <Group gap={6} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
      <AccountIcon name={name} size={16} />
      <Text fw={600} size="sm" truncate>
        {accountLabel(name)}
      </Text>
    </Group>
  )
}

/** The exact (pre-rounding) fortnightly figure, shown only when rounding changed it. */
function ExactNote({ exactCents, roundedCents }: { exactCents: number; roundedCents: number }) {
  if (roundedCents === exactCents) {
    return null
  }
  return (
    <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
      {formatCents(exactCents)} exact
    </Text>
  )
}

/** One routed account that stays put as a dense table-like row for desktop. */
function StaysRow({
  account,
  fortnightlyCents,
}: {
  account: AccountDirectoryEntry
  fortnightlyCents: number
}) {
  const rounded = roundCentsUpToStep(fortnightlyCents, ROUND_STEP_CENTS)
  return (
    <ListRow gap="sm">
      <AccountName name={account.name} />
      <ExactNote exactCents={fortnightlyCents} roundedCents={rounded} />
      <FortnightlyAmount
        cents={rounded}
        justify="flex-end"
        style={{ width: '7rem', flexShrink: 0 }}
      />
    </ListRow>
  )
}

/** One routed account that stays put as a compact bordered card for mobile. */
function StaysCard({
  account,
  fortnightlyCents,
}: {
  account: AccountDirectoryEntry
  fortnightlyCents: number
}) {
  const rounded = roundCentsUpToStep(fortnightlyCents, ROUND_STEP_CENTS)
  return (
    <AppCard withBorder padding="sm">
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <AccountName name={account.name} />
        <Group gap={8} wrap="nowrap" align="baseline" style={{ flexShrink: 0 }}>
          <ExactNote exactCents={fortnightlyCents} roundedCents={rounded} />
          <FortnightlyAmount cents={rounded} />
        </Group>
      </Group>
    </AppCard>
  )
}

/**
 * One routed account that stays put, rendered as a dense table-like row from the
 * `sm` breakpoint up and as a compact bordered card below it.
 */
function StaysItem(props: { account: AccountDirectoryEntry; fortnightlyCents: number }) {
  const wide = useMediaQuery('(min-width: 48em)')
  return wide ? <StaysRow {...props} /> : <StaysCard {...props} />
}

interface RecommendedSplitProps {
  account: AccountDirectoryEntry
  fortnightlyCents: number
  configuredCents: number | null
  onConfirm: (accountId: string, fortnightlyCents: number) => void | Promise<void>
}

/** A recommended row's drift line: the change from the configured amount and a Confirm control. */
function DriftNote({
  account,
  configuredCents,
  roundedCents,
  onConfirm,
}: {
  account: AccountDirectoryEntry
  configuredCents: number | null
  roundedCents: number
  onConfirm: (accountId: string, fortnightlyCents: number) => void | Promise<void>
}) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="sm">
      <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
        <Badge size="xs" variant="light" color="yellow" style={{ flexShrink: 0 }}>
          Update
        </Badge>
        <Text size="xs" c="dimmed" style={{ minWidth: 0 }}>
          {configuredCents === null
            ? 'Not set in Up yet'
            : `was ${formatCents(configuredCents)} → ${formatPerFortnight(roundedCents)}`}
        </Text>
      </Group>
      <Button size="compact-xs" variant="light" onClick={() => onConfirm(account.id, roundedCents)}>
        {configuredCents === null ? 'Mark as set' : 'Confirm'}
      </Button>
    </Group>
  )
}

/** A recommended account's split as a dense table-like row for desktop, drift note on the caption line. */
function RecommendedSplitRow({
  account,
  fortnightlyCents,
  configuredCents,
  onConfirm,
}: RecommendedSplitProps) {
  const rounded = roundCentsUpToStep(fortnightlyCents, ROUND_STEP_CENTS)
  const needsUpdate = paySplitNeedsUpdate(rounded, configuredCents)
  const row = (
    <ListRow
      gap="sm"
      caption={
        needsUpdate ? (
          <DriftNote
            account={account}
            configuredCents={configuredCents}
            roundedCents={rounded}
            onConfirm={onConfirm}
          />
        ) : undefined
      }
    >
      <AccountName name={account.name} />
      <ExactNote exactCents={fortnightlyCents} roundedCents={rounded} />
      <FortnightlyAmount
        cents={rounded}
        justify="flex-end"
        style={{ width: '7rem', flexShrink: 0 }}
      />
    </ListRow>
  )
  return needsUpdate ? (
    <Box pl="xs" style={{ borderLeft: '3px solid var(--mantine-color-yellow-6)' }}>
      {row}
    </Box>
  ) : (
    row
  )
}

/**
 * A recommended account's split as a compact bordered card for mobile, flagged
 * with a left stripe and a Confirm control when it drifts from the configured amount.
 */
function RecommendedSplitCard({
  account,
  fortnightlyCents,
  configuredCents,
  onConfirm,
}: RecommendedSplitProps) {
  const rounded = roundCentsUpToStep(fortnightlyCents, ROUND_STEP_CENTS)
  const needsUpdate = paySplitNeedsUpdate(rounded, configuredCents)
  return (
    <AppCard
      withBorder
      padding="sm"
      style={needsUpdate ? { borderLeft: '3px solid var(--mantine-color-yellow-6)' } : undefined}
    >
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <AccountName name={account.name} />
        <Group gap={8} wrap="nowrap" align="baseline" style={{ flexShrink: 0 }}>
          <ExactNote exactCents={fortnightlyCents} roundedCents={rounded} />
          <FortnightlyAmount cents={rounded} />
        </Group>
      </Group>
      {needsUpdate && (
        <Box mt={6}>
          <DriftNote
            account={account}
            configuredCents={configuredCents}
            roundedCents={rounded}
            onConfirm={onConfirm}
          />
        </Box>
      )}
    </AppCard>
  )
}

/**
 * A routed account's recommended fortnightly split with drift against what is
 * currently configured. When the rounded recommendation differs from the
 * configured amount (or it has never been confirmed), the row is flagged, shows
 * the change, and offers a Confirm to record the new amount; otherwise it renders
 * plainly, with no status indicator. Rendered as a dense table-like row from the
 * `sm` breakpoint up and as a compact bordered card below it. The configured
 * amount is source-agnostic — see `SplitsScreenProps`.
 */
function RecommendedSplitItem(props: RecommendedSplitProps) {
  const wide = useMediaQuery('(min-width: 48em)')
  return wide ? <RecommendedSplitRow {...props} /> : <RecommendedSplitCard {...props} />
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
    <PageSection
      title="Pay splits"
      intro="Up can’t read or set pay splits, so these are recommendations: set each account’s pay split in Up to match. Amounts are the fortnightly total of the budget items routed to each account, rounded up to the nearest $5."
    >
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
          Route budget items to an account — set “Funded from” on an item, or link a Savings goal to
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

      {staysRows.length > 0 && (
        <Paper p="sm" radius="md" bg="var(--mantine-primary-color-light)">
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
              <StaysItem
                key={row.account.id}
                account={row.account}
                fortnightlyCents={row.fortnightlyCents}
              />
            ))}
          </Stack>
        </Paper>
      )}

      {recommendedRows.length > 0 && (
        <Stack gap="xs">
          <Group gap="xs" align="center">
            <Title order={3} size="h5">
              Recommended pay splits
            </Title>
            {rowsToUpdate > 0 && (
              <Badge size="xs" variant="light" color="yellow">
                {rowsToUpdate} to update
              </Badge>
            )}
          </Group>
          {recommendedRows.map((row) => (
            <RecommendedSplitItem
              key={row.account.id}
              account={row.account}
              fortnightlyCents={row.fortnightlyCents}
              configuredCents={configuredByAccount.get(row.account.id) ?? null}
              onConfirm={onConfirm}
            />
          ))}
        </Stack>
      )}

      {unassignedFortnightlyCents > 0 && (
        <Alert color="yellow" variant="light" title="Unassigned">
          {formatPerFortnight(unassignedFortnightlyCents)} comes from budget items not yet routed to
          an account. Set a “Funded from” account on those items, or link their Savings goal to an
          Up saver, to fold them into a split.
        </Alert>
      )}
    </PageSection>
  )
}
