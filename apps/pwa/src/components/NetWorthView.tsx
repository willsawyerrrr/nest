import { Card, Group, Stack, Text, Title } from '@mantine/core'
import type { Account } from '../hooks/useAccounts'
import { formatCents } from '../lib/money'
import { netWorthBreakdown } from '../lib/super'
import { moneyColor } from '../theme'

interface NetWorthViewProps {
  accounts: Account[]
  superIds: Set<string>
}

/** A labelled group of accounts with per-account balances and a subtotal. */
function AccountGroup({
  title,
  accounts,
  subtotalCents,
  emptyLabel,
}: {
  title: string
  accounts: Account[]
  subtotalCents: number
  emptyLabel: string
}) {
  return (
    <Card component="section" aria-label={title} withBorder radius="md" p="sm">
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap">
          <Title order={4}>{title}</Title>
          <Text fw={700}>{formatCents(subtotalCents)}</Text>
        </Group>
        {accounts.length === 0 ? (
          <Text c="dimmed" size="sm">
            {emptyLabel}
          </Text>
        ) : (
          <Stack gap={4}>
            {accounts.map((account) => (
              <Group key={account.id} justify="space-between" wrap="nowrap" gap="sm">
                <Text size="sm" truncate style={{ flex: 1, minWidth: 0 }}>
                  {account.name}
                </Text>
                <Text size="sm" ta="right" style={{ flexShrink: 0 }}>
                  {formatCents(account.balance_cents)}
                </Text>
              </Group>
            ))}
          </Stack>
        )}
      </Stack>
    </Card>
  )
}

/**
 * Presentational net worth: the assets-only total across every account, split
 * into super and other accounts with per-account balances and subtotals.
 * Liabilities are not modelled yet.
 */
export function NetWorthView({ accounts, superIds }: NetWorthViewProps) {
  const breakdown = netWorthBreakdown(accounts, superIds)

  return (
    <Stack gap="sm">
      <Title order={2}>Net worth</Title>

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
      />
      <AccountGroup
        title="Other accounts"
        accounts={breakdown.otherAccounts}
        subtotalCents={breakdown.otherTotalCents}
        emptyLabel="No other accounts yet."
      />

      <Text c="dimmed" size="xs">
        Assets only — liabilities (loans, credit) aren&rsquo;t modelled yet.
      </Text>
    </Stack>
  )
}
