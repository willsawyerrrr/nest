import { useGifts } from '../hooks/useGifts'
import { GiftsScreen } from '../components/GiftsScreen'
import { LoadingScreen } from '../components/LoadingScreen'

export function GiftsSection({
  householdId,
  backTo,
  backLabel,
}: {
  householdId: string
  backTo: string
  backLabel: string
}) {
  const gifts = useGifts(householdId)

  if (gifts.loading) {
    return <LoadingScreen />
  }

  return (
    <GiftsScreen
      backTo={backTo}
      backLabel={backLabel}
      recipients={gifts.recipients ?? []}
      occasions={gifts.occasions ?? []}
      budgets={gifts.budgets ?? []}
      purchases={gifts.purchases ?? []}
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
