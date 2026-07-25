import type { ReactNode } from 'react'
import {
  ActionIcon,
  Button,
  Card,
  Group,
  Stack,
  Text,
  ThemeIcon,
  Title,
  UnstyledButton,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import {
  IconBuildingBank,
  IconChartPie,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconEye,
  IconEyeOff,
  IconPencil,
  IconReceipt2,
  IconWallet,
} from '@tabler/icons-react'
import type { NetWorthProjectionPoint } from '@nest/plan'
import type { Account } from '../hooks/useAccounts'
import type { ProjectionHorizonOption } from '../lib/retirement'
import { netWorthBreakdown, type EquityHolding, type Liability } from '../lib/super'
import { netWorthColorName } from '../lib/tokens'
import { EmptyState } from './EmptyState'
import { ListRow } from './ListRow'
import { MoneyText } from './MoneyText'
import { NetWorthProjectionChart } from './NetWorthProjectionChart'
import { PageSection } from './PageSection'

interface NetWorthViewProps {
  accounts: Account[]
  superIds: Set<string>
  equity: EquityHolding[]
  liabilities: Liability[]
  onToggleExclude: (accountId: string, exclude: boolean) => void
  /** The net worth projected forward, and the calendar year of its first point. */
  projection?: NetWorthProjectionPoint[]
  projectionBaseYear?: number
  /** The selected projection horizon and a callback to change it. */
  horizon?: ProjectionHorizonOption
  onHorizonChange?: (horizon: ProjectionHorizonOption) => void
}

/**
 * A section header's category glyph: a small tinted icon that gives each net-
 * worth section a distinct hue, so the sections read as separate categories
 * without recolouring their balances. Muted alongside an excluded group.
 */
function SectionAccent({
  color,
  icon,
  dimmed = false,
}: {
  color: string
  icon: ReactNode
  dimmed?: boolean
}) {
  return (
    <ThemeIcon
      size="sm"
      radius="sm"
      variant="light"
      color={dimmed ? netWorthColorName.excluded : color}
      style={{ flexShrink: 0 }}
    >
      {icon}
    </ThemeIcon>
  )
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
  accentColor,
  accentIcon,
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
  accentColor: string
  accentIcon: ReactNode
  collapsible?: boolean
  onToggleExclude: (accountId: string, exclude: boolean) => void
}) {
  const [opened, { toggle }] = useDisclosure(false)

  const header = (
    <Group justify="space-between" wrap="nowrap">
      <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
        {collapsible && (opened ? <IconChevronDown size={18} /> : <IconChevronRight size={18} />)}
        <SectionAccent color={accentColor} icon={accentIcon} dimmed={excluded} />
        <Title order={3} size="h5" {...(excluded && { c: 'dimmed' })}>
          {title}
        </Title>
      </Group>
      {subtotalCents !== undefined && <MoneyText cents={subtotalCents} fw={700} />}
    </Group>
  )

  const body =
    accounts.length === 0 ? (
      <EmptyState>{emptyLabel}</EmptyState>
    ) : (
      <Stack gap={0}>
        {accounts.map((account) => (
          <ListRow key={account.id} gap="sm">
            <Text fw={600} size="sm" truncate style={{ flex: 1, minWidth: 0 }}>
              {account.name}
            </Text>
            <MoneyText
              cents={account.balance_cents}
              size="sm"
              ta="right"
              style={{ flexShrink: 0 }}
            />
            {editing && togglable && (
              <ActionIcon
                variant="subtle"
                color="gray"
                style={{ flexShrink: 0 }}
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
          </ListRow>
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
          <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
            <SectionAccent color={netWorthColorName.liability} icon={<IconReceipt2 size={14} />} />
            <Title order={3} size="h5">
              Liabilities
            </Title>
          </Group>
          <MoneyText cents={-subtotalCents} colored fw={700} />
        </Group>
        <Stack gap={0}>
          {liabilities.map((liability) => (
            <ListRow key={liability.label} gap="sm">
              <Text fw={600} size="sm" truncate style={{ flex: 1, minWidth: 0 }}>
                {liability.label}
              </Text>
              <MoneyText
                cents={-liability.balanceCents}
                colored
                size="sm"
                ta="right"
                style={{ flexShrink: 0 }}
              />
            </ListRow>
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
          <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
            <SectionAccent color={netWorthColorName.equity} icon={<IconChartPie size={14} />} />
            <Title order={3} size="h5">
              Equity
            </Title>
          </Group>
          <MoneyText cents={subtotalCents} fw={700} />
        </Group>
        <Stack gap={0}>
          {holdings.map((holding) => (
            <ListRow key={holding.label} gap="sm">
              <Text fw={600} size="sm" truncate style={{ flex: 1, minWidth: 0 }}>
                {holding.label}
              </Text>
              <MoneyText
                cents={holding.valueCents}
                size="sm"
                ta="right"
                style={{ flexShrink: 0 }}
              />
            </ListRow>
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
  projection,
  projectionBaseYear,
  horizon,
  onHorizonChange,
}: NetWorthViewProps) {
  const breakdown = netWorthBreakdown(accounts, superIds, liabilities, equity)
  const [editing, { toggle: toggleEditing }] = useDisclosure(false)
  // Super always counts towards net worth, so only the other and excluded
  // groups can be edited; without any such account there is nothing to edit.
  const hasTogglable = breakdown.otherAccounts.length > 0 || breakdown.excludedAccounts.length > 0

  return (
    <PageSection title="Net worth">
      {hasTogglable && (
        <Group justify="flex-end">
          <Button
            variant={editing ? 'filled' : 'light'}
            size="xs"
            leftSection={editing ? <IconCheck size={16} /> : <IconPencil size={16} />}
            onClick={toggleEditing}
          >
            {editing ? 'Done' : 'Edit'}
          </Button>
        </Group>
      )}

      <Card component="section" aria-label="Total net worth" withBorder radius="md" p="md">
        <Stack gap={0} align="center">
          <Text size="xs" c="dimmed">
            Total net worth
          </Text>
          <MoneyText cents={breakdown.totalCents} colored fw={700} fz="xl" />
        </Stack>
      </Card>

      {projection && (
        <NetWorthProjectionChart
          points={projection}
          baseYear={projectionBaseYear ?? 0}
          horizon={horizon}
          onHorizonChange={onHorizonChange}
        />
      )}

      <AccountGroup
        title="Super"
        accounts={breakdown.superAccounts}
        subtotalCents={breakdown.superTotalCents}
        emptyLabel="No super accounts yet. Add a balance on the Super tab."
        excluded={false}
        editing={editing}
        togglable={false}
        accentColor={netWorthColorName.superannuation}
        accentIcon={<IconBuildingBank size={14} />}
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
        accentColor={netWorthColorName.cash}
        accentIcon={<IconWallet size={14} />}
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
          accentColor={netWorthColorName.excluded}
          accentIcon={<IconEyeOff size={14} />}
          onToggleExclude={onToggleExclude}
        />
      )}
    </PageSection>
  )
}
