import { describe, expect, it } from 'vitest'
import { FILENAME, isValidVersionTimestamp, listMigrationFiles } from './migration-files.js'

describe('FILENAME', () => {
  it('captures the 14-digit version of a well-formed migration name', () => {
    expect(FILENAME.exec('20260718131611_ledger_core.sql')?.[1]).toBe('20260718131611')
  })

  it('rejects a name with the wrong digit count, casing, or extension', () => {
    expect(FILENAME.test('2026071813161_ledger_core.sql')).toBe(false)
    expect(FILENAME.test('20260718131611_LedgerCore.sql')).toBe(false)
    expect(FILENAME.test('20260718131611_ledger_core.txt')).toBe(false)
  })
})

describe('isValidVersionTimestamp', () => {
  it('accepts a real YYYYMMDDHHMMSS moment', () => {
    expect(isValidVersionTimestamp('20260718131611')).toBe(true)
  })

  it('accepts the zero-padded short forms the repo uses for same-day ordering', () => {
    expect(isValidVersionTimestamp('20260915000000')).toBe(true)
    expect(isValidVersionTimestamp('20260911005000')).toBe(true)
  })

  it('rejects an impossible month', () => {
    expect(isValidVersionTimestamp('20261301000000')).toBe(false)
    expect(isValidVersionTimestamp('20260001000000')).toBe(false)
  })

  it('rejects a day that does not exist in its month', () => {
    expect(isValidVersionTimestamp('20260931000000')).toBe(false) // September has 30 days
    expect(isValidVersionTimestamp('20260229000000')).toBe(false) // 2026 is not a leap year
    expect(isValidVersionTimestamp('20260200000000')).toBe(false) // day 0
  })

  it('rejects out-of-range time components', () => {
    expect(isValidVersionTimestamp('20260718240000')).toBe(false)
    expect(isValidVersionTimestamp('20260718136011')).toBe(false)
    expect(isValidVersionTimestamp('20260718131160')).toBe(false)
  })
})

describe('listMigrationFiles', () => {
  it('returns the real migrations, every one well-formed and in version order', () => {
    const files = listMigrationFiles()
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const version = FILENAME.exec(file)?.[1]
      expect(version, file).toBeDefined()
      expect(isValidVersionTimestamp(version), file).toBe(true)
    }
    expect(files).toEqual([...files].sort())
  })
})
