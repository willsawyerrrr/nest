import { useNavigate } from 'react-router-dom'
import { LoadingScreen } from '../components/LoadingScreen'
import { WishlistScreen } from '../components/WishlistScreen'
import { useMembers } from '../hooks/useMembers'
import { useWishlist, type WishlistItem } from '../hooks/useWishlist'
import { setBudgetDraft, setGoalDraft } from '../lib/promoteDraft'

export function WishlistSection({ householdId }: { householdId: string }) {
  const { members, loading: membersLoading } = useMembers()
  const wishlist = useWishlist(householdId)
  const navigate = useNavigate()

  if (membersLoading || wishlist.loading || !members) {
    return <LoadingScreen />
  }

  const promote = (target: '/goals' | '/budget', item: WishlistItem) => {
    const draft = { name: item.name, amountCents: item.amount_cents }
    if (target === '/goals') {
      setGoalDraft(draft)
    } else {
      setBudgetDraft(draft)
    }
    navigate(target)
  }

  return (
    <WishlistScreen
      items={wishlist.items ?? []}
      members={members}
      onCreate={wishlist.create}
      onUpdate={wishlist.update}
      onDelete={wishlist.remove}
      onPromoteToGoal={(item) => promote('/goals', item)}
      onPromoteToBudget={(item) => promote('/budget', item)}
    />
  )
}
