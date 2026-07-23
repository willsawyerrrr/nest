import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

afterEach(cleanup)

// Node's experimental, unprovisioned `localStorage` global shadows happy-dom's,
// leaving `window.localStorage` unusable. Back it with an in-memory Storage so
// components that persist preferences behave as they do in a browser.
if (!window.localStorage) {
  const store = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    removeItem: (key) => void store.delete(key),
    setItem: (key, value) => void store.set(key, String(value)),
  }
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
}

// happy-dom resolves media queries against its default viewport, which would
// select the wide layout. Pin matchMedia to the narrow default so components
// render deterministically, and restore it after each test in case one opted
// into the wide layout via `setWideViewport`.
function narrowMatchMedia(query: string): MediaQueryList {
  return {
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList
}

window.matchMedia = narrowMatchMedia
afterEach(() => {
  window.matchMedia = narrowMatchMedia
})
