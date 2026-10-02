import { describe, expect, it } from 'vitest'
import { readConfig } from './config.ts'

const base = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon' }

describe('readConfig', () => {
  it('reads a refresh-token configuration with the default session file', () => {
    expect(readConfig({ ...base, NEST_REFRESH_TOKEN: 'r' }, '/home/a')).toEqual({
      supabaseUrl: 'https://x.supabase.co',
      anonKey: 'anon',
      refreshToken: 'r',
      accessToken: undefined,
      sessionFile: '/home/a/.config/nest-mcp/session.json',
    })
  })

  it('honours XDG_CONFIG_HOME and an explicit session file', () => {
    expect(
      readConfig({ ...base, NEST_ACCESS_TOKEN: 'a', XDG_CONFIG_HOME: '/xdg' }, '/h').sessionFile,
    ).toBe('/xdg/nest-mcp/session.json')
    expect(
      readConfig({ ...base, NEST_ACCESS_TOKEN: 'a', NEST_SESSION_FILE: '/s.json' }, '/h')
        .sessionFile,
    ).toBe('/s.json')
  })

  it('requires a token', () => {
    expect(() => readConfig(base, '/h')).toThrow(/NEST_REFRESH_TOKEN/)
  })

  it('requires the URL and anon key', () => {
    expect(() => readConfig({ NEST_REFRESH_TOKEN: 'r' }, '/h')).toThrow(/SUPABASE_URL/)
  })

  it('ignores a service-role key if one is present', () => {
    const config = readConfig(
      { ...base, NEST_REFRESH_TOKEN: 'r', SUPABASE_SERVICE_ROLE_KEY: 'secret' },
      '/h',
    )
    expect(JSON.stringify(config)).not.toContain('secret')
  })
})
