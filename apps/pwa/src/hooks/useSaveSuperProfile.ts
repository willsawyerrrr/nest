import { useCallback } from 'react'
import type { SuperFormValues } from '../components/SuperProfileForm'
import { todayIso } from '../lib/dates'
import { superAccountName } from '../lib/super'
import type { UseAccountsResult } from './useAccounts'
import type { Member } from './useMembers'
import type { SuperProfile, UseSuperProfilesResult } from './useSuperProfiles'

interface UseSaveSuperProfileParams {
  /** The household's super profiles for the current financial year, or `null` while loading. */
  profiles: SuperProfile[] | null
  insertAccount: UseAccountsResult['insert']
  updateAccount: UseAccountsResult['update']
  upsertProfile: UseSuperProfilesResult['upsert']
}

/**
 * Composes the super-profile and account collections into a single member save:
 * writes the balance to the member's linked account (or creates a manual one and
 * links it), then upserts the profile's fund name, re-confirming the balance as
 * of today.
 */
export function useSaveSuperProfile({
  profiles,
  insertAccount,
  updateAccount,
  upsertProfile,
}: UseSaveSuperProfileParams): (member: Member, values: SuperFormValues) => Promise<void> {
  return useCallback(
    async (member: Member, values: SuperFormValues) => {
      const profile = profiles?.find((candidate) => candidate.member_id === member.id)
      const fundName = values.fundName === '' ? null : values.fundName
      const name = superAccountName(fundName, member.name)
      let accountId = profile?.linked_account_id ?? null
      if (accountId) {
        await updateAccount(accountId, { balance_cents: values.balanceCents, name })
      } else {
        accountId = await insertAccount({
          source: 'manual',
          type: 'savings',
          owner_member_id: member.id,
          name,
          balance_cents: values.balanceCents,
        })
      }
      await upsertProfile({
        member_id: member.id,
        fund_name: fundName,
        linked_account_id: accountId,
        // Saving re-confirms the actual balance, so this is a true-up as of today.
        balance_as_of: todayIso(),
      })
    },
    [profiles, insertAccount, updateAccount, upsertProfile],
  )
}
