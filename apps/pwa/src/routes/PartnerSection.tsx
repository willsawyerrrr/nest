import { PartnerScreen } from '../components/PartnerScreen'
import type { Household } from '../hooks/useHousehold'

export function PartnerSection({
  household,
  onCreateInviteCode,
  onRevokeInviteCode,
}: {
  household: Household
  onCreateInviteCode: () => Promise<void>
  onRevokeInviteCode: () => Promise<void>
}) {
  return (
    <PartnerScreen
      inviteCode={household.invite_code}
      inviteCodeExpiresAt={household.invite_code_expires_at}
      onCreateInviteCode={onCreateInviteCode}
      onRevokeInviteCode={onRevokeInviteCode}
    />
  )
}
