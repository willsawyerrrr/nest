import { Badge, Group, Stack, Text } from '@mantine/core'
import type { Member } from '../hooks/useMembers'
import type { TradeInput, TradeRow } from '../hooks/useTrades'
import { formatIsoDate } from '../lib/dates'
import { formatCents } from '../lib/money'
import { memberPortfolio, type HoldingView } from '../lib/trades'
import { AppCard } from './AppCard'
import { EditableList } from './EditableList'
import { EditDeleteActions } from './EditDeleteActions'
import { MoneyText } from './MoneyText'
import { PageSection } from './PageSection'
import { TradeForm } from './TradeForm'

interface TradesScreenProps {
  members: Member[]
  /** Every household trade, oldest first; sales are matched against earlier purchases. */
  trades: TradeRow[]
  onCreate: (input: TradeInput) => Promise<void>
  onUpdate: (id: string, input: TradeInput) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

/** A units figure without trailing zeros, grouped by thousands. */
function formatUnits(units: number): string {
  return units.toLocaleString('en-AU', { maximumFractionDigits: 6 })
}

/** One current holding: its units and average cost, with cost base and market value. */
function HoldingCard({ holding }: { holding: HoldingView }) {
  return (
    <AppCard withBorder padding="xs">
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Text fw={600} size="sm" truncate>
            {holding.ticker}
          </Text>
          <Text size="xs" c="dimmed">
            {formatUnits(holding.units)} units &middot; Average cost{' '}
            {formatCents(holding.averageCostCents)} &middot; Cost base{' '}
            {formatCents(holding.costBaseCents)}
          </Text>
        </Stack>
        <Stack gap={0} align="flex-end" style={{ flexShrink: 0 }}>
          <MoneyText cents={holding.valueCents} fw={700} size="sm" />
          <Text size="xs" c="dimmed">
            at {formatCents(holding.lastPriceCents)}
          </Text>
        </Stack>
      </Group>
    </AppCard>
  )
}

/** One recorded trade: side, units and price, fee, date, with edit and delete controls. */
function TradeCard({
  trade,
  onEdit,
  onDelete,
}: {
  trade: TradeRow
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <AppCard withBorder padding="xs">
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Group gap={6} wrap="nowrap">
            <Badge size="xs" variant="light" color={trade.side === 'buy' ? 'cyan' : 'orange'}>
              {trade.side === 'buy' ? 'Buy' : 'Sell'}
            </Badge>
            <Text fw={600} size="sm" truncate>
              {trade.ticker}
            </Text>
          </Group>
          <Text size="xs" c="dimmed">
            {formatUnits(Number(trade.units))} @ {formatCents(trade.price_per_unit_cents)}
            {trade.fee_cents > 0 && <> &middot; Fee {formatCents(trade.fee_cents)}</>} &middot;{' '}
            {formatIsoDate(trade.traded_on)}
          </Text>
        </Stack>
        <Group gap="xxs" wrap="nowrap" style={{ flexShrink: 0 }}>
          <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
        </Group>
      </Group>
    </AppCard>
  )
}

/** A member's holdings, realised gains per financial year, and their trade list. */
function MemberTrades({
  member,
  trades,
  onCreate,
  onUpdate,
  onDelete,
}: {
  member: Member
  trades: TradeRow[]
  onCreate: (input: TradeInput) => Promise<void>
  onUpdate: (id: string, input: TradeInput) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const { holdings, gainsByYear, unmatchedSales } = memberPortfolio(trades, member.id)
  const memberTrades = trades
    .filter((trade) => trade.member_id === member.id)
    .toSorted((a, b) => b.traded_on.localeCompare(a.traded_on))

  return (
    <Stack gap="xs">
      <Text fw={600}>{member.name}</Text>

      {holdings.length > 0 && (
        <Stack gap="xs" aria-label={`${member.name}'s holdings`}>
          <Text size="xs" c="dimmed" tt="uppercase" style={{ letterSpacing: '0.04em' }}>
            Holdings
          </Text>
          {holdings.map((holding) => (
            <HoldingCard key={holding.ticker} holding={holding} />
          ))}
        </Stack>
      )}

      {gainsByYear.length > 0 && (
        <Stack gap="xs" aria-label={`${member.name}'s realised gains`}>
          <Text size="xs" c="dimmed" tt="uppercase" style={{ letterSpacing: '0.04em' }}>
            Realised gains
          </Text>
          {gainsByYear.map((summary) => (
            <AppCard key={summary.financialYear} withBorder padding="xs">
              <Group justify="space-between" wrap="nowrap" gap="sm">
                <Stack gap={2} style={{ minWidth: 0 }}>
                  <Text fw={600} size="sm">
                    FY{summary.financialYear}
                  </Text>
                  <Text size="xs" c="dimmed">
                    Gains {formatCents(summary.gainsCents + summary.discountableGainsCents)}{' '}
                    &middot; Losses{' '}
                    {formatCents(summary.lossesCents + summary.carriedInLossesCents)}
                    {summary.discountCents > 0 && (
                      <> &middot; CGT discount {formatCents(summary.discountCents)}</>
                    )}
                  </Text>
                </Stack>
                <Stack gap={0} align="flex-end" style={{ flexShrink: 0 }}>
                  <MoneyText cents={summary.netCapitalGainCents} fw={700} size="sm" />
                  <Text size="xs" c="dimmed">
                    net capital gain
                  </Text>
                </Stack>
              </Group>
            </AppCard>
          ))}
        </Stack>
      )}

      {unmatchedSales.map((sale) => (
        <Text key={`${sale.ticker}-${sale.soldOn}`} size="xs" c="red">
          {formatUnits(sale.units)} {sale.ticker} sold on {formatIsoDate(sale.soldOn)} exceed the
          units bought, so they are left out of the gains. Check the trades below.
        </Text>
      ))}

      <Text size="xs" c="dimmed" tt="uppercase" style={{ letterSpacing: '0.04em' }}>
        Trades
      </Text>
      <EditableList<TradeRow, TradeInput>
        items={memberTrades}
        addLabel="Add trade"
        emptyMessage="No trades yet."
        deleteTarget={(trade) => ({
          title: 'Delete trade?',
          itemLabel: `${trade.side === 'buy' ? 'Buy' : 'Sell'} ${trade.ticker}, ${formatIsoDate(trade.traded_on)}`,
        })}
        onCreate={onCreate}
        onUpdate={onUpdate}
        onDelete={onDelete}
        renderItem={(trade, { onEdit, onDelete: onDeleteItem }) => (
          <TradeCard trade={trade} onEdit={onEdit} onDelete={onDeleteItem} />
        )}
        renderForm={({ initial, onSubmit, onCancel }) => (
          <TradeForm member={member} initial={initial} onSubmit={onSubmit} onCancel={onCancel} />
        )}
      />
    </Stack>
  )
}

/**
 * Presentational investments manager: one section per household member with their
 * current share and ETF holdings (units, cost base, average cost, and value at the
 * last traded price), the capital gains realised in each financial year, and the
 * trades they are derived from. Sales are matched to purchases first-in first-out.
 * Persistence lives in the caller.
 */
export function TradesScreen({ members, trades, onCreate, onUpdate, onDelete }: TradesScreenProps) {
  return (
    <PageSection
      title="Investments"
      intro="Each member’s share and ETF trades. Holdings, cost base, and realised gains are worked out from them — sales are matched to the oldest purchases first, and a parcel held more than 12 months earns the 50% CGT discount. Holdings count toward net worth at the last traded price, and the net capital gain joins the tax estimate."
    >
      {members.map((member) => (
        <MemberTrades
          key={member.id}
          member={member}
          trades={trades}
          onCreate={onCreate}
          onUpdate={onUpdate}
          onDelete={onDelete}
        />
      ))}
    </PageSection>
  )
}
