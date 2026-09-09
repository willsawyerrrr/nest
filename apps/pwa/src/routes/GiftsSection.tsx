import { useCallback } from 'react'
import { GiftsScreen } from '../components/GiftsScreen'
import { LoadingScreen } from '../components/LoadingScreen'
import { useCurrentMember } from '../hooks/useCurrentMember'
import { useGifts } from '../hooks/useGifts'
import { useGiftTransactions } from '../hooks/useGiftTransactions'
import { useMembers } from '../hooks/useMembers'
import { useUpSync } from '../hooks/useUpSync'

export function GiftsSection() {
  const gifts = useGifts()
  const giftTransactions = useGiftTransactions()
  const { members, loading: membersLoading } = useMembers()
  const { member, loading: memberLoading } = useCurrentMember()

  // Refreshing pulls the gift-category transactions Up has since categorised, so
  // the inbox reloads. The sync also trues a linked purchase's amount up to its
  // settled transaction, so the gift collections reload alongside it.
  const reloadGifts = gifts.reload
  const reloadTransactions = giftTransactions.reload
  const reloadInbox = useCallback(async () => {
    await Promise.all([reloadGifts(), reloadTransactions()])
  }, [reloadGifts, reloadTransactions])
  const refresh = useUpSync(reloadInbox)

  if (gifts.loading || giftTransactions.loading || membersLoading || memberLoading) {
    return <LoadingScreen />
  }

  return (
    <GiftsScreen
      recipients={gifts.recipients ?? []}
      occasions={gifts.occasions ?? []}
      budgets={gifts.budgets ?? []}
      purchases={gifts.purchases ?? []}
      discretionaryBudget={gifts.discretionaryBudget}
      transactions={giftTransactions.transactions ?? []}
      dismissals={giftTransactions.dismissals ?? []}
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
      onUpsertDiscretionaryBudget={gifts.upsertDiscretionaryBudget}
      onDismissTransaction={giftTransactions.dismiss}
      onRestoreTransaction={giftTransactions.restore}
      onRefresh={() => void refresh.refresh()}
      refreshing={refresh.refreshing}
      refreshError={refresh.error}
    />
  )
}
