import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bearerToken, verifyToken } from './auth.ts'

const mocks = vi.hoisted(() => ({ getClaims: vi.fn(), createClient: vi.fn() }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => {
    mocks.createClient(...args)
    return { auth: { getClaims: mocks.getClaims } }
  },
}))

const config = { supabaseUrl: 'https://p.supabase.co/', anonKey: 'anon' }
const claims = { sub: 'u1', role: 'authenticated', iss: 'https://p.supabase.co/auth/v1' }

beforeEach(() => vi.clearAllMocks())

describe('bearerToken', () => {
  it.each([
    ['Bearer abc', 'abc'],
    ['bearer abc', 'abc'],
    ['Basic abc', null],
    ['Bearer', null],
    ['Bearer a b', null],
    [null, null],
  ])('reads %j as %j', (header, expected) => {
    expect(bearerToken(header)).toBe(expected)
  })
})

describe('verifyToken', () => {
  it('returns the member and a client built from the anon key and their token', async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims }, error: null })
    const verified = await verifyToken(config, 'tok')
    expect(verified?.userId).toBe('u1')
    expect(mocks.getClaims).toHaveBeenCalledWith('tok')
    const [url, key, options] = mocks.createClient.mock.calls[0]!
    expect(url).toBe(config.supabaseUrl)
    expect(key).toBe('anon')
    expect(options.global.headers.Authorization).toBe('Bearer tok')
  })

  it.each([
    ['a signature that fails', { data: null, error: new Error('bad') }],
    ['no claims', { data: { claims: null }, error: null }],
    ['no subject', { data: { claims: { ...claims, sub: undefined } }, error: null }],
    ['a non-member role', { data: { claims: { ...claims, role: 'anon' } }, error: null }],
    [
      'another issuer',
      { data: { claims: { ...claims, iss: 'https://evil/auth/v1' } }, error: null },
    ],
  ])('rejects %s', async (_name, result) => {
    mocks.getClaims.mockResolvedValue(result)
    expect(await verifyToken(config, 'tok')).toBeNull()
  })

  it('rejects when verification throws', async () => {
    mocks.getClaims.mockRejectedValue(new Error('network'))
    expect(await verifyToken(config, 'tok')).toBeNull()
  })
})
