import { isNativeShell } from './nativeShell'
import { supabase } from './supabase'

/**
 * Wires the hooks the native iOS shell calls to push the Supabase session it
 * owns into the page and to clear it. Outside the shell this is a no-op, and
 * safe to call more than once.
 *
 * The shell client is created with `persistSession: false` and
 * `autoRefreshToken: false` (see `lib/supabase.ts`), so the page holds only
 * whatever session the native layer has handed it: `setSession` on every native
 * `authStateChanges` emission, and a local sign-out when the native session
 * goes. Clearing is scoped local so it never revokes the refresh token the
 * native app is still rotating.
 */
export function installNativeAuthBridge(): void {
  if (!isNativeShell()) {
    return
  }

  window.__nestApplySession = (accessToken, refreshToken) => {
    void supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
  }

  window.__nestClearSession = () => {
    void supabase.auth.signOut({ scope: 'local' })
  }
}

/**
 * Signs the member out from wherever the session lives. In the native shell the
 * native layer owns the session, so this asks it to clear it (it then swaps the
 * web view back for its own sign-in gate); in a browser the web client signs
 * itself out.
 */
export function signOut(): void {
  if (!isNativeShell()) {
    void supabase.auth.signOut()
    return
  }

  // In the shell the native user script always registers the handler; the `?.`
  // only guards the impossible case of the flag being set without `webkit`.
  window.webkit?.messageHandlers.nestAuth.postMessage({ type: 'signOut' })
}
