import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeMember } from '../test/fixtures'
import { useSaveSuperProfile } from './useSaveSuperProfile'
import type { SuperProfile } from './useSuperProfiles'

const isoDate = /^\d{4}-\d{2}-\d{2}$/

describe('useSaveSuperProfile', () => {
  it('renames an existing linked account and upserts its balance', async () => {
    const insertAccount = vi.fn().mockResolvedValue('unused')
    const updateAccount = vi.fn().mockResolvedValue(undefined)
    const upsertBalance = vi.fn().mockResolvedValue(undefined)
    const upsertProfile = vi.fn().mockResolvedValue(undefined)
    const profiles = [{ member_id: 'm1', linked_account_id: 'acc1' } as unknown as SuperProfile]
    const { result } = renderHook(() =>
      useSaveSuperProfile({ profiles, insertAccount, updateAccount, upsertBalance, upsertProfile }),
    )

    await act(async () => {
      await result.current(makeMember({ id: 'm1', name: 'Will' }), {
        fundName: 'AusSuper',
        balanceCents: 1000,
      })
    })

    expect(updateAccount).toHaveBeenCalledWith('acc1', { name: 'AusSuper' })
    expect(upsertBalance).toHaveBeenCalledWith('acc1', 1000)
    expect(insertAccount).not.toHaveBeenCalled()
    expect(upsertProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        member_id: 'm1',
        fund_name: 'AusSuper',
        linked_account_id: 'acc1',
        balance_as_of: expect.stringMatching(isoDate),
      }),
    )
  })

  it('creates a manual account when none is linked, defaulting a blank fund to null', async () => {
    const insertAccount = vi.fn().mockResolvedValue('newacc')
    const updateAccount = vi.fn().mockResolvedValue(undefined)
    const upsertBalance = vi.fn().mockResolvedValue(undefined)
    const upsertProfile = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useSaveSuperProfile({
        profiles: null,
        insertAccount,
        updateAccount,
        upsertBalance,
        upsertProfile,
      }),
    )

    await act(async () => {
      await result.current(makeMember({ id: 'm1', name: 'Will' }), {
        fundName: '',
        balanceCents: 500,
      })
    })

    expect(insertAccount).toHaveBeenCalledWith({
      source: 'manual',
      type: 'savings',
      owner_member_id: 'm1',
      name: 'Will Super',
    })
    expect(upsertBalance).toHaveBeenCalledWith('newacc', 500)
    expect(updateAccount).not.toHaveBeenCalled()
    expect(upsertProfile).toHaveBeenCalledWith(
      expect.objectContaining({ fund_name: null, linked_account_id: 'newacc' }),
    )
  })
})
