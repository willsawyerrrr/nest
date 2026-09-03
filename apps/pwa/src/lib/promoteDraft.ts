/**
 * The one-shot hand-off that carries a wishlist item to the Goals or Budget tab
 * so its add form opens prefilled. The Wishlist screen stashes a draft and
 * navigates; the target tab picks it up once on mount and clears it, so a plain
 * revisit of the tab shows no prefilled form. Kept a module singleton rather
 * than router state so the target sections need no router plumbing and the
 * draft clears itself on read.
 */
export interface PromoteDraft {
  /** The wishlist item's name, seeding the target form's name field. */
  name: string
  /** The wishlist item's amount in cents — a goal's target, or a budget line's amount. */
  amountCents: number
}

let goalDraft: PromoteDraft | null = null
let budgetDraft: PromoteDraft | null = null

/** Stashes a wishlist item for the Goals tab to prefill its add form with. */
export function setGoalDraft(draft: PromoteDraft): void {
  goalDraft = draft
}

/** Returns the pending Goals draft once, clearing it. */
export function takeGoalDraft(): PromoteDraft | null {
  const draft = goalDraft
  goalDraft = null
  return draft
}

/** Stashes a wishlist item for the Budget tab to prefill its add form with. */
export function setBudgetDraft(draft: PromoteDraft): void {
  budgetDraft = draft
}

/** Returns the pending Budget draft once, clearing it. */
export function takeBudgetDraft(): PromoteDraft | null {
  const draft = budgetDraft
  budgetDraft = null
  return draft
}
