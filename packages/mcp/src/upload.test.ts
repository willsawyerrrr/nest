import { describe, expect, it } from 'vitest'
import { canExtract, MAX_UPLOAD_BYTES, storageKeyName, storedContentType } from './upload.ts'

describe('upload rules', () => {
  it('limits a file to 25 MiB', () => {
    expect(MAX_UPLOAD_BYTES).toBe(25 * 1024 * 1024)
  })

  it('decides content type and readability from the extension alone', () => {
    expect(storedContentType('a.PDF')).toBe('application/pdf')
    expect(storedContentType('a.jpeg')).toBe('image/jpeg')
    expect(storedContentType('a.png')).toBe('image/png')
    expect(storedContentType('a.html')).toBe('application/octet-stream')
    expect(storedContentType('noextension')).toBe('application/octet-stream')
    expect(canExtract('a.webp')).toBe(true)
    expect(canExtract('a.gif')).toBe(true)
    expect(canExtract('a.svg')).toBe(false)
    expect(canExtract('a.heic')).toBe(false)
  })

  it('makes a storage-safe key name that keeps the extension', () => {
    expect(storageKeyName('Café receipt (1).pdf')).toBe('Cafe_receipt_1_.pdf')
    expect(storageKeyName('.hidden')).toBe('hidden')
    expect(storageKeyName('???')).toBe('file')
    expect(storageKeyName('.')).toBe('file')
    const long = storageKeyName(`${'a'.repeat(300)}.pdf`)
    expect(long).toHaveLength(100)
    expect(long.endsWith('.pdf')).toBe(true)
  })
})
