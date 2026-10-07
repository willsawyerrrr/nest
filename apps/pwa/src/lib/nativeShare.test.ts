import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  acknowledgeSharedFiles,
  installNativeShareBridge,
  pendingSharedFileCount,
  resetNativeShare,
  subscribeSharedFiles,
  takeSharedFiles,
  type SharedFile,
} from './nativeShare'

afterEach(() => {
  resetNativeShare()
  delete window.__NEST_NATIVE_SHELL__
  delete window.__nestShare
  delete window.webkit
})

function install() {
  window.__NEST_NATIVE_SHELL__ = true
  installNativeShareBridge()
  return window.__nestShare!
}

describe('installNativeShareBridge', () => {
  it('installs nothing outside the shell', () => {
    installNativeShareBridge()
    expect(window.__nestShare).toBeUndefined()
  })

  it('assembles a file from its chunks', async () => {
    const share = install()

    share.begin('a', 'receipt.pdf', 'application/pdf')
    share.chunk('a', btoa('hel'))
    share.chunk('a', btoa('lo'))
    share.finish('a')

    expect(pendingSharedFileCount()).toBe(1)
    const [shared] = takeSharedFiles() as [SharedFile]
    expect(shared.id).toBe('a')
    expect(shared.file.name).toBe('receipt.pdf')
    expect(shared.file.type).toBe('application/pdf')
    expect(await shared.file.text()).toBe('hello')
    expect(pendingSharedFileCount()).toBe(0)
  })

  it('ignores chunks and finishes for a file that never began', () => {
    const share = install()

    share.chunk('x', btoa('data'))
    share.finish('x')

    expect(pendingSharedFileCount()).toBe(0)
  })

  it('ignores a file handed over twice, even after it was taken', () => {
    const share = install()
    const send = () => {
      share.begin('a', 'a.png', 'image/png')
      share.chunk('a', btoa('x'))
      share.finish('a')
    }

    send()
    send()
    expect(takeSharedFiles()).toHaveLength(1)
    send()
    expect(pendingSharedFileCount()).toBe(0)
  })

  it('notifies listeners until they unsubscribe', () => {
    const share = install()
    const listener = vi.fn()
    const unsubscribe = subscribeSharedFiles(listener)

    share.begin('a', 'a.png', 'image/png')
    share.finish('a')
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    share.begin('b', 'b.png', 'image/png')
    share.finish('b')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('acknowledgeSharedFiles', () => {
  it('tells the native shell which files are queued', () => {
    const postMessage = vi.fn()
    window.webkit = {
      messageHandlers: { nestAuth: { postMessage: vi.fn() }, nestShare: { postMessage } },
    }

    acknowledgeSharedFiles(['a', 'b'])

    expect(postMessage).toHaveBeenCalledWith({ type: 'queued', ids: ['a', 'b'] })
  })

  it('does nothing without a native shell', () => {
    expect(() => acknowledgeSharedFiles(['a'])).not.toThrow()
  })
})
