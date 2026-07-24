import { useEffect, useRef } from 'react'
import {
  reconcileBreakdownLines,
  reconcileGiftLines,
  type BreakdownLineOps,
  type DerivedAmountContext,
} from '../lib/breakdowns'
import type { DirectoryAccount } from '../lib/gifts'
import type { Breakdown } from './useBreakdowns'
import type { BudgetLine, UseBudgetLinesResult } from './useBudgetLines'

interface UseReconcileBreakdownLinesParams {
  /** The household's budget lines, or `null` while loading. */
  lines: BudgetLine[] | null
  /** Whether every source the reconcile reads (lines, breakdowns, gifts, members) has loaded. */
  dataLoaded: boolean
  /** The household's breakdowns, each of which may own one or more derived lines. */
  breakdowns: Breakdown[]
  /** The rolled-up amounts each derived line reads (generic totals and gift partitions). */
  context: DerivedAmountContext
  /** Each generic breakdown's item count, keyed by breakdown id, driving its line's existence. */
  counts: Map<string, number>
  /** Household member names keyed by member id, naming each gift partition's line. */
  memberNames: Map<string, string>
  /** The household's members, resolving the buyer whose account funds each gift member line. */
  members: { id: string }[]
  /** The account directory, supplying each buyer's spending account for gift member lines. */
  directory: DirectoryAccount[]
  createLine: UseBudgetLinesResult['create']
  updateLine: UseBudgetLinesResult['update']
  removeLine: UseBudgetLinesResult['remove']
}

/** Concatenates the create/update/remove ops of the generic and gift reconciles into one batch. */
function mergeOps(...batches: BreakdownLineOps[]): BreakdownLineOps {
  return {
    create: batches.flatMap((batch) => batch.create),
    update: batches.flatMap((batch) => batch.update),
    remove: batches.flatMap((batch) => batch.remove),
  }
}

/**
 * Enforces the app-managed derived-line lifecycle: as breakdown items and gift
 * budgets come and go, brings each generic breakdown's owned line and each gift
 * line into being, up to date, or away. A re-entrancy guard blocks a fresh
 * reconcile while its writes are in flight, so the reload they trigger cannot
 * re-enter mid-write.
 */
export function useReconcileBreakdownLines({
  lines,
  dataLoaded,
  breakdowns,
  context,
  counts,
  memberNames,
  members,
  directory,
  createLine,
  updateLine,
  removeLine,
}: UseReconcileBreakdownLinesParams): void {
  const reconcilingRef = useRef(false)
  useEffect(() => {
    if (!lines || !dataLoaded || reconcilingRef.current) {
      return
    }
    const ops = mergeOps(
      reconcileBreakdownLines(breakdowns, context, counts, lines),
      reconcileGiftLines(context.giftTotalsByMember, lines, memberNames, members, directory),
    )
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
  }, [
    lines,
    dataLoaded,
    breakdowns,
    context,
    counts,
    memberNames,
    members,
    directory,
    createLine,
    updateLine,
    removeLine,
  ])
}
