import { describe, expect, it } from 'vitest'
import {
  isManagementUrlValid,
  MANAGEMENT_URL_MAX_LENGTH,
  normaliseManagementUrl,
} from './managementUrl'

describe('normaliseManagementUrl', () => {
  it('keeps and trims an http(s) URL', () => {
    expect(normaliseManagementUrl('  https://www.netflix.com/account ')).toBe(
      'https://www.netflix.com/account',
    )
    expect(normaliseManagementUrl('http://example.com')).toBe('http://example.com')
  })

  it('prefixes a bare domain with https', () => {
    expect(normaliseManagementUrl('netflix.com/account?x=1')).toBe(
      'https://netflix.com/account?x=1',
    )
    expect(normaliseManagementUrl('www.spotify.com')).toBe('https://www.spotify.com')
  })

  it.each([
    '',
    '   ',
    'javascript:alert(1)',
    'ftp://example.com',
    'mailto:a@b.com',
    'localhost',
    'not a url',
    'https://exa mple.com',
    'example.com:8080',
    'https://',
  ])('rejects %j', (value) => {
    expect(normaliseManagementUrl(value)).toBeNull()
  })

  it('rejects a URL over the length limit', () => {
    const long = `https://example.com/${'a'.repeat(MANAGEMENT_URL_MAX_LENGTH)}`
    expect(normaliseManagementUrl(long)).toBeNull()
  })
})

describe('isManagementUrlValid', () => {
  it('accepts blank and valid values and rejects the rest', () => {
    expect(isManagementUrlValid('')).toBe(true)
    expect(isManagementUrlValid('  ')).toBe(true)
    expect(isManagementUrlValid('netflix.com')).toBe(true)
    expect(isManagementUrlValid('javascript:alert(1)')).toBe(false)
  })
})
