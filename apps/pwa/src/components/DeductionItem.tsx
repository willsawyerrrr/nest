import type { ReactNode } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { Anchor, Group, Stack, Text } from '@mantine/core'
import { IconGripVertical } from '@tabler/icons-react'
import type { DeductionReceiptRow } from '../hooks/useDeductionReceipts'
import type { DeductionRow } from '../hooks/useDeductions'
import { useIsWide } from '../hooks/useIsWide'
import { AppCard } from './AppCard'
import { EditDeleteActions } from './EditDeleteActions'
import { ListRow } from './ListRow'
import { MoneyText } from './MoneyText'

/** A day-month-year label for an ISO date string, built without a timezone shift. */
function formatIsoDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year!, month! - 1, day!).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * The date, plus the claimed distance for a distance-basis deduction (e.g.
 * "1 Aug 2026 · 120km") or the work-use share for a part-claimed one (e.g.
 * "1 Aug 2026 · 60% work use"). A distance-basis row is pinned at 100% work
 * use, so the two never both apply.
 */
function deductionDateLabel(deduction: DeductionRow): string {
  const date = formatIsoDate(deduction.deduction_date)
  if (deduction.basis === 'distance' && deduction.distance_km != null) {
    return `${date} · ${deduction.distance_km}km`
  }
  if (deduction.work_use_percent < 100) {
    return `${date} · ${deduction.work_use_percent}% work use`
  }
  return date
}

export interface DeductionItemProps {
  deduction: DeductionRow
  receipt: DeductionReceiptRow | undefined
  /** A drag handle rendered beside the row's controls. */
  dragHandle?: ReactNode
  onEdit: () => void
  onDelete: () => void
  signedUrl: (path: string) => Promise<string | null>
}

/** The grip button that starts a pointer or touch drag of a deduction. */
function DragHandle({
  deduction,
  handleProps,
}: {
  deduction: DeductionRow
  handleProps: Record<string, unknown>
}) {
  return (
    <button
      type="button"
      aria-label={`Drag ${deduction.description} to a group`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        border: 'none',
        background: 'transparent',
        padding: 2,
        cursor: 'grab',
        color: 'var(--mantine-color-dimmed)',
        touchAction: 'none',
      }}
      {...handleProps}
    >
      <IconGripVertical size={16} />
    </button>
  )
}

/**
 * A deduction's description with its "Receipt" view link inline after it, so a
 * row spends no line on the receipt and a long description wraps with the link
 * following its last word. Attaching, replacing, and removing a receipt live in
 * the edit form.
 */
function DeductionTitle({
  deduction,
  receipt,
  signedUrl,
}: Pick<DeductionItemProps, 'deduction' | 'receipt' | 'signedUrl'>) {
  const viewReceipt = async (current: DeductionReceiptRow) => {
    const url = await signedUrl(current.storage_path)
    if (url) {
      window.open(url, '_blank', 'noopener')
    }
  }

  return (
    <Text fw={600} size="sm" style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
      {deduction.description}
      {receipt && (
        <>
          {' '}
          <Anchor
            size="xs"
            fw={400}
            component="button"
            type="button"
            style={{ verticalAlign: 'baseline' }}
            onClick={() => void viewReceipt(receipt)}
          >
            Receipt
          </Anchor>
        </>
      )}
    </Text>
  )
}

/**
 * One deduction as a dense table-like row for desktop: the description (with its
 * receipt link inline) grows with its date as a dimmed suffix, its amount
 * right-aligned in a fixed column, and the controls at the end.
 */
function DeductionRow({
  deduction,
  dragHandle,
  onEdit,
  onDelete,
  receipt,
  signedUrl,
}: DeductionItemProps) {
  return (
    <ListRow>
      <Group gap={6} wrap="nowrap" align="baseline" style={{ flex: 1, minWidth: 0 }}>
        <DeductionTitle deduction={deduction} receipt={receipt} signedUrl={signedUrl} />
        <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
          {deductionDateLabel(deduction)}
        </Text>
      </Group>
      <MoneyText
        cents={deduction.amount_cents}
        fw={700}
        size="sm"
        ta="right"
        style={{ width: '7rem', flexShrink: 0 }}
      />
      <Group gap="xxs" wrap="nowrap" style={{ flexShrink: 0 }}>
        {dragHandle}
        <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
      </Group>
    </ListRow>
  )
}

/** One deduction as a compact bordered card for mobile: description and receipt link over its date. */
function DeductionCard({
  deduction,
  dragHandle,
  onEdit,
  onDelete,
  receipt,
  signedUrl,
}: DeductionItemProps) {
  return (
    <AppCard withBorder padding="xs">
      <Group justify="space-between" wrap="nowrap" gap="sm" align="flex-start">
        <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
          <DeductionTitle deduction={deduction} receipt={receipt} signedUrl={signedUrl} />
          <Text size="xs" c="dimmed">
            {deductionDateLabel(deduction)}
          </Text>
        </Stack>
        <Group gap="xxs" wrap="nowrap" style={{ flexShrink: 0 }}>
          <MoneyText cents={deduction.amount_cents} fw={700} size="sm" />
          {dragHandle}
          <EditDeleteActions onEdit={onEdit} onDelete={onDelete} />
        </Group>
      </Group>
    </AppCard>
  )
}

/**
 * A single deduction, rendered as a dense table-like row from the `sm` breakpoint
 * up and as a compact bordered card below it.
 */
export function DeductionItem(props: DeductionItemProps) {
  const wide = useIsWide()
  return wide ? <DeductionRow {...props} /> : <DeductionCard {...props} />
}

/** A deduction row or card that can be dragged to a group by its handle. */
export function DraggableDeduction(props: Omit<DeductionItemProps, 'dragHandle'>) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: props.deduction.id,
  })
  return (
    <div ref={setNodeRef} style={{ opacity: isDragging ? 0.4 : undefined }}>
      <DeductionItem
        {...props}
        dragHandle={
          <DragHandle deduction={props.deduction} handleProps={{ ...attributes, ...listeners }} />
        }
      />
    </div>
  )
}
