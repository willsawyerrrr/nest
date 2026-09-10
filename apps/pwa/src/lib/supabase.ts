import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { isNativeShell } from './nativeShell'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. See .env.example.')
}

// Inside the native iOS shell the native app owns the one Supabase session and
// its refresh — a Siri intent must refresh a token with the web view unloaded,
// and two clients rotating the same refresh token evict each other. So the shell
// client neither persists nor refreshes; it runs on whatever session the native
// layer injects (see `lib/nativeAuthBridge.ts`). A browser is unaffected.
export const supabase = createClient<Database>(
  url,
  anonKey,
  isNativeShell() ? { auth: { persistSession: false, autoRefreshToken: false } } : undefined,
)
