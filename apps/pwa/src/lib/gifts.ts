import type { Tables } from './database.types'

export type GiftRecipient = Tables<'gift_recipient'>
export type GiftOccasion = Tables<'gift_occasion'>
export type GiftBudget = Tables<'gift_budget'>
export type GiftPurchase = Tables<'gift_purchase'>

/** Which dimension the tracker groups by: occasions with recipient rows, or the reverse. */
export type GiftGroupBy = 'occasion' | 'person'

/** A budgeted/spent/remaining money triple, all in integer cents. */
export interface GiftTotals {
  budgetedCents: number
  spentCents: number
  remainingCents: number
}

/**
 * One line within a group: the pairing's other dimension (a recipient when
 * grouping by occasion, an occasion when grouping by person) and its money.
 */
export interface GiftRow extends GiftTotals {
  budgetId: string
  recipientId: string
  occasionId: string
  /** The other dimension's display name. */
  label: string
}

/** A group header (an occasion or a recipient) with its rolled-up money and rows. */
export interface GiftGroup extends GiftTotals {
  /** The group entity's id (occasion id or recipient id). */
  key: string
  label: string
  /** The occasion date when grouping by occasion; `null` otherwise. */
  date: string | null
  rows: GiftRow[]
}

/** The key identifying a recipient/occasion pairing (a `gift_budget` is unique per pair). */
export function pairKey(recipientId: string, occasionId: string): string {
  return `${recipientId}:${occasionId}`
}

/** Total cents spent against a single gift budget. */
export function spentCents(budgetId: string, purchases: GiftPurchase[]): number {
  return purchases
    .filter((purchase) => purchase.gift_budget_id === budgetId)
    .reduce((total, purchase) => total + purchase.amount_cents, 0)
}

/** A gift budget's budgeted, spent, and remaining cents. */
export function budgetTotals(budget: GiftBudget, purchases: GiftPurchase[]): GiftTotals {
  const spent = spentCents(budget.id, purchases)
  return {
    budgetedCents: budget.budgeted_amount_cents,
    spentCents: spent,
    remainingCents: budget.budgeted_amount_cents - spent,
  }
}

/** The household's total planned gift spend: the sum of every gift budget's budgeted cents. */
export function giftBudgetTotalCents(budgets: GiftBudget[]): number {
  return budgets.reduce((total, budget) => total + budget.budgeted_amount_cents, 0)
}

/** Sums a list of totals into one triple. */
function sumTotals(totals: GiftTotals[]): GiftTotals {
  return totals.reduce<GiftTotals>(
    (running, current) => ({
      budgetedCents: running.budgetedCents + current.budgetedCents,
      spentCents: running.spentCents + current.spentCents,
      remainingCents: running.remainingCents + current.remainingCents,
    }),
    { budgetedCents: 0, spentCents: 0, remainingCents: 0 },
  )
}

/** Orders occasions by date (undated last), then name, then id for a stable tiebreak. */
function compareOccasions(a: GiftOccasion, b: GiftOccasion): number {
  if (a.occasion_date !== b.occasion_date) {
    if (a.occasion_date === null) return 1
    if (b.occasion_date === null) return -1
    return a.occasion_date < b.occasion_date ? -1 : 1
  }
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
}

/** Orders recipients by name, then id for a stable tiebreak. */
function compareRecipients(a: GiftRecipient, b: GiftRecipient): number {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
}

/**
 * Groups the gift budgets into an ordered list of groups. Grouping by
 * `occasion` yields one group per occasion whose rows are its budgeted
 * recipients; grouping by `person` yields one group per recipient whose rows
 * are its budgeted occasions. Every group entity appears even with no budgets
 * (letting the caller offer an add affordance); each group rolls up its rows'
 * budgeted, spent, and remaining cents.
 */
export function groupGifts(
  recipients: GiftRecipient[],
  occasions: GiftOccasion[],
  budgets: GiftBudget[],
  purchases: GiftPurchase[],
  groupBy: GiftGroupBy,
): GiftGroup[] {
  const recipientById = new Map(recipients.map((recipient) => [recipient.id, recipient]))
  const occasionById = new Map(occasions.map((occasion) => [occasion.id, occasion]))

  const groupEntities = groupBy === 'occasion' ? [...occasions] : [...recipients]
  groupEntities.sort((a, b) =>
    groupBy === 'occasion'
      ? compareOccasions(a as GiftOccasion, b as GiftOccasion)
      : compareRecipients(a as GiftRecipient, b as GiftRecipient),
  )

  return groupEntities.map((entity) => {
    const groupBudgets = budgets.filter((budget) =>
      groupBy === 'occasion' ? budget.occasion_id === entity.id : budget.recipient_id === entity.id,
    )

    const rows: GiftRow[] = groupBudgets
      .map((budget): GiftRow | null => {
        const recipient = recipientById.get(budget.recipient_id)
        const occasion = occasionById.get(budget.occasion_id)
        if (!recipient || !occasion) {
          return null
        }
        return {
          budgetId: budget.id,
          recipientId: budget.recipient_id,
          occasionId: budget.occasion_id,
          label: groupBy === 'occasion' ? recipient.name : occasion.name,
          ...budgetTotals(budget, purchases),
        }
      })
      .filter((row): row is GiftRow => row !== null)

    rows.sort((a, b) =>
      groupBy === 'occasion'
        ? compareRecipients(recipientById.get(a.recipientId)!, recipientById.get(b.recipientId)!)
        : compareOccasions(occasionById.get(a.occasionId)!, occasionById.get(b.occasionId)!),
    )

    return {
      key: entity.id,
      label: entity.name,
      date: groupBy === 'occasion' ? (entity as GiftOccasion).occasion_date : null,
      rows,
      ...sumTotals(rows),
    }
  })
}
