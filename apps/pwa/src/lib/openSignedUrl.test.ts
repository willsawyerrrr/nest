import { afterEach, describe, expect, it, vi } from 'vitest'
import { openSignedUrl } from './openSignedUrl'

function fakeTab() {
  return { location: { href: '' }, close: vi.fn(), opener: {} } as unknown as Window
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete window.__NEST_NATIVE_SHELL__
  delete window.webkit
})

describe('openSignedUrl in a browser', () => {
  it('opens the tab before the URL is fetched, then points it at the URL', async () => {
    const tab = fakeTab()
    const open = vi.spyOn(window, 'open').mockReturnValue(tab)
    let resolveUrl: (url: string) => void = () => {}
    const pending = openSignedUrl(() => new Promise((resolve) => (resolveUrl = resolve)))

    expect(open).toHaveBeenCalledWith('', '_blank')
    expect(tab.opener).toBeNull()
    expect(tab.location.href).toBe('')

    resolveUrl('https://signed/url')
    await pending
    expect(tab.location.href).toBe('https://signed/url')
  })

  it('closes the tab when there is no URL', async () => {
    const tab = fakeTab()
    vi.spyOn(window, 'open').mockReturnValue(tab)
    await openSignedUrl(() => Promise.resolve(null))
    expect(tab.close).toHaveBeenCalled()
    expect(tab.location.href).toBe('')
  })

  it('opens the URL in the current tab when the browser refuses a new one', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    const assign = vi.fn()
    vi.stubGlobal('location', { assign })
    await openSignedUrl(() => Promise.resolve('https://signed/url'))
    expect(assign).toHaveBeenCalledWith('https://signed/url')
  })

  it('does nothing further when the tab is refused and there is no URL', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    const assign = vi.fn()
    vi.stubGlobal('location', { assign })
    await openSignedUrl(() => Promise.resolve(null))
    expect(assign).not.toHaveBeenCalled()
  })
})

describe('openSignedUrl in the native shell', () => {
  it('hands the URL to the native app without opening a tab', async () => {
    window.__NEST_NATIVE_SHELL__ = true
    const postMessage = vi.fn()
    window.webkit = {
      messageHandlers: { nestAuth: { postMessage: vi.fn() }, nestOpen: { postMessage } },
    }
    const open = vi.spyOn(window, 'open')

    await openSignedUrl(() => Promise.resolve('https://signed/url'))

    expect(postMessage).toHaveBeenCalledWith({ url: 'https://signed/url' })
    expect(open).not.toHaveBeenCalled()
  })

  it('sends nothing when there is no URL', async () => {
    window.__NEST_NATIVE_SHELL__ = true
    const postMessage = vi.fn()
    window.webkit = {
      messageHandlers: { nestAuth: { postMessage: vi.fn() }, nestOpen: { postMessage } },
    }

    await openSignedUrl(() => Promise.resolve(null))

    expect(postMessage).not.toHaveBeenCalled()
  })

  it('tolerates a missing webkit bridge', async () => {
    window.__NEST_NATIVE_SHELL__ = true
    await expect(
      openSignedUrl(() => Promise.resolve('https://signed/url')),
    ).resolves.toBeUndefined()
  })
})
