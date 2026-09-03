import { describe, expect, it } from 'vitest'
import { setBudgetDraft, setGoalDraft, takeBudgetDraft, takeGoalDraft } from './promoteDraft'

describe('promoteDraft', () => {
  it('hands the goal draft back exactly once, then clears it', () => {
    expect(takeGoalDraft()).toBeNull()

    setGoalDraft({ name: 'Espresso machine', amountCents: 1_200_00 })
    expect(takeGoalDraft()).toEqual({ name: 'Espresso machine', amountCents: 1_200_00 })
    expect(takeGoalDraft()).toBeNull()
  })

  it('hands the budget draft back exactly once, then clears it', () => {
    expect(takeBudgetDraft()).toBeNull()

    setBudgetDraft({ name: 'New couch', amountCents: 3_500_00 })
    expect(takeBudgetDraft()).toEqual({ name: 'New couch', amountCents: 3_500_00 })
    expect(takeBudgetDraft()).toBeNull()
  })
})
