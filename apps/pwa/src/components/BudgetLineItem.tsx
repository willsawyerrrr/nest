import { Link } from 'react-router-dom'
import { ActionIcon, Badge, Box, Group, Stack, Text } from '@mantine/core'
import { IconChevronRight, IconExternalLink, IconWallet } from '@tabler/icons-react'
import { fortnightlyCents } from '@nest/plan'
import type { BudgetLine } from '../hooks/useBudgetLines'
import { useIsWide } from '../hooks/useIsWide'
import type { LineRoute } from '../lib/budgetLineRoute'
import { formatFrequency } from '../lib/frequency'
import { AccountIcon } from './AccountIcon'
import { AppCard } from './AppCard'
import { EditAction } from './EditAction'
import { EditDeleteActions } from './EditDeleteActions'
import { FortnightlyAmount } from './FortnightlyAmount'
import { ListRow } from './ListRow'
import { MoneyText } from './MoneyText'

/** What a derived line links through to: a gift line to the Gifts tab, a generic line to its breakdown. */
export type DerivedSource = { isGift: true } | { isGift: false; breakdownId: string }

/**
 * A chevron control linking a derived line through to its source. A gift line goes
 * straight to the Gifts tab, where gifts are managed; a generic line goes to its
 * breakdown's editor.
 */
function DerivedLink({ source }: { source: DerivedSource }) {
  return (
    <ActionIcon
      component={Link}
      to={source.isGift ? '/gifts' : `/breakdowns/${source.breakdownId}`}
      state={{ from: '/budget' }}
      variant="subtle"
      aria-label={source.isGift ? 'Open gifts' : 'Open breakdown'}
    >
      <IconChevronRight size={16} />
    </ActionIcon>
  )
}

/** A derived line's controls: an inline edit pencil beside the chevron to its source. */
function DerivedLineControls({
  source,
  onEdit,
}: {
  source: DerivedSource
  onEdit?: (() => void) | undefined
}) {
  return (
    <>
      {onEdit && <EditAction onClick={onEdit} />}
      <DerivedLink source={source} />
    </>
  )
}

/** A small icon link opening a line's subscription management page in a new tab. */
function ManagementLink({ line }: { line: BudgetLine }) {
  if (!line.management_url) {
    return null
  }
  return (
    <ActionIcon
      component="a"
      href={line.management_url}
      target="_blank"
      rel="noopener noreferrer"
      variant="subtle"
      size="sm"
      aria-label={`Manage ${line.name} subscription`}
      style={{ flexShrink: 0 }}
    >
      <IconExternalLink size={14} />
    </ActionIcon>
  )
}

/** A subtle badge naming where a line routes: its linked goal or its funding account. */
function RouteBadge({ route }: { route: LineRoute }) {
  return (
    <Badge
      size="xs"
      variant="light"
      color="gray"
      ml="auto"
      leftSection={
        route.drawn ? <IconWallet size={10} /> : <AccountIcon name={route.iconName} size={10} />
      }
      title={route.title}
      style={{ maxWidth: '12rem' }}
    >
      {route.label}
    </Badge>
  )
}

/**
 * One budget line as a single dense table-like row for desktop: the name grows
 * to fill, with the amount, frequency, and fortnightly figure right-aligned in
 * fixed columns and the controls at the end, separated by a light rule rather
 * than a bordered card so many lines fit and scan as a table. A derived line
 * shows an edit pencil and its breakdown chevron in place of the edit/delete controls.
 */
function BudgetLineRow({
  line,
  route,
  source,
  onEdit,
  onDelete,
}: {
  line: BudgetLine
  route?: LineRoute | undefined
  source?: DerivedSource | undefined
  onEdit?: (() => void) | undefined
  onDelete?: () => void
}) {
  const fortnightly = fortnightlyCents(
    line.amount_cents,
    line.frequency,
    line.interval_count ?? undefined,
  )
  return (
    <ListRow>
      <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
        <Text fw={600} size="sm" truncate>
          {line.name}
        </Text>
        <ManagementLink line={line} />
        {route && <RouteBadge route={route} />}
      </Group>
      <MoneyText
        cents={line.amount_cents}
        size="sm"
        c="dimmed"
        ta="right"
        style={{ width: '6rem', flexShrink: 0 }}
      />
      <Box style={{ width: '8rem', flexShrink: 0, textAlign: 'right' }}>
        <Badge size="xs" variant="default">
          {formatFrequency(line.frequency, line.interval_count)}
        </Badge>
      </Box>
      <FortnightlyAmount
        cents={fortnightly}
        justify="flex-end"
        style={{ width: '7rem', flexShrink: 0 }}
      />
      <Group gap="xxs" wrap="nowrap" justify="flex-end" style={{ width: '3.75rem', flexShrink: 0 }}>
        {source ? (
          <DerivedLineControls source={source} onEdit={onEdit} />
        ) : (
          onEdit && onDelete && <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
        )}
      </Group>
    </ListRow>
  )
}

/**
 * One budget line as a compact bordered card for mobile: name (with its route
 * badge alongside) stacked over amount, frequency, and controls. A derived line
 * shows an edit pencil and its breakdown chevron in place of the edit/delete
 * controls.
 */
function BudgetLineCard({
  line,
  route,
  source,
  onEdit,
  onDelete,
}: {
  line: BudgetLine
  route?: LineRoute | undefined
  source?: DerivedSource | undefined
  onEdit?: (() => void) | undefined
  onDelete?: () => void
}) {
  const fortnightly = fortnightlyCents(
    line.amount_cents,
    line.frequency,
    line.interval_count ?? undefined,
  )
  return (
    <AppCard withBorder padding="xs">
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
            <Text fw={600} size="sm" truncate>
              {line.name}
            </Text>
            <ManagementLink line={line} />
            {route && <RouteBadge route={route} />}
          </Group>
          <Group gap={6} wrap="nowrap">
            <MoneyText cents={line.amount_cents} size="xs" c="dimmed" />
            <Badge size="xs" variant="default">
              {formatFrequency(line.frequency, line.interval_count)}
            </Badge>
          </Group>
        </Stack>
        <Group gap="xxs" wrap="nowrap" style={{ flexShrink: 0 }}>
          <FortnightlyAmount cents={fortnightly} />
          {source ? (
            <DerivedLineControls source={source} onEdit={onEdit} />
          ) : (
            onEdit && onDelete && <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
          )}
        </Group>
      </Group>
    </AppCard>
  )
}

/**
 * A single budget line, rendered as a dense table-like row from the `sm`
 * breakpoint up and as a compact bordered card below it.
 */
export function BudgetLineItem(props: {
  line: BudgetLine
  route?: LineRoute | undefined
  source?: DerivedSource | undefined
  onEdit?: (() => void) | undefined
  onDelete?: () => void
}) {
  const wide = useIsWide()
  return wide ? <BudgetLineRow {...props} /> : <BudgetLineCard {...props} />
}
