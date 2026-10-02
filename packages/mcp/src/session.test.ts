import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Config } from './config.ts'

const auth = {
  setSession: vi.fn(),
  refreshSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  getSession: vi.fn(),
  getUser: vi.fn(),
}
const maybeSingle = vi.fn()
const createClient = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => {
    createClient(...args)
    return {
      auth,
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
    }
  },
}))

const { createContext } = await import('./session.ts')

async function config(overrides: Partial<Config> = {}): Promise<Config> {
  const dir = await mkdtemp(join(tmpdir(), 'nest-mcp-'))
  return {
    supabaseUrl: 'https://x.supabase.co',
    anonKey: 'anon',
    refreshToken: 'env-refresh',
    accessToken: undefined,
    sessionFile: join(dir, 'nested', 'session.json'),
    ...overrides,
  }
}

const readBytes = async () => new Uint8Array()
const sessionOf = { access_token: 'acc', refresh_token: 'ref' }

beforeEach(() => {
  vi.clearAllMocks()
  auth.setSession.mockResolvedValue({ error: null })
  auth.refreshSession.mockResolvedValue({ error: null })
  auth.getSession.mockResolvedValue({ data: { session: sessionOf } })
  auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
  maybeSingle.mockResolvedValue({ data: { id: 'm1', household_id: 'h1' }, error: null })
})

describe('createContext', () => {
  it('signs in with the refresh token on the anon key and resolves the member', async () => {
    const cfg = await config()
    const ctx = await createContext(cfg, readBytes)
    expect(createClient.mock.calls[0]?.[0]).toBe('https://x.supabase.co')
    expect(createClient.mock.calls[0]?.[1]).toBe('anon')
    expect(auth.refreshSession).toHaveBeenCalledWith({ refresh_token: 'env-refresh' })
    expect(ctx).toMatchObject({ householdId: 'h1', memberId: 'm1' })
    expect(ctx.now()).toBeInstanceOf(Date)
    expect(ctx.randomUUID()).toMatch(/^[0-9a-f-]{36}$/)
    const stored = JSON.parse(await readFile(cfg.sessionFile, 'utf8'))
    expect(stored).toEqual({ bootstrap: 'env-refresh', ...sessionOf })
  })

  it('resumes a stored session started from the same environment token', async () => {
    const cfg = await config()
    await createContext(cfg, readBytes)
    auth.refreshSession.mockClear()
    await createContext(cfg, readBytes)
    expect(auth.setSession).toHaveBeenCalledWith(sessionOf)
    expect(auth.refreshSession).not.toHaveBeenCalled()
  })

  it('falls back to the environment token when the stored session is refused', async () => {
    const cfg = await config()
    await createContext(cfg, readBytes)
    auth.setSession.mockResolvedValueOnce({ error: { message: 'stale' } })
    await createContext(cfg, readBytes)
    expect(auth.refreshSession).toHaveBeenCalledTimes(2)
  })

  it('ignores a stored session from a different environment token', async () => {
    const cfg = await config()
    await createContext(cfg, readBytes)
    await createContext({ ...cfg, refreshToken: 'new-env' }, readBytes)
    expect(auth.setSession).not.toHaveBeenCalled()
    expect(auth.refreshSession).toHaveBeenLastCalledWith({ refresh_token: 'new-env' })
  })

  it('ignores an unreadable stored session', async () => {
    const cfg = await config()
    await createContext(cfg, readBytes)
    await writeFile(cfg.sessionFile, 'not json')
    await createContext(cfg, readBytes)
    expect(auth.setSession).not.toHaveBeenCalled()
  })

  it('signs in with an access token alone', async () => {
    const cfg = await config({ refreshToken: undefined, accessToken: 'tok' })
    await createContext(cfg, readBytes)
    expect(auth.setSession).toHaveBeenCalledWith({ access_token: 'tok', refresh_token: '' })
  })

  it('persists a refreshed session', async () => {
    const cfg = await config()
    await createContext(cfg, readBytes)
    const listener = auth.onAuthStateChange.mock.calls[0]![0] as (e: string, s: unknown) => void
    listener('TOKEN_REFRESHED', { access_token: 'a2', refresh_token: 'r2' })
    listener('SIGNED_OUT', null)
    await vi.waitFor(async () =>
      expect(JSON.parse(await readFile(cfg.sessionFile, 'utf8')).refresh_token).toBe('r2'),
    )
  })

  it('does not persist a session with no refresh token', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } })
    const cfg = await config()
    await createContext(cfg, readBytes)
    await expect(readFile(cfg.sessionFile, 'utf8')).rejects.toThrow()
  })

  it.each([
    ['refresh token', {}],
    ['access token', { refreshToken: undefined, accessToken: 't' }],
  ])('fails when the %s is refused', async (_name, overrides) => {
    auth.refreshSession.mockResolvedValue({ error: { message: 'bad' } })
    auth.setSession.mockResolvedValue({ error: { message: 'bad' } })
    await expect(createContext(await config(overrides), readBytes)).rejects.toThrow(/sign in/)
  })

  it('fails when the session names no user', async () => {
    auth.getUser.mockResolvedValue({ data: { user: null } })
    await expect(createContext(await config(), readBytes)).rejects.toThrow(/identify a user/)
  })

  it('fails when the user is not a household member', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })
    await expect(createContext(await config(), readBytes)).rejects.toThrow(/household member/)
  })
})
