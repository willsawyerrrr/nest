import { ActionIcon, Button, Card, Group, Stack, Text, Title, UnstyledButton } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconEye,
  IconEyeOff,
  IconPencil,
} from '@tabler/icons-react'
import type { Account } from '../hooks/useAccounts'
import { formatCents, moneyColor } from '../lib/money'
import { netWorthBreakdown, type EquityHolding, type Liability } from '../lib/super'

interface NetWorthViewProps {
  accounts: Account[]
  superIds: Set<string>
  equity: EquityHolding[]
  liabilities: Liability[]
  onToggleExclude: (accountId: string, exclude: boolean) => void
}

/**
 * A labelled group of accounts with per-account balances and, when
 * `subtotalCents` is given, a subtotal. When `togglable` and `editing` are both
 * set, each row carries a control to include or exclude the account from net
 * worth; `excluded` selects the direction (and the muted styling of the whole
 * group).
 */
function AccountGroup({
  title,
  accounts,
  subtotalCents,
  emptyLabel,
  excluded,
  editing,
  togglable,
  collapsible = false,
  onToggleExclude,
}: {
  title: string
  accounts: Account[]
  subtotalCents?: number
  emptyLabel: string
  excluded: boolean
  editing: boolean
  togglable: boolean
  collapsible?: boolean
  onToggleExclude: (accountId: string, exclude: boolean) => void
}) {
  const [opened, { toggle }] = useDisclosure(false)

  const header = (
    <Group justify="space-between" wrap="nowrap">
      <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
        {collapsible && (opened ? <IconChevronDown size={18} /> : <IconChevronRight size={18} />)}
        <Title order={3} size="h5" c={excluded ? 'dimmed' : undefined}>
          {title}
        </Title>
      </Group>
      {subtotalCents !== undefined && <Text fw={700}>{formatCents(subtotalCents)}</Text>}
    </Group>
  )

  const body =
    accounts.length === 0 ? (
      <Text c="dimmed" size="sm">
        {emptyLabel}
      </Text>
    ) : (
      <Stack gap="xs">
        {accounts.map((account) => (
          <Group key={account.id} justify="space-between" wrap="nowrap" gap="sm">
            <Text size="md" truncate style={{ flex: 1, minWidth: 0 }}>
              {account.name}
            </Text>
            <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
              <Text size="md" ta="right">
                {formatCents(account.balance_cents)}
              </Text>
              {editing && togglable && (
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  aria-label={
                    excluded
                      ? `Include ${account.name} in net worth`
                      : `Exclude ${account.name} from net worth`
                  }
                  onClick={() => onToggleExclude(account.id, !excluded)}
                >
                  {excluded ? <IconEyeOff size={18} /> : <IconEye size={18} />}
                </ActionIcon>
              )}
            </Group>
          </Group>
        ))}
      </Stack>
    )

  return (
    <Card
      component="section"
      aria-label={title}
      withBorder
      radius="md"
      p="sm"
      style={{ opacity: excluded ? 0.7 : 1 }}
    >
      <Stack gap="xs">
        {collapsible ? (
          <>
            <UnstyledButton onClick={toggle} aria-expanded={opened} w="100%">
              {header}
            </UnstyledButton>
            {opened && body}
          </>
        ) : (
          <>
            {header}
            {body}
          </>
        )}
      </Stack>
    </Card>
  )
}

/**
 * A group of liabilities, each shown as a negative (red) figure, with a negative
 * subtotal. Rendered only when the household has at least one liability.
 */
function LiabilityGroup({
  liabilities,
  subtotalCents,
}: {
  liabilities: Liability[]
  subtotalCents: number
}) {
  return (
    <Card component="section" aria-label="Liabilities" withBorder radius="md" p="sm">
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap">
          <Title order={3} size="h5">
            Liabilities
          </Title>
          <Text fw={700} c={moneyColor(-subtotalCents)}>
            {formatCents(-subtotalCents)}
          </Text>
        </Group>
        <Stack gap="xs">
          {liabilities.map((liability) => (
            <Group key={liability.label} justify="space-between" wrap="nowrap" gap="sm">
              <Text size="md" truncate style={{ flex: 1, minWidth: 0 }}>
                {liability.label}
              </Text>
              <Text size="md" ta="right" c={moneyColor(-liability.balanceCents)}>
                {formatCents(-liability.balanceCents)}
              </Text>
            </Group>
          ))}
        </Stack>
      </Stack>
    </Card>
  )
}

/**
 * A group of equity holdings, each shown as its vested value, with a subtotal
 * and a dimmed caption clarifying the figure is the net "if exercised today"
 * value (gross vested value less the strike/exercise cost). Rendered only when
 * the household holds at least one grant with vested value.
 */
function EquityGroup({
  holdings,
  subtotalCents,
}: {
  holdings: EquityHolding[]
  subtotalCents: number
}) {
  return (
    <Card component="section" aria-label="Equity" withBorder radius="md" p="sm">
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap">
          <Title order={3} size="h5">
            Equity
          </Title>
          <Text fw={700}>{formatCents(subtotalCents)}</Text>
        </Group>
        <Stack gap="xs">
          {holdings.map((holding) => (
            <Group key={holding.label} justify="space-between" wrap="nowrap" gap="sm">
              <Text size="md" truncate style={{ flex: 1, minWidth: 0 }}>
                {holding.label}
              </Text>
              <Text size="md" ta="right">
                {formatCents(holding.valueCents)}
              </Text>
            </Group>
          ))}
        </Stack>
        <Text size="xs" c="dimmed">
          If exercised today, net of the strike price. See the Equity tab for the gross vested
          value.
        </Text>
      </Stack>
    </Card>
  )
}

/**
 * Presentational net worth: assets less liabilities across every included
 * account, split into super and other accounts with per-account balances and
 * subtotals, plus each grant's vested equity value as an asset, then each
 * member's HELP debt as a liability subtracted from the total. Accounts the
 * household has excluded from tracking are listed in a muted group at the bottom,
 * off the total, each toggleable back in.
 */
export function NetWorthView({
  accounts,
  superIds,
  equity,
  liabilities,
  onToggleExclude,
}: NetWorthViewProps) {
  const breakdown = netWorthBreakdown(accounts, superIds, liabilities, equity)
  const [editing, { toggle: toggleEditing }] = useDisclosure(false)
  // Super always counts towards net worth, so only the other and excluded
  // groups can be edited; without any such account there is nothing to edit.
  const hasTogglable = breakdown.otherAccounts.length > 0 || breakdown.excludedAccounts.length > 0

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center" wrap="nowrap">
        <Title order={2} visibleFrom="sm">
          Net worth
        </Title>
        {hasTogglable && (
          <Button
            variant={editing ? 'filled' : 'light'}
            size="xs"
            leftSection={editing ? <IconCheck size={16} /> : <IconPencil size={16} />}
            onClick={toggleEditing}
          >
            {editing ? 'Done' : 'Edit'}
          </Button>
        )}
      </Group>

      <Card component="section" aria-label="Total net worth" withBorder radius="md" p="md">
        <Stack gap={0} align="center">
          <Text size="xs" c="dimmed">
            Total net worth
          </Text>
          <Text fw={700} fz="xl" c={moneyColor(breakdown.totalCents)}>
            {formatCents(breakdown.totalCents)}
          </Text>
        </Stack>
      </Card>

      <AccountGroup
        title="Super"
        accounts={breakdown.superAccounts}
        subtotalCents={breakdown.superTotalCents}
        emptyLabel="No super accounts yet. Add a balance on the Super tab."
        excluded={false}
        editing={editing}
        togglable={false}
        onToggleExclude={onToggleExclude}
      />
      <AccountGroup
        title="Other accounts"
        accounts={breakdown.otherAccounts}
        subtotalCents={breakdown.otherTotalCents}
        emptyLabel="No other accounts yet."
        excluded={false}
        editing={editing}
        togglable
        onToggleExclude={onToggleExclude}
      />
      {breakdown.equityHoldings.length > 0 && (
        <EquityGroup
          holdings={breakdown.equityHoldings}
          subtotalCents={breakdown.equityTotalCents}
        />
      )}
      {breakdown.liabilities.length > 0 && (
        <LiabilityGroup
          liabilities={breakdown.liabilities}
          subtotalCents={breakdown.liabilitiesTotalCents}
        />
      )}
      {breakdown.excludedAccounts.length > 0 && (
        <AccountGroup
          title="Excluded from net worth"
          accounts={breakdown.excludedAccounts}
          emptyLabel=""
          excluded
          editing={editing}
          togglable
          collapsible
          onToggleExclude={onToggleExclude}
        />
      )}
    </Stack>
  )
}
