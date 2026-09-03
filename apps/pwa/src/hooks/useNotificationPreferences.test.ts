import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWrapper } from '../test/queryWrapper'
import { NOTIFICATION_TRIGGERS, useNotificationPreferences } from './useNotificationPreferences'

const { builder } = await vi.hoisted(async () => {
  const { makeSupabaseBuilder } = await import('../test/supabaseBuilder')
  return { builder: makeSupabaseBuilder(['select', 'upsert', 'eq', 'order']) }
})

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(() => builder) } }))

beforeEach(() => {
  vi.clearAllMocks()
  builder.result = {
    data: [{ id: 'p1', member_id: 'm1', trigger: 'goal_eta_slipped', enabled: false }],
    error: null,
  }
})

describe('useNotificationPreferences', () => {
  it('names the four triggers in list order', () => {
    expect(NOTIFICATION_TRIGGERS).toEqual([
      'buffer_negative',
      'goal_eta_slipped',
      'temporary_item_expiring',
      'fy_boundary',
    ])
  })

  it('reads a stored choice and defaults an absent one to on', async () => {
    const { result } = renderHook(() => useNotificationPreferences('h1', 'm1'), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.enabled('goal_eta_slipped')).toBe(false)
    expect(result.current.enabled('buffer_negative')).toBe(true)
  })

  it('upserts the member’s choice for a trigger', async () => {
    const { result } = renderHook(() => useNotificationPreferences('h1', 'm1'), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.setEnabled('buffer_negative', false)
    })

    expect(builder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        household_id: 'h1',
        member_id: 'm1',
        trigger: 'buffer_negative',
        enabled: false,
      }),
      { onConflict: 'member_id,trigger' },
    )
  })

  it('refuses to write when the member row is not resolved yet', async () => {
    const { result } = renderHook(() => useNotificationPreferences('h1', null), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await expect(result.current.setEnabled('fy_boundary', true)).rejects.toThrow(/member row/i)
    expect(builder.upsert).not.toHaveBeenCalled()
  })
})
