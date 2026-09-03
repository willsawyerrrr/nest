import { Navigate } from 'react-router-dom'
import { fortnightlyCents, grantValueCents, projectGoal } from '@nest/plan'
import { LoadingScreen } from '../components/LoadingScreen'
import { usePlanningMode } from '../components/PlanningModeProvider'
import {
  PlanningScreen,
  type PlanningGoalEta,
  type PlanningOverride,
  type PlanningRollupFigure,
} from '../components/PlanningScreen'
import { useAccounts } from '../hooks/useAccounts'
import { useBreakdowns } from '../hooks/useBreakdowns'
import { useBudgetLines, type BudgetLine } from '../hooks/useBudgetLines'
import { useDeductions } from '../hooks/useDeductions'
import { useEquityGrants } from '../hooks/useEquityGrants'
import { useGifts } from '../hooks/useGifts'
import { useGoals, type Goal } from '../hooks/useGoals'
import { useHelpDebts } from '../hooks/useHelpDebts'
import { useInflows, type Inflow } from '../hooks/useInflows'
import { useMembers } from '../hooks/useMembers'
import { useSavers } from '../hooks/useSavers'
import { useSuperContributions } from '../hooks/useSuperContributions'
import { useSuperProfiles } from '../hooks/useSuperProfiles'
import { useTaxProfiles } from '../hooks/useTaxProfiles'
import { useTemporaryItems } from '../hooks/useTemporaryItems'
import { derivedAmountContext } from '../lib/breakdowns'
import { equityGrantToPlan } from '../lib/equity'
import { memberName } from '../lib/members'
import { formatCents } from '../lib/money'
import { computeNetWorth, projectionHorizonYears, resolveHorizonYears } from '../lib/netWorth'
import type { PlanningLayer, PlanningTable } from '../lib/planningMode'
import { readAssumptions, readMemberAges, readProjectionHorizon } from '../lib/retirement'
import { summariseHousehold } from '../lib/summary'
import type { EquityHolding, Liability } from '../lib/super'
import { estimateHouseholdTaxFromRows } from '../lib/tax'

const TABLE_LABEL: Record<PlanningTable, string> = {
  inflows: 'Inflow',
  budget_line: 'Budget line',
  savings_goal: 'Savings goal',
}

type FieldRow = Record<string, unknown>

/** Display-name lookups for the id-typed fields a sandbox patch can carry. */
export interface NameLookups {
  member: Map<string, string>
  goal: Map<string, string>
  account: Map<string, string>
  breakdown: Map<string, string>
}

/** Which lookup resolves each id-typed field's value to a display name. */
const ID_FIELD: Record<string, keyof NameLookups> = {
  member_id: 'member',
  gift_recipient_member_id: 'member',
  goal_id: 'goal',
  destination_account_id: 'account',
  linked_account_id: 'account',
  breakdown_id: 'breakdown',
}

/** A row's display name, falling back to its id when the row is gone or unnamed. */
function rowName(row: FieldRow | undefined, id: string): string {
  const name = row?.['name']
  return typeof name === 'string' && name.length > 0 ? name : id
}

/**
 * Formats a field value for the was → now line: an id-typed field as the row's
 * display name (its id when nothing resolves), money fields as currency, the rest
 * plainly.
 */
function formatFieldValue(field: string, value: unknown, lookups: NameLookups): string {
  if (value === null || value === undefined) {
    return '—'
  }
  const lookup = ID_FIELD[field]
  if (lookup && typeof value === 'string') {
    return lookups[lookup].get(value) ?? value
  }
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no'
  }
  if (typeof value === 'number') {
    return field.endsWith('_cents') ? formatCents(value) : String(value)
  }
  return String(value)
}

/** Whether a patched field's value matches the baseline's — `undefined` and `null` counting as one. */
function unchanged(was: unknown, now: unknown): boolean {
  return (was ?? null) === (now ?? null)
}

/** Every held row for one table as `PlanningOverride`s: updates, then creates, then deletes. */
function overridesForTable(
  table: PlanningTable,
  layer: PlanningLayer | undefined,
  baselineRows: readonly { id: string }[],
  lookups: NameLookups,
): PlanningOverride[] {
  if (!layer) {
    return []
  }
  const byId = new Map(baselineRows.map((row) => [row.id, row as FieldRow]))
  const createdIds = new Set(layer.creates.map((row) => row.id))
  const result: PlanningOverride[] = []
  for (const [id, patch] of Object.entries(layer.updates)) {
    if (createdIds.has(id)) {
      continue
    }
    const row = byId.get(id)
    const changes = Object.entries(patch)
      .filter(([field, now]) => !unchanged(row?.[field], now))
      .map(([field, now]) => ({
        field,
        was: formatFieldValue(field, row?.[field], lookups),
        now: formatFieldValue(field, now, lookups),
      }))
    if (changes.length === 0) {
      continue
    }
    result.push({
      table,
      tableLabel: TABLE_LABEL[table],
      id,
      rowName: rowName(row, id),
      kind: 'update',
      changes,
    })
  }
  for (const row of layer.creates) {
    result.push({
      table,
      tableLabel: TABLE_LABEL[table],
      id: row.id,
      rowName: rowName(row, row.id),
      kind: 'create',
      changes: [],
    })
  }
  for (const id of layer.deletes) {
    result.push({
      table,
      tableLabel: TABLE_LABEL[table],
      id,
      rowName: rowName(byId.get(id), id),
      kind: 'delete',
      changes: [],
    })
  }
  return result
}

export function PlanningSection({ householdId }: { householdId: string }) {
  const planning = usePlanningMode()
  const { members, loading: membersLoading } = useMembers()
  const inflows = useInflows(householdId)
  const budgetLines = useBudgetLines(householdId)
  const goals = useGoals(householdId)
  const savers = useSavers()
  const accounts = useAccounts(householdId)
  const taxProfiles = useTaxProfiles(householdId)
  const contributions = useSuperContributions(householdId)
  const superProfiles = useSuperProfiles(householdId)
  const helpDebts = useHelpDebts(householdId)
  const deductions = useDeductions(householdId)
  const equityGrants = useEquityGrants(householdId)
  const temporaryItems = useTemporaryItems(householdId)
  const gifts = useGifts(householdId)
  const breakdowns = useBreakdowns(householdId)

  if (!planning.active) {
    return <Navigate to="/summary" replace />
  }

  if (
    membersLoading ||
    inflows.loading ||
    budgetLines.loading ||
    goals.loading ||
    savers.loading ||
    accounts.loading ||
    taxProfiles.loading ||
    contributions.loading ||
    superProfiles.loading ||
    helpDebts.loading ||
    deductions.loading ||
    equityGrants.loading ||
    temporaryItems.loading ||
    gifts.loading ||
    breakdowns.loading ||
    !members
  ) {
    return <LoadingScreen />
  }

  const baselineInflows = inflows.baselineInflows ?? []
  const baselineLines = budgetLines.baselineLines ?? []
  const baselineGoals = goals.baselineGoals ?? []
  const proposedInflows = inflows.inflows ?? []
  const proposedLines = budgetLines.lines ?? []
  const proposedGoals = goals.goals ?? []

  const lookups: NameLookups = {
    member: new Map(members.map((member) => [member.id, member.name])),
    goal: new Map([...baselineGoals, ...proposedGoals].map((goal) => [goal.id, goal.name])),
    account: new Map<string, string>([
      ...(accounts.accounts ?? []).map((account) => [account.id, account.name] as const),
      ...(savers.savers ?? []).map((saver) => [saver.id, saver.name] as const),
    ]),
    breakdown: new Map(
      (breakdowns.breakdowns ?? []).map((breakdown) => [breakdown.id, breakdown.name]),
    ),
  }

  const overrides: PlanningOverride[] = [
    ...overridesForTable('inflows', planning.layerFor('inflows'), baselineInflows, lookups),
    ...overridesForTable('budget_line', planning.layerFor('budget_line'), baselineLines, lookups),
    ...overridesForTable('savings_goal', planning.layerFor('savings_goal'), baselineGoals, lookups),
  ]

  const context = derivedAmountContext(
    breakdowns.breakdowns ?? [],
    breakdowns.items ?? [],
    gifts.budgets ?? [],
    gifts.recipients ?? [],
  )
  const profileRows = taxProfiles.profiles ?? []
  const contributionRows = contributions.contributions ?? []
  const helpDebtRows = helpDebts.helpDebts ?? []
  const deductionRows = deductions.deductions ?? []
  const grantRows = equityGrants.grants ?? []
  const today = new Date()

  const summaryFor = (inf: Inflow[], lines: BudgetLine[]) =>
    summariseHousehold({
      inflows: inf,
      budgetLines: lines,
      taxProfiles: profileRows,
      financialYear: taxProfiles.financialYear,
      contributions: contributionRows,
      helpDebts: helpDebtRows,
      deductions: deductionRows,
      members,
      derivedAmounts: context,
      temporaryItems: temporaryItems.items ?? [],
      now: today,
    })
  const estimateFor = (inf: Inflow[]) =>
    estimateHouseholdTaxFromRows(
      inf,
      profileRows,
      contributionRows,
      helpDebtRows,
      deductionRows,
      undefined,
      undefined,
      members,
    )

  const liabilities: Liability[] = helpDebtRows
    .filter((debt) => debt.balance_cents > 0)
    .map((debt) => ({
      label: `${memberName(members, debt.member_id)}'s HELP debt`,
      balanceCents: debt.balance_cents,
    }))
  const planGrants = grantRows.map(equityGrantToPlan)
  const equity: EquityHolding[] = grantRows
    .map((grant) => ({
      label: `${memberName(members, grant.member_id)} — ${grant.label}`,
      valueCents: grantValueCents(equityGrantToPlan(grant), today),
    }))
    .filter((holding) => holding.valueCents > 0)
  const ages = readMemberAges()
  const assumptions = readAssumptions()
  const horizonYears = resolveHorizonYears(
    readProjectionHorizon(),
    projectionHorizonYears(
      members.map((member) => ages[member.id]).filter((age): age is number => age !== undefined),
      assumptions.retirementAge,
    ),
  )
  const netWorthFor = (inf: Inflow[], gls: Goal[], lines: BudgetLine[]) =>
    computeNetWorth({
      accounts: accounts.accounts ?? [],
      superProfiles: superProfiles.profiles ?? [],
      contributions: contributionRows,
      taxProfiles: profileRows,
      helpDebts: helpDebtRows,
      deductions: deductionRows,
      members,
      planGrants,
      liabilities,
      equity,
      inflows: inf,
      goals: gls,
      budgetLines: lines,
      assumptions,
      horizonYears,
      now: today,
    })

  const realSummary = summaryFor(baselineInflows, baselineLines)
  const proposedSummary = summaryFor(proposedInflows, proposedLines)
  const realEstimate = estimateFor(baselineInflows)
  const proposedEstimate = estimateFor(proposedInflows)
  const realNetWorth = netWorthFor(baselineInflows, baselineGoals, baselineLines)
  const proposedNetWorth = netWorthFor(proposedInflows, proposedGoals, proposedLines)

  const figures: PlanningRollupFigure[] = [
    {
      label: 'Fortnightly buffer',
      baselineCents: realSummary.afterSaving.fortnightlyCents,
      proposedCents: proposedSummary.afterSaving.fortnightlyCents,
      colored: true,
    },
    {
      label: 'Annual tax',
      baselineCents: realEstimate.annualTaxCents,
      proposedCents: proposedEstimate.annualTaxCents,
    },
    {
      label: 'Annual take-home',
      baselineCents: realEstimate.annualAfterTaxCents,
      proposedCents: proposedEstimate.annualAfterTaxCents,
    },
    {
      label: 'Net worth',
      baselineCents: realNetWorth.totalCents,
      proposedCents: proposedNetWorth.totalCents,
      colored: true,
    },
    {
      label: 'Projected net worth',
      baselineCents: realNetWorth.projection.at(-1)?.totalCents ?? 0,
      proposedCents: proposedNetWorth.projection.at(-1)?.totalCents ?? 0,
      colored: true,
    },
  ]

  const etaFor = (goal: Goal, lines: BudgetLine[]): string | null => {
    const contributionCents = lines
      .filter((line) => line.goal_id === goal.id)
      .reduce((total, line) => total + fortnightlyCents(line.amount_cents, line.frequency), 0)
    const saver = savers.savers?.find((each) => each.id === goal.linked_account_id)
    const currentBalanceCents = saver ? saver.balance_cents : goal.current_balance_cents
    return projectGoal(
      {
        targetAmountCents: goal.target_amount_cents,
        currentBalanceCents,
        ...(goal.target_date != null && { targetDate: goal.target_date }),
        annualInterestBps: goal.annual_interest_bps,
      },
      contributionCents,
      today,
    ).projectedCompletionDate
  }
  const baselineGoalById = new Map(baselineGoals.map((goal) => [goal.id, goal]))
  const goalEtas: PlanningGoalEta[] = proposedGoals.map((goal) => ({
    name: goal.name,
    proposedIso: etaFor(goal, proposedLines),
    baselineIso: etaFor(baselineGoalById.get(goal.id) ?? goal, baselineLines),
  }))

  return (
    <PlanningScreen
      overrides={overrides}
      figures={figures}
      goalEtas={goalEtas}
      onResetRow={planning.resetRow}
      onDiscard={planning.resetAll}
      onExit={planning.exit}
    />
  )
}
