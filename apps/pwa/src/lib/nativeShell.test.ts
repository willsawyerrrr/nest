import { afterEach, describe, expect, it } from 'vitest'
import { isNativeShell } from './nativeShell'

afterEach(() => {
  delete window.__NEST_NATIVE_SHELL__
})

describe('isNativeShell', () => {
  it('is false when the flag is unset', () => {
    expect(isNativeShell()).toBe(false)
  })

  it('is true only when the flag is exactly true', () => {
    window.__NEST_NATIVE_SHELL__ = true
    expect(isNativeShell()).toBe(true)
  })

  it('is false for a truthy-but-not-true flag', () => {
    ;(window as unknown as { __NEST_NATIVE_SHELL__: unknown }).__NEST_NATIVE_SHELL__ = 1
    expect(isNativeShell()).toBe(false)
  })
})
