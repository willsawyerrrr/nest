import { useCallback } from 'react'
import { GiftsScreen } from '../components/GiftsScreen'
import { LoadingScreen } from '../components/LoadingScreen'
import { useBreakdowns } from '../hooks/useBreakdowns'
import { useCurrentMember } from '../hooks/useCurrentMember'
import { useGifts, type GiftBudgetInput } from '../hooks/useGifts'
import { useMembers } from '../hooks/useMembers'

export function GiftsSection({ householdId }: { householdId: string }) {
  const gifts = useGifts(householdId)
  const breakdowns = useBreakdowns(householdId)
  const { members, loading: membersLoading } = useMembers()
  const { member, loading: memberLoading } = useCurrentMember()

  const createBreakdown = breakdowns.create
  const breakdownRows = breakdowns.breakdowns

  // The single gift breakdown rolls a household's gift budgets into its derived
  // budget lines. It is created lazily from here — the first gift budget mints it
  // if the household has none — so the roll-up works without any Breakdowns UI.
  const createBudget = useCallback(
    async (input: GiftBudgetInput) => {
      const hasGiftBreakdown = (breakdownRows ?? []).some((breakdown) => breakdown.kind === 'gift')
      if (!hasGiftBreakdown) {
        await createBreakdown({ name: 'Gifts', line_group: 'wants', kind: 'gift' })
      }
      await gifts.createBudget(input)
    },
    [breakdownRows, createBreakdown, gifts],
  )

  if (gifts.loading || breakdowns.loading || membersLoading || memberLoading) {
    return <LoadingScreen />
  }

  return (
    <GiftsScreen
      recipients={gifts.recipients ?? []}
      occasions={gifts.occasions ?? []}
      budgets={gifts.budgets ?? []}
      purchases={gifts.purchases ?? []}
      members={members ?? []}
      currentMemberId={member?.id ?? null}
      onCreateRecipient={gifts.createRecipient}
      onUpdateRecipient={gifts.updateRecipient}
      onDeleteRecipient={gifts.removeRecipient}
      onCreateOccasion={gifts.createOccasion}
      onUpdateOccasion={gifts.updateOccasion}
      onDeleteOccasion={gifts.removeOccasion}
      onCreateBudget={createBudget}
      onUpdateBudget={gifts.updateBudget}
      onDeleteBudget={gifts.removeBudget}
      onCreatePurchase={gifts.createPurchase}
      onUpdatePurchase={gifts.updatePurchase}
      onDeletePurchase={gifts.removePurchase}
    />
  )
}
