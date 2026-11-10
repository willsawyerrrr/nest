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

  it('reads a draft from the page URL when none was stashed', () => {
    window.history.replaceState(
      null,
      '',
      '/goals?promoteName=Espresso%20machine&promoteAmountCents=120000',
    )
    expect(takeGoalDraft()).toEqual({ name: 'Espresso machine', amountCents: 1_200_00 })
    expect(takeBudgetDraft()).toEqual({ name: 'Espresso machine', amountCents: 1_200_00 })

    window.history.replaceState(null, '', '/goals?promoteName=Couch&promoteAmountCents=abc')
    expect(takeGoalDraft()).toBeNull()

    window.history.replaceState(null, '', '/')
  })
})
