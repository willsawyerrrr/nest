import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUpdateAvailable } from './useUpdateAvailable'

const changelog = vi.hoisted(() => ({ useChangelog: vi.fn() }))

vi.mock('./useChangelog', () => ({ useChangelog: changelog.useChangelog }))

function loaded(available: string[]) {
  changelog.useChangelog.mockReturnValue({
    available: available.map((type) => ({ type })),
    implemented: [{ type: 'feat' }],
    inProgress: [{ type: 'feat' }],
  })
}

describe('useUpdateAvailable', () => {
  beforeEach(() => vi.resetAllMocks())

  it('is true when an available change is a new feature', () => {
    loaded(['fix', 'feat'])
    expect(renderHook(() => useUpdateAvailable()).result.current).toBe(true)
  })

  it('is false when nothing is available, whatever is implemented or in progress', () => {
    loaded([])
    expect(renderHook(() => useUpdateAvailable()).result.current).toBe(false)
  })

  it('is false when the available changes are not new features', () => {
    loaded(['fix', 'chore'])
    expect(renderHook(() => useUpdateAvailable()).result.current).toBe(false)
  })
})
