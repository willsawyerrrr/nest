import { Badge, Group, Stack, Text, Title } from '@mantine/core'
import type { Account } from '../hooks/useAccounts'
import { useIsWide } from '../hooks/useIsWide'
import type { Member } from '../hooks/useMembers'
import { accountLabel } from '../lib/accountName'
import { accountOwnerLabel, groupAccountsByType, ledgerSourceLabel } from '../lib/accounts'
import { AccountIcon } from './AccountIcon'
import { AppCard } from './AppCard'
import { DeletedInUpBadge } from './DeletedInUpBadge'
import { EmptyState } from './EmptyState'
import { ListRow } from './ListRow'
import { MoneyText } from './MoneyText'
import { PageSection } from './PageSection'

interface AccountsScreenProps {
  accounts: Account[]
  members: Member[]
}

/** A balance, tinted red only when negative (an amount owed), otherwise neutral. */
function Balance({ cents, fw }: { cents: number; fw?: number }) {
  return (
    <MoneyText
      cents={cents}
      colored={cents < 0}
      size="sm"
      ta="right"
      {...(fw !== undefined && { fw })}
      style={{ flexShrink: 0 }}
    />
  )
}

/** The account's icon and emoji-stripped name, with its status badges. */
function AccountName({ account }: { account: Account }) {
  return (
    <Group gap={6} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
      <AccountIcon name={account.name} size={16} />
      <Text fw={600} size="sm" truncate>
        {accountLabel(account.name)}
      </Text>
      {account.deleted_from_source_at && <DeletedInUpBadge />}
      {account.exclude_from_net_worth && (
        <Badge size="xs" variant="light" color="gray" style={{ flexShrink: 0 }}>
          Not in net worth
        </Badge>
      )}
    </Group>
  )
}

/** One account as a dense desktop row: name, then owner, source and balance in fixed columns. */
function AccountRow({ account, owner }: { account: Account; owner: string }) {
  return (
    <ListRow data-testid="account-row" gap="sm">
      <AccountName account={account} />
      <Text size="xs" c="dimmed" truncate style={{ width: '9rem', flexShrink: 0 }}>
        {owner}
      </Text>
      <Text size="xs" c="dimmed" style={{ width: '4rem', flexShrink: 0 }}>
        {ledgerSourceLabel(account.source)}
      </Text>
      <Group justify="flex-end" style={{ width: '8rem', flexShrink: 0 }}>
        <Balance cents={account.balance_cents} />
      </Group>
    </ListRow>
  )
}

/** One account as a compact mobile card: name over owner and source, balance beside. */
function AccountCard({ account, owner }: { account: Account; owner: string }) {
  return (
    <AppCard data-testid="account-card" withBorder padding="xs">
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <AccountName account={account} />
          <Text size="xs" c="dimmed" truncate>
            {owner} · {ledgerSourceLabel(account.source)}
          </Text>
        </Stack>
        <Balance cents={account.balance_cents} />
      </Group>
    </AppCard>
  )
}

/**
 * Every account the signed-in member can see, grouped by type with each group's
 * total. Each account shows its owner (a member, or Joint), where its data comes
 * from and its balance, rendered as dense rows from the wide breakpoint up and as
 * compact cards below it. Read-only: net-worth inclusion is set on Net worth.
 */
export function AccountsScreen({ accounts, members }: AccountsScreenProps) {
  const wide = useIsWide()
  const groups = groupAccountsByType(accounts)

  return (
    <PageSection
      title="Accounts"
      intro="Every account you can see, with its owner and balance. Choose which count toward net worth on the Net worth tab."
    >
      {groups.length === 0 ? (
        <EmptyState>No accounts yet. Connect a bank on the Connections tab.</EmptyState>
      ) : (
        groups.map((group) => (
          <Stack key={group.type} component="section" aria-label={group.label} gap="xs">
            <Group justify="space-between" wrap="nowrap">
              <Title order={2} size="h5">
                {group.label}
              </Title>
              <Balance cents={group.totalCents} fw={700} />
            </Group>
            <Stack gap={wide ? 0 : 'xs'}>
              {group.accounts.map((account) => {
                const owner = accountOwnerLabel(account, members)
                return wide ? (
                  <AccountRow key={account.id} account={account} owner={owner} />
                ) : (
                  <AccountCard key={account.id} account={account} owner={owner} />
                )
              })}
            </Stack>
          </Stack>
        ))
      )}
    </PageSection>
  )
}
