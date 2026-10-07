import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installNativeShareBridge, resetNativeShare } from '../lib/nativeShare'
import { useSharedFiles } from './useSharedFiles'

afterEach(() => {
  resetNativeShare()
  delete window.__NEST_NATIVE_SHELL__
  delete window.__nestShare
  delete window.webkit
})

function setup() {
  const postMessage = vi.fn()
  window.__NEST_NATIVE_SHELL__ = true
  window.webkit = {
    messageHandlers: { nestAuth: { postMessage: vi.fn() }, nestShare: { postMessage } },
  }
  installNativeShareBridge()
  const share = window.__nestShare!
  const send = (id: string, name: string) => {
    share.begin(id, name, 'application/pdf')
    share.chunk(id, btoa('x'))
    share.finish(id)
  }
  return { postMessage, send }
}

describe('useSharedFiles', () => {
  it('hands over files already waiting and acknowledges them', () => {
    const { postMessage, send } = setup()
    send('a', 'a.pdf')
    const onFiles = vi.fn()

    renderHook(() => useSharedFiles(true, onFiles))

    expect(onFiles.mock.calls[0]![0].map((file: File) => file.name)).toEqual(['a.pdf'])
    expect(postMessage).toHaveBeenCalledWith({ type: 'queued', ids: ['a'] })
  })

  it('hands over a file that arrives later', () => {
    const { postMessage, send } = setup()
    const onFiles = vi.fn()
    renderHook(() => useSharedFiles(true, onFiles))
    expect(onFiles).not.toHaveBeenCalled()

    send('b', 'b.pdf')

    expect(onFiles).toHaveBeenCalledTimes(1)
    expect(postMessage).toHaveBeenCalledWith({ type: 'queued', ids: ['b'] })
  })

  it('leaves files waiting while disabled', () => {
    const { postMessage, send } = setup()
    send('a', 'a.pdf')
    const onFiles = vi.fn()

    const { rerender } = renderHook(({ on }) => useSharedFiles(on, onFiles), {
      initialProps: { on: false },
    })
    expect(onFiles).not.toHaveBeenCalled()
    expect(postMessage).not.toHaveBeenCalled()

    rerender({ on: true })
    expect(onFiles).toHaveBeenCalledTimes(1)
  })

  it('stops listening on unmount', () => {
    const { send } = setup()
    const onFiles = vi.fn()
    const { unmount } = renderHook(() => useSharedFiles(true, onFiles))

    unmount()
    send('a', 'a.pdf')

    expect(onFiles).not.toHaveBeenCalled()
  })
})
