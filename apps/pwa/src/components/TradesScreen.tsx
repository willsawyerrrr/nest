import { ActionIcon, Anchor, Badge, Box, Group, Stack, Text } from '@mantine/core'
import { IconFileText } from '@tabler/icons-react'
import { MICRO_UNITS_PER_UNIT, unitsValueCents } from '@nest/tax'
import { useIsWide } from '../hooks/useIsWide'
import type { Member } from '../hooks/useMembers'
import type { TradeDocumentRow, UseTradeDocumentsResult } from '../hooks/useTradeDocuments'
import type { TradeInput, TradeRow } from '../hooks/useTrades'
import { formatIsoDate } from '../lib/dates'
import { formatCents, formatUnitPrice } from '../lib/money'
import { openSignedUrl } from '../lib/openSignedUrl'
import { memberPortfolio, type HoldingView } from '../lib/trades'
import { AppCard } from './AppCard'
import { EditableList } from './EditableList'
import { EditDeleteActions } from './EditDeleteActions'
import { ListRow } from './ListRow'
import { MoneyText } from './MoneyText'
import { PageSection } from './PageSection'
import { TradeAddCard } from './TradeAddCard'
import { TradeForm } from './TradeForm'

interface TradesScreenProps {
  members: Member[]
  /** Every household trade, oldest first; sales are matched against earlier purchases. */
  trades: TradeRow[]
  onCreate: (input: TradeInput) => Promise<void>
  onUpdate: (id: string, input: TradeInput) => Promise<void>
  onDelete: (id: string) => Promise<void>
  /** The stored documents trades were read from. */
  documents: TradeDocumentRow[]
  /** Uploading, reading, and saving a trade document, and viewing a stored one. */
  documentActions: Pick<
    UseTradeDocumentsResult,
    'upload' | 'discard' | 'extract' | 'save' | 'signedUrl'
  >
}

/** A units figure without trailing zeros, grouped by thousands. */
function formatUnits(units: number): string {
  return units.toLocaleString('en-AU', { maximumFractionDigits: 6 })
}

/** A units figure with its noun, e.g. `1 unit`, `1.5 units`. */
function unitsText(units: number): string {
  return `${formatUnits(units)} ${units === 1 ? 'unit' : 'units'}`
}

interface SummaryRowProps {
  title: string
  /** Muted figures between the title and the figure, each a fixed-width column on wide rows. */
  cells: string[]
  figure: number
  /** Muted label beneath the figure. */
  figureCaption: string
}

/**
 * One summary line, laid out like the app's budget lines: a dense table-like row
 * from the `sm` breakpoint up, with the title growing and muted figures in fixed
 * columns ahead of a right-aligned figure, and a compact bordered card below it.
 */
function SummaryRow({ title, cells, figure, figureCaption }: SummaryRowProps) {
  const wide = useIsWide()
  const figureColumn = (
    <Stack gap={0} align="flex-end" style={{ flexShrink: 0 }}>
      <MoneyText cents={figure} fw={700} size="sm" />
      <Text size="xs" c="dimmed">
        {figureCaption}
      </Text>
    </Stack>
  )
  return wide ? (
    <ListRow gap="sm">
      <Text fw={600} size="sm" truncate style={{ flex: 1, minWidth: 0 }}>
        {title}
      </Text>
      {cells.map((cell, index) => (
        <Text
          key={index}
          size="xs"
          c="dimmed"
          ta="right"
          style={{ width: '8.5rem', flexShrink: 0 }}
        >
          {cell}
        </Text>
      ))}
      {figureColumn}
    </ListRow>
  ) : (
    <AppCard withBorder padding="xs">
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Text fw={600} size="sm" truncate>
            {title}
          </Text>
          <Text size="xs" c="dimmed">
            {cells.filter((cell) => cell !== '').join(' \u00b7 ')}
          </Text>
        </Stack>
        {figureColumn}
      </Group>
    </AppCard>
  )
}

/** One current holding: its units and average cost, with cost base and market value. */
function HoldingRow({ holding }: { holding: HoldingView }) {
  return (
    <SummaryRow
      title={holding.ticker}
      cells={[
        unitsText(holding.units),
        `Avg cost ${formatUnitPrice(holding.averageCostMicrodollars)}`,
        `Cost base ${formatCents(holding.costBaseCents)}`,
      ]}
      figure={holding.valueCents}
      figureCaption={`at ${formatUnitPrice(holding.lastPriceMicrodollars)}`}
    />
  )
}

interface TradeItemProps {
  trade: TradeRow
  onEdit: () => void
  onDelete: () => void
  /** Opens the document the trade was read from; absent when it has none. */
  onViewDocument?: (() => void) | undefined
}

/** A trade's units, e.g. `120 units`. */
function unitsLabel(trade: TradeRow): string {
  return unitsText(Number(trade.units))
}

/** A trade's exact unit price, e.g. `at $33.083072`. */
function priceLabel(trade: TradeRow): string {
  return `at ${formatUnitPrice(trade.price_per_unit_microdollars)}`
}

/** A trade's brokerage, e.g. `$9.50 brokerage`, or an empty string when there is none. */
function brokerageLabel(trade: TradeRow): string {
  return trade.fee_cents > 0 ? `${formatCents(trade.fee_cents)} brokerage` : ''
}

/** A trade's value before brokerage: its units at its price, to the nearest cent. */
function tradeValueCents(trade: TradeRow): number {
  return unitsValueCents(
    Math.round(Number(trade.units) * MICRO_UNITS_PER_UNIT),
    trade.price_per_unit_microdollars,
  )
}

/** The side pill, ticker, and document link of a trade. */
function TradeTitle({
  trade,
  onViewDocument,
}: {
  trade: TradeRow
  /** Shown as a text link beside the ticker; omitted where the row has its own control. */
  onViewDocument?: (() => void) | undefined
}) {
  return (
    <Group gap={6} wrap="nowrap" align="center" style={{ flexShrink: 0 }}>
      <Badge size="xs" variant="light" color={trade.side === 'buy' ? 'cyan' : 'orange'}>
        {trade.side === 'buy' ? 'Buy' : 'Sell'}
      </Badge>
      <Text fw={600} size="sm" style={{ whiteSpace: 'nowrap' }}>
        {trade.ticker}
      </Text>
      {onViewDocument && (
        <Anchor size="xs" component="button" type="button" onClick={onViewDocument}>
          Document
        </Anchor>
      )}
    </Group>
  )
}

/**
 * One trade as a dense table-like row for desktop, like a budget line: the side
 * pill and ticker (never truncated) lead, with the date, units, and price in muted
 * columns sized to their content, the brokerage as an outlined pill (an em dash
 * when there is none), the trade value (units at
 * price, before brokerage) right-aligned, and the document, edit, and delete
 * controls at the end.
 */
function TradeRowWide({ trade, onEdit, onDelete, onViewDocument }: TradeItemProps) {
  return (
    <ListRow gap="sm">
      <Box style={{ flex: 1, minWidth: 'fit-content' }}>
        <TradeTitle trade={trade} />
      </Box>
      {[
        [formatIsoDate(trade.traded_on), '6.25rem'],
        [unitsLabel(trade), '4.75rem'],
        [priceLabel(trade), '6rem'],
      ].map(([label, width]) => (
        <Text key={width + label!} size="xs" c="dimmed" ta="right" style={{ width, flexShrink: 0 }}>
          {label}
        </Text>
      ))}
      <Group justify="flex-end" style={{ width: '4.5rem', flexShrink: 0 }}>
        {trade.fee_cents > 0 ? (
          <Badge
            size="sm"
            variant="outline"
            color="gray"
            c="var(--mantine-color-text)"
            tt="none"
            title={`Brokerage ${formatCents(trade.fee_cents)}`}
          >
            {formatCents(trade.fee_cents)}
          </Badge>
        ) : (
          <Text size="xs" c="dimmed" title="No brokerage">
            {'\u2014'}
          </Text>
        )}
      </Group>
      <MoneyText
        cents={tradeValueCents(trade)}
        fw={700}
        size="sm"
        ta="right"
        style={{ width: '5.5rem', flexShrink: 0 }}
      />
      <Group gap="xxs" wrap="nowrap" justify="flex-end" style={{ width: '5.5rem', flexShrink: 0 }}>
        {onViewDocument && (
          <ActionIcon variant="subtle" aria-label="Document" onClick={onViewDocument}>
            <IconFileText size={16} />
          </ActionIcon>
        )}
        <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
      </Group>
    </ListRow>
  )
}

/** One trade as a compact bordered card for mobile: title over its muted date and details. */
function TradeCard({ trade, onEdit, onDelete, onViewDocument }: TradeItemProps) {
  return (
    <AppCard withBorder padding="xs">
      <Group justify="space-between" wrap="nowrap" gap="sm" align="flex-start">
        <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
          <TradeTitle trade={trade} onViewDocument={onViewDocument} />
          <Text size="xs" c="dimmed">
            {[
              formatIsoDate(trade.traded_on),
              unitsLabel(trade),
              priceLabel(trade),
              brokerageLabel(trade),
            ]
              .filter((part) => part !== '')
              .join(' \u00b7 ')}
          </Text>
        </Stack>
        <Group gap="xxs" wrap="nowrap" style={{ flexShrink: 0 }}>
          <MoneyText cents={tradeValueCents(trade)} fw={700} size="sm" />
          <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
        </Group>
      </Group>
    </AppCard>
  )
}

/** A single trade, a dense row from the `sm` breakpoint up and a compact card below it. */
function TradeItem(props: TradeItemProps) {
  const wide = useIsWide()
  return wide ? <TradeRowWide {...props} /> : <TradeCard {...props} />
}

/** A member's holdings, realised gains per financial year, and their trade list. */
function MemberTrades({
  member,
  trades,
  onCreate,
  onUpdate,
  onDelete,
  documents,
  documentActions,
}: {
  member: Member
  trades: TradeRow[]
  onCreate: (input: TradeInput) => Promise<void>
  onUpdate: (id: string, input: TradeInput) => Promise<void>
  onDelete: (id: string) => Promise<void>
  documents: TradeDocumentRow[]
  documentActions: TradesScreenProps['documentActions']
}) {
  const viewDocument = (documentId: string) =>
    openSignedUrl(async () => {
      const path = documents.find((document) => document.id === documentId)?.storage_path
      return path ? documentActions.signedUrl(path) : null
    })

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
            <HoldingRow key={holding.ticker} holding={holding} />
          ))}
        </Stack>
      )}

      {gainsByYear.length > 0 && (
        <Stack gap="xs" aria-label={`${member.name}'s realised gains`}>
          <Text size="xs" c="dimmed" tt="uppercase" style={{ letterSpacing: '0.04em' }}>
            Realised gains
          </Text>
          {gainsByYear.map((summary) => (
            <SummaryRow
              key={summary.financialYear}
              title={`FY${summary.financialYear}`}
              cells={[
                `Gains ${formatCents(summary.gainsCents + summary.discountableGainsCents)}`,
                `Losses ${formatCents(summary.lossesCents + summary.carriedInLossesCents)}`,
                summary.discountCents > 0
                  ? `CGT discount ${formatCents(summary.discountCents)}`
                  : '',
              ]}
              figure={summary.netCapitalGainCents}
              figureCaption="net capital gain"
            />
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
          <TradeItem
            trade={trade}
            onEdit={onEdit}
            onDelete={onDeleteItem}
            onViewDocument={
              trade.document_id ? () => void viewDocument(trade.document_id!) : undefined
            }
          />
        )}
        renderForm={({ initial, onSubmit, onCancel }) =>
          initial ? (
            <TradeForm
              member={member}
              initial={initial}
              trades={trades}
              onSubmit={onSubmit}
              onCancel={onCancel}
            />
          ) : (
            <TradeAddCard
              member={member}
              trades={trades}
              actions={documentActions}
              onSubmit={onSubmit}
              onCancel={onCancel}
            />
          )
        }
      />
    </Stack>
  )
}

/**
 * Presentational investments manager: one section per household member with their
 * current share and ETF holdings (units, cost base, average cost, and value at the
 * last traded price), the capital gains realised in each financial year, and the
 * trades they are derived from. Sales are matched to purchases first-in first-out.
 * Trades can be added by hand, from one broker document attached to the Add trade
 * card, or from several documents at once, each confirmed by the member before it
 * is saved. Persistence lives in the caller.
 */
export function TradesScreen({
  members,
  trades,
  onCreate,
  onUpdate,
  onDelete,
  documents,
  documentActions,
}: TradesScreenProps) {
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
          documents={documents}
          documentActions={documentActions}
        />
      ))}
    </PageSection>
  )
}
