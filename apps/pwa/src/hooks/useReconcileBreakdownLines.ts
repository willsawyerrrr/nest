import { useEffect, useRef } from 'react'
import { reconcileBreakdownLines } from '../lib/breakdowns'
import type { Breakdown } from './useBreakdowns'
import type { BudgetLine, UseBudgetLinesResult } from './useBudgetLines'

interface UseReconcileBreakdownLinesParams {
  /** The household's budget lines, or `null` while loading. */
  lines: BudgetLine[] | null
  /** Whether every source the reconcile reads (lines, breakdowns, gifts) has loaded. */
  dataLoaded: boolean
  /** The household's breakdowns, each of which may own a derived line. */
  breakdowns: Breakdown[]
  /** Each breakdown's rolled-up annual total, keyed by breakdown id. */
  totals: Map<string, number>
  /** Each breakdown's item count, keyed by breakdown id, driving line existence. */
  counts: Map<string, number>
  createLine: UseBudgetLinesResult['create']
  updateLine: UseBudgetLinesResult['update']
  removeLine: UseBudgetLinesResult['remove']
}

/**
 * Enforces the app-managed derived-line lifecycle: as breakdown items come and
 * go, brings each breakdown's owned budget line into being, up to date, or away.
 * A re-entrancy guard blocks a fresh reconcile while its writes are in flight, so
 * the reload they trigger cannot re-enter mid-write.
 */
export function useReconcileBreakdownLines({
  lines,
  dataLoaded,
  breakdowns,
  totals,
  counts,
  createLine,
  updateLine,
  removeLine,
}: UseReconcileBreakdownLinesParams): void {
  const reconcilingRef = useRef(false)
  useEffect(() => {
    if (!lines || !dataLoaded || reconcilingRef.current) {
      return
    }
    const ops = reconcileBreakdownLines(breakdowns, totals, counts, lines)
    if (ops.create.length === 0 && ops.update.length === 0 && ops.remove.length === 0) {
      return
    }
    reconcilingRef.current = true
    void (async () => {
      try {
        for (const input of ops.create) {
          await createLine(input)
        }
        for (const { id, input } of ops.update) {
          await updateLine(id, input)
        }
        for (const id of ops.remove) {
          await removeLine(id)
        }
      } finally {
        reconcilingRef.current = false
      }
    })()
  }, [lines, dataLoaded, breakdowns, totals, counts, createLine, updateLine, removeLine])
}
