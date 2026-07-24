import { GiftsScreen } from '../components/GiftsScreen'
import { LoadingScreen } from '../components/LoadingScreen'
import { useCurrentMember } from '../hooks/useCurrentMember'
import { useGifts } from '../hooks/useGifts'
import { useMembers } from '../hooks/useMembers'

export function GiftsSection({ householdId }: { householdId: string }) {
  const gifts = useGifts(householdId)
  const { members, loading: membersLoading } = useMembers()
  const { member, loading: memberLoading } = useCurrentMember()

  if (gifts.loading || membersLoading || memberLoading) {
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
      onCreateBudget={gifts.createBudget}
      onUpdateBudget={gifts.updateBudget}
      onDeleteBudget={gifts.removeBudget}
      onCreatePurchase={gifts.createPurchase}
      onUpdatePurchase={gifts.updatePurchase}
      onDeletePurchase={gifts.removePurchase}
    />
  )
}
