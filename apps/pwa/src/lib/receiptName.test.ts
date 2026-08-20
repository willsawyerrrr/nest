import { describe, expect, it } from 'vitest'
import { receiptName } from './receiptName'

describe('receiptName', () => {
  it('keeps a chosen name, trimmed', () => {
    expect(receiptName('  Officeworks invoice  ')).toBe('Officeworks invoice')
  })

  it('falls back to Receipt when nothing was chosen', () => {
    expect(receiptName('   ')).toBe('Receipt')
    expect(receiptName('')).toBe('Receipt')
  })
})
