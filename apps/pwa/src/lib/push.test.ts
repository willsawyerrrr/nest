import { describe, expect, it } from 'vitest'
import { base64UrlToBytes, bytesToBase64Url, notificationUrl, parsePushPayload } from './push'

const FALLBACK = { title: 'nest', body: 'Open nest to see what changed.', url: '/' }

describe('parsePushPayload', () => {
  it('reads a complete payload', () => {
    expect(parsePushPayload('{"title":"Rent due","body":"Pay it","url":"/budget"}')).toEqual({
      title: 'Rent due',
      body: 'Pay it',
      url: '/budget',
    })
  })

  it('falls back for an absent payload', () => {
    expect(parsePushPayload(undefined)).toEqual(FALLBACK)
    expect(parsePushPayload(null)).toEqual(FALLBACK)
    expect(parsePushPayload('')).toEqual(FALLBACK)
  })

  it('falls back for an unparseable payload', () => {
    expect(parsePushPayload('not json')).toEqual(FALLBACK)
  })

  it('falls back for a payload that is not an object', () => {
    expect(parsePushPayload('42')).toEqual(FALLBACK)
    expect(parsePushPayload('null')).toEqual(FALLBACK)
  })

  it('falls back field by field, keeping what the payload does carry', () => {
    expect(parsePushPayload('{"title":"Rent due"}')).toEqual({ ...FALLBACK, title: 'Rent due' })
    expect(parsePushPayload('{"title":42,"body":"","url":"/goals"}')).toEqual({
      ...FALLBACK,
      url: '/goals',
    })
  })
})

describe('notificationUrl', () => {
  it('reads the url a push handler attached', () => {
    expect(notificationUrl({ url: '/gifts' })).toBe('/gifts')
  })

  it('falls back to the app root when the data is missing or malformed', () => {
    expect(notificationUrl(undefined)).toBe('/')
    expect(notificationUrl(null)).toBe('/')
    expect(notificationUrl('/gifts')).toBe('/')
    expect(notificationUrl({})).toBe('/')
    expect(notificationUrl({ url: 7 })).toBe('/')
  })
})

describe('base64UrlToBytes', () => {
  it('decodes each byte of an unpadded base64url string', () => {
    // "hello" → aGVsbG8 (7 characters, so one '=' of padding is restored).
    expect([...base64UrlToBytes('aGVsbG8')]).toEqual([104, 101, 108, 108, 111])
  })

  it('restores the base64url alphabet before decoding', () => {
    // 0xfb 0xff decodes from '+/8=' in base64, written '-_8' in base64url.
    expect([...base64UrlToBytes('-_8')]).toEqual([251, 255])
  })

  it('decodes a full-length VAPID key to the 65 bytes subscribe expects', () => {
    const key = bytesToBase64Url(
      new Uint8Array([4, ...Array.from({ length: 64 }, (_, index) => index)]).buffer,
    )

    const bytes = base64UrlToBytes(key)

    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes).toHaveLength(65)
    expect(bytes[0]).toBe(4)
    expect(bytes[64]).toBe(63)
  })

  it('needs no padding for a length already a multiple of four', () => {
    expect([...base64UrlToBytes('aGVsbG8h')]).toEqual([104, 101, 108, 108, 111, 33])
  })
})

describe('bytesToBase64Url', () => {
  it('encodes bytes without padding and without + or /', () => {
    expect(bytesToBase64Url(new Uint8Array([251, 255]).buffer)).toBe('-_8')
    expect(bytesToBase64Url(new Uint8Array([104, 101, 108, 108, 111]).buffer)).toBe('aGVsbG8')
  })

  it('round-trips every byte value', () => {
    const bytes = new Uint8Array(Array.from({ length: 256 }, (_, index) => index))

    expect([...base64UrlToBytes(bytesToBase64Url(bytes.buffer))]).toEqual([...bytes])
  })

  it('encodes an empty buffer as an empty string', () => {
    expect(bytesToBase64Url(new ArrayBuffer(0))).toBe('')
  })
})
