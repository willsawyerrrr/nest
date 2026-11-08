import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { summaryParityCases, taxParityCases } from '../../household/src/goldenCases.ts'
import { parityCases } from './cases.ts'
import { entryPoints, serialise } from './index.ts'

const ROOT = join(import.meta.dirname, '..', '..', '..')
const BUNDLE = join(ROOT, 'apps/ios/Nest/Engine/nest-engines.js')
const FIXTURES = join(ROOT, 'apps/ios/NestTests/Fixtures/engine-parity.json')

/** The output the TypeScript engines produce for each case, as the bridge serialises it. */
const goldens = parityCases.map((parityCase) => ({
  ...parityCase,
  expected: JSON.parse(entryPoints[parityCase.entry](JSON.stringify(parityCase.input))),
}))

describe('the shared parity fixtures', () => {
  it('match what the TypeScript engines produce', () => {
    const text = `${JSON.stringify(goldens, null, 2)}\n`
    if (process.env.UPDATE_FIXTURES) {
      writeFileSync(FIXTURES, text)
    }
    expect(readFileSync(FIXTURES, 'utf8')).toBe(text)
  })

  it('reproduce the household golden cases through the bridge', () => {
    const byName = new Map(goldens.map((golden) => [golden.name, golden.expected]))
    for (const parityCase of taxParityCases) {
      expect(byName.get(`tax estimate: ${parityCase.label}`)).toEqual(parityCase.expected)
    }
    for (const parityCase of summaryParityCases) {
      expect(byName.get(`fortnightly buffer: ${parityCase.label}`)).toEqual(parityCase.expected)
    }
  })

  it('carry a trade whose micro-unit product exceeds 2^53', () => {
    const trade = parityCases.find((parityCase) => parityCase.name.includes('microdollar'))
    expect(trade).toBeDefined()
    expect(1000 * 1e6 * 40_000_000_001).toBeGreaterThan(Number.MAX_SAFE_INTEGER)
  })
})

describe('the committed bundle', () => {
  const context: { NestEngine?: typeof entryPoints } = {}
  runInNewContext(readFileSync(BUNDLE, 'utf8'), context)

  it.each(goldens)('returns the TypeScript output for $name', (golden) => {
    const output = context.NestEngine![golden.entry](JSON.stringify(golden.input))
    expect(JSON.parse(output)).toEqual(golden.expected)
  })
})

describe('serialise', () => {
  it('writes a bigint as an exact decimal string', () => {
    expect(serialise({ cents: 9_007_199_254_740_993n, nested: [1n] })).toBe(
      '{"cents":"9007199254740993","nested":["1"]}',
    )
  })

  it('leaves other values as JSON', () => {
    expect(serialise({ a: 1, b: null, c: 'x' })).toBe('{"a":1,"b":null,"c":"x"}')
  })
})
