import { describe, expect, it } from 'vitest'
import { runSummaryCase, runTaxCase, summaryParityCases, taxParityCases } from './goldenCases.ts'

describe('golden-fixture parity — tax estimate', () => {
  it.each(taxParityCases)('$label', (parityCase) => {
    expect(runTaxCase(parityCase)).toEqual(parityCase.expected)
  })
})

describe('golden-fixture parity — fortnightly buffer', () => {
  it.each(summaryParityCases)('$label', (parityCase) => {
    expect(runSummaryCase(parityCase)).toEqual(parityCase.expected)
  })
})
