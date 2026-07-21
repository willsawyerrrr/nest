import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useInlineEditing } from './useInlineEditing'

describe('useInlineEditing', () => {
  it('keeps the add and edit forms mutually exclusive', () => {
    const { result } = renderHook(() => useInlineEditing<string>())
    expect(result.current.editingId).toBeNull()
    expect(result.current.adding).toBeNull()

    act(() => result.current.startAdding('ctx'))
    expect(result.current.adding).toBe('ctx')
    expect(result.current.editingId).toBeNull()

    act(() => result.current.startEditing('row1'))
    expect(result.current.editingId).toBe('row1')
    expect(result.current.adding).toBeNull()

    act(() => result.current.close())
    expect(result.current.editingId).toBeNull()
    expect(result.current.adding).toBeNull()
  })
})
