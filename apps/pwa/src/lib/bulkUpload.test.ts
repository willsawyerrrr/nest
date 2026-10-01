import { describe, expect, it } from 'vitest'
import { batchLimitMessage, MAX_BATCH_FILES } from './bulkUpload'

describe('batchLimitMessage', () => {
  it('says how many files were left out, and why', () => {
    expect(batchLimitMessage(1)).toMatch(/^1 file was left out/)
    expect(batchLimitMessage(3)).toMatch(/^3 files were left out/)
    expect(batchLimitMessage(3)).toContain(`${MAX_BATCH_FILES} files`)
  })
})
