import { afterEach, describe, expect, it, vi } from 'vitest'
import { installNativeAuthBridge, signOut } from './nativeAuthBridge'

const hooks = vi.hoisted(() => ({
  setSession: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('./supabase', () => ({
  supabase: { auth: { setSession: hooks.setSession, signOut: hooks.signOut } },
}))

afterEach(() => {
  vi.clearAllMocks()
  delete window.__NEST_NATIVE_SHELL__
  delete window.__nestApplySession
  delete window.__nestClearSession
  delete window.webkit
})

describe('installNativeAuthBridge', () => {
  it('installs nothing outside the shell', () => {
    installNativeAuthBridge()
    expect(window.__nestApplySession).toBeUndefined()
    expect(window.__nestClearSession).toBeUndefined()
  })

  it('applies a pushed session through setSession', () => {
    window.__NEST_NATIVE_SHELL__ = true
    installNativeAuthBridge()

    window.__nestApplySession?.('access-1', 'refresh-1')

    expect(hooks.setSession).toHaveBeenCalledWith({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
    })
  })

  it('asks the native shell for the session once the hooks are installed', () => {
    const ready = vi.fn()
    const auth = vi.fn()
    window.__NEST_NATIVE_SHELL__ = true
    window.webkit = {
      messageHandlers: {
        nestAuth: { postMessage: auth },
        nestReady: { postMessage: ready },
        nestShare: { postMessage: vi.fn() },
      },
    }

    installNativeAuthBridge()

    expect(ready).toHaveBeenCalledWith({ type: 'ready' })
    expect(auth).not.toHaveBeenCalled()
  })

  it('installs the hooks without error when the native build has no ready handler', () => {
    window.__NEST_NATIVE_SHELL__ = true
    window.webkit = {
      messageHandlers: { nestAuth: { postMessage: vi.fn() }, nestShare: { postMessage: vi.fn() } },
    }

    expect(() => installNativeAuthBridge()).not.toThrow()
  })

  it('clears the session locally so the native refresh token survives', () => {
    window.__NEST_NATIVE_SHELL__ = true
    installNativeAuthBridge()

    window.__nestClearSession?.()

    expect(hooks.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })
})

describe('signOut', () => {
  it('signs out through the web client in a browser', () => {
    signOut()
    expect(hooks.signOut).toHaveBeenCalledOnce()
  })

  it('asks the native shell to sign out', () => {
    const postMessage = vi.fn()
    window.__NEST_NATIVE_SHELL__ = true
    window.webkit = {
      messageHandlers: { nestAuth: { postMessage }, nestShare: { postMessage: vi.fn() } },
    }

    signOut()

    expect(postMessage).toHaveBeenCalledWith({ type: 'signOut' })
    expect(hooks.signOut).not.toHaveBeenCalled()
  })

  it('does not throw in the shell when the native handler is absent', () => {
    window.__NEST_NATIVE_SHELL__ = true
    expect(() => signOut()).not.toThrow()
  })
})
