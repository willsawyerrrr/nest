import { ActionIcon, Card, Group, Stack, Text, Title } from '@mantine/core'
import { IconEye, IconEyeOff } from '@tabler/icons-react'
import type { Account } from '../hooks/useAccounts'
import { formatCents, moneyColor } from '../lib/money'
import { netWorthBreakdown } from '../lib/super'

interface NetWorthViewProps {
  accounts: Account[]
  superIds: Set<string>
  onToggleExclude: (accountId: string, exclude: boolean) => void
}

/**
 * A labelled group of accounts with per-account balances and a subtotal. Each
 * row carries a toggle to include or exclude the account from net worth;
 * `excluded` selects the direction (and the muted styling of the whole group).
 */
function AccountGroup({
  title,
  accounts,
  subtotalCents,
  emptyLabel,
  excluded,
  onToggleExclude,
}: {
  title: string
  accounts: Account[]
  subtotalCents: number
  emptyLabel: string
  excluded: boolean
  onToggleExclude: (accountId: string, exclude: boolean) => void
}) {
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
        <Group justify="space-between" wrap="nowrap">
          <Title order={3} size="h5" c={excluded ? 'dimmed' : undefined}>
            {title}
          </Title>
          <Text fw={700}>{formatCents(subtotalCents)}</Text>
        </Group>
        {accounts.length === 0 ? (
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
                </Group>
              </Group>
            ))}
          </Stack>
        )}
      </Stack>
    </Card>
  )
}

/**
 * Presentational net worth: the assets-only total across every included
 * account, split into super and other accounts with per-account balances and
 * subtotals. Accounts the household has excluded from tracking are listed in a
 * muted group at the bottom, off the total, each toggleable back in.
 * Liabilities are not modelled yet.
 */
export function NetWorthView({ accounts, superIds, onToggleExclude }: NetWorthViewProps) {
  const breakdown = netWorthBreakdown(accounts, superIds)

  return (
    <Stack gap="sm">
      <Title order={2} visibleFrom="sm">
        Net worth
      </Title>

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
        onToggleExclude={onToggleExclude}
      />
      <AccountGroup
        title="Other accounts"
        accounts={breakdown.otherAccounts}
        subtotalCents={breakdown.otherTotalCents}
        emptyLabel="No other accounts yet."
        excluded={false}
        onToggleExclude={onToggleExclude}
      />
      {breakdown.excludedAccounts.length > 0 && (
        <AccountGroup
          title="Excluded from net worth"
          accounts={breakdown.excludedAccounts}
          subtotalCents={breakdown.excludedAccounts.reduce(
            (total, account) => total + account.balance_cents,
            0,
          )}
          emptyLabel=""
          excluded
          onToggleExclude={onToggleExclude}
        />
      )}

      <Text c="dimmed" size="xs">
        Assets only — liabilities (loans, credit) aren&rsquo;t modelled yet.
      </Text>
    </Stack>
  )
}
