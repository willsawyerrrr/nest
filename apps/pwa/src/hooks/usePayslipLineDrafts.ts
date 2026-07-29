import { useCallback, useRef, useState } from 'react'
import { centsToDollars } from '../lib/money'
import {
  matchInflowByLabel,
  type ExtractedLine,
  type ExtractedTaxComponent,
  type PayslipExtraction,
} from '../lib/payslipExtraction'
import type { PayslipLineKind, PayslipLineRow, PayslipTaxComponent } from './usePayslipLines'

/**
 * One line being edited: its amount held as a dollars input value. The two
 * references are exclusive, as the stored line's own check constraint requires —
 * an earnings line carries the inflow it draws on and a tax line the component it
 * pays — and the unused one is dropped on save.
 */
export interface LineDraft {
  /** Stable across removals, so a row keeps its inputs as its siblings go. */
  readonly id: number
  readonly kind: PayslipLineKind
  readonly label: string
  readonly amount: number | string
  readonly sourceInflowId: string | null
  readonly component: PayslipTaxComponent | null
}

/** An option per inflow an earnings line may draw on. */
export interface InflowOption {
  readonly value: string
  readonly label: string
}

/** What a line pre-fill did, so the form can say what the slip's itemisation gave. */
export interface LinePrefillSummary {
  /** Line kinds the read itemised. */
  filledLines: PayslipLineKind[]
  /** Line kinds left exactly as the member already had them. */
  keptLines: PayslipLineKind[]
  /** Labels whose inflow was matched from the printed label, so they can be checked. */
  matchedLines: string[]
}

export interface PayslipLineDrafts {
  lines: readonly LineDraft[]
  /** Edits one row, which makes its whole kind the member's own. */
  change: (line: LineDraft, changes: Partial<LineDraft>) => void
  add: (kind: PayslipLineKind) => void
  remove: (id: number) => void
  /**
   * Itemises the form from a read slip, for each kind the member has not made
   * their own, and reports which those were.
   */
  prefill: (extraction: PayslipExtraction, options: readonly InflowOption[]) => LinePrefillSummary
}

/** A line whose printed amount converted, so there is a figure to fill in. */
function converted<L extends ExtractedLine>(line: L): line is L & { amount_cents: number } {
  return line.amount_cents !== null
}

/** The read lines of one kind, flattened to what a draft row needs. */
interface OfferedLines {
  kind: PayslipLineKind
  lines: { label: string; amountCents: number; component: ExtractedTaxComponent | null }[]
}

/** What a read offers each kind: the lines it itemised, minus any it could not convert. */
function offered(extraction: PayslipExtraction): OfferedLines[] {
  return [
    {
      kind: 'earning',
      lines: extraction.lines.earnings.filter(converted).map((line) => ({
        label: line.label,
        amountCents: line.amount_cents,
        component: null,
      })),
    },
    {
      kind: 'tax',
      lines: extraction.lines.tax.filter(converted).map((line) => ({
        label: line.label,
        amountCents: line.amount_cents,
        component: line.component,
      })),
    },
  ]
}

/**
 * Holds the payslip form's line rows and remembers which kinds of them are the
 * member's own.
 *
 * A read itemises a kind only while the member has left that kind alone, on the
 * same footing as the scalar figures in `usePayslipFields`: a kind is
 * theirs once they have edited any row of it here, and every kind the payslip
 * being edited opened with is theirs from the start, having been confirmed when it
 * was saved. So attaching a document to a slip already itemised reads it without
 * rewriting the itemisation on file, while a slip whose tax section was never
 * itemised still has that gap filled. Where a kind is filled, the read's lines
 * stand in for the untouched rows of that kind rather than joining them — there is
 * no merging a printed line against a blank row nobody typed into.
 *
 * The claimed kinds are one mutable instance rather than a value replaced on each
 * change: nothing renders from them, and a pre-fill landing after an awaited read
 * has to see every kind claimed while the read was in flight.
 */
export function usePayslipLineDrafts(initial: readonly PayslipLineRow[]): PayslipLineDrafts {
  const nextId = useRef(initial.length)
  const [lines, setLines] = useState<readonly LineDraft[]>(() =>
    initial.map((line, index) => ({
      id: index,
      kind: line.kind,
      label: line.label,
      amount: centsToDollars(line.amount_cents),
      sourceInflowId: line.source_inflow_id,
      component: line.tax_component,
    })),
  )
  const [claimed] = useState(() => new Set(initial.map((line) => line.kind)))

  const change = useCallback(
    (line: LineDraft, changes: Partial<LineDraft>) => {
      claimed.add(line.kind)
      setLines((current) =>
        current.map((row) => (row.id === line.id ? { ...row, ...changes } : row)),
      )
    },
    [claimed],
  )

  const add = useCallback((kind: PayslipLineKind) => {
    setLines((current) => [
      ...current,
      {
        id: nextId.current++,
        kind,
        label: '',
        amount: '',
        sourceInflowId: null,
        component: null,
      },
    ])
  }, [])

  const remove = useCallback((id: number) => {
    setLines((current) => current.filter((line) => line.id !== id))
  }, [])

  const prefill = useCallback(
    (extraction: PayslipExtraction, options: readonly InflowOption[]): LinePrefillSummary => {
      const summary: LinePrefillSummary = { filledLines: [], keptLines: [], matchedLines: [] }
      const replaced = new Set<PayslipLineKind>()
      const drafts: LineDraft[] = []

      for (const section of offered(extraction)) {
        if (section.lines.length === 0) {
          continue
        }
        if (claimed.has(section.kind)) {
          summary.keptLines.push(section.kind)
          continue
        }
        summary.filledLines.push(section.kind)
        replaced.add(section.kind)
        for (const line of section.lines) {
          // The model never says which inflow a line draws on; the label does,
          // where it names exactly one of the member's own.
          const sourceInflowId =
            section.kind === 'earning' ? matchInflowByLabel(line.label, options) : null
          if (sourceInflowId !== null) {
            summary.matchedLines.push(line.label)
          }
          drafts.push({
            id: nextId.current++,
            kind: section.kind,
            label: line.label,
            amount: centsToDollars(line.amountCents),
            sourceInflowId,
            component: line.component,
          })
        }
      }

      // Written through an updater, not over a snapshot: a read takes seconds, and
      // whatever was typed while it ran belongs to a later render's rows.
      setLines((current) => [...current.filter((line) => !replaced.has(line.kind)), ...drafts])
      return summary
    },
    [claimed],
  )

  return { lines, change, add, remove, prefill }
}
