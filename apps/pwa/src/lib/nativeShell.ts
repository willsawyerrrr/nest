/**
 * Types and detection for running inside the native iOS shell's `WKWebView`.
 *
 * The native app sets `window.__NEST_NATIVE_SHELL__` from a `.atDocumentStart`
 * user script, before any of the PWA's own code runs. It owns the one Supabase
 * session for the whole product and pushes it into the page through
 * `window.__nestApplySession` / `window.__nestClearSession`; the page asks it to
 * sign out through the `nestAuth` message handler.
 *
 * A browser or an installed Safari PWA never has the flag, so every branch
 * gated on {@link isNativeShell} is inert there and web behaviour is unchanged.
 */
declare global {
  interface Window {
    __NEST_NATIVE_SHELL__?: boolean
    __nestApplySession?: (accessToken: string, refreshToken: string) => void
    __nestClearSession?: () => void
    webkit?: {
      messageHandlers: {
        nestAuth: { postMessage: (message: unknown) => void }
      }
    }
  }
}

/** True when the PWA is running inside the native iOS shell's web view. */
export function isNativeShell(): boolean {
  return window.__NEST_NATIVE_SHELL__ === true
}
