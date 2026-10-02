import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Config } from './config.ts'
import type { NestContext } from './context.ts'

const storedSession = z.object({
  /** The environment refresh token this session was started from. */
  bootstrap: z.string().nullable(),
  access_token: z.string(),
  refresh_token: z.string(),
})

type StoredSession = z.infer<typeof storedSession>

async function readStored(file: string): Promise<StoredSession | null> {
  try {
    const parsed = storedSession.safeParse(JSON.parse(await readFile(file, 'utf8')))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

async function writeStored(file: string, session: StoredSession): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  await writeFile(file, JSON.stringify(session), { mode: 0o600 })
}

/**
 * Signs the client in as the configured household member. Supabase rotates a
 * refresh token on every use, so the live session is kept in `sessionFile` and
 * resumed from there on the next run; the environment token seeds it, and a
 * different environment token replaces a stored session started from an older one.
 */
async function signIn(supabase: SupabaseClient, config: Config): Promise<void> {
  const stored = await readStored(config.sessionFile)
  const resumable = stored !== null && stored.bootstrap === (config.refreshToken ?? null)
  if (resumable) {
    const { error } = await supabase.auth.setSession({
      access_token: stored.access_token,
      refresh_token: stored.refresh_token,
    })
    if (!error) return
  }
  if (config.refreshToken !== undefined) {
    const { error } = await supabase.auth.refreshSession({ refresh_token: config.refreshToken })
    if (error) throw new Error('Could not sign in with NEST_REFRESH_TOKEN.')
    return
  }
  const { error } = await supabase.auth.setSession({
    access_token: config.accessToken!,
    refresh_token: '',
  })
  if (error) throw new Error('Could not sign in with NEST_ACCESS_TOKEN.')
}

/**
 * Builds the context the tools run with: an anon-key client signed in as a
 * household member (never a service role), and that member's household.
 */
export async function createContext(
  config: Config,
  readFileBytes: NestContext['readFile'],
): Promise<NestContext> {
  const supabase = createClient(config.supabaseUrl, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
  })
  await signIn(supabase, config)

  const persist = async (session: Session | null): Promise<void> => {
    if (!session?.refresh_token) return
    await writeStored(config.sessionFile, {
      bootstrap: config.refreshToken ?? null,
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    }).catch(() => undefined)
  }
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') void persist(session)
  })
  await persist((await supabase.auth.getSession()).data.session)

  const { data: user } = await supabase.auth.getUser()
  if (!user.user) throw new Error('The session does not identify a user.')
  const { data: member, error } = await supabase
    .from('members')
    .select('id, household_id')
    .eq('user_id', user.user.id)
    .maybeSingle()
  if (error || !member) throw new Error('The signed-in user is not a household member.')

  return {
    supabase,
    householdId: member.household_id as string,
    memberId: member.id as string,
    now: () => new Date(),
    readFile: readFileBytes,
    randomUUID: () => crypto.randomUUID(),
  }
}
