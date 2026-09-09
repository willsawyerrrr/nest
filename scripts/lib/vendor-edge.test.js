import { describe, expect, it } from 'vitest'
import { HEADER, vendorDrift, vendoredContent } from './vendor-edge.js'

describe('vendoredContent', () => {
  it('prepends the banner with the package and file path filled in', () => {
    const out = vendoredContent('plan', 'normalize.ts', 'export const x = 1\n')
    expect(out).toBe(
      HEADER.replace('%PKG%', 'plan').replace('%FILE%', 'normalize.ts') + 'export const x = 1\n',
    )
    expect(out).toContain('Source of truth: packages/plan/src/normalize.ts.')
    expect(out.endsWith('export const x = 1\n')).toBe(true)
  })
})

describe('vendorDrift', () => {
  const src = (pkg, file, body) => [`${pkg}/${file}`, vendoredContent(pkg, file, body)]

  it('is empty when every expected file matches', () => {
    const expected = new Map([src('plan', 'a.ts', 'a\n'), src('tax', 'b.ts', 'b\n')])
    expect(vendorDrift(expected, new Map(expected))).toEqual([])
  })

  it('names a file whose content differs', () => {
    const expected = new Map([src('plan', 'a.ts', 'new\n')])
    const actual = new Map([src('plan', 'a.ts', 'old\n')])
    expect(vendorDrift(expected, actual)).toEqual(['plan/a.ts'])
  })

  it('names a file that has not been vendored yet', () => {
    const expected = new Map([src('plan', 'a.ts', 'a\n')])
    expect(vendorDrift(expected, new Map())).toEqual(['plan/a.ts'])
  })

  it('names a vendored file with no matching source as stale', () => {
    const expected = new Map([src('plan', 'a.ts', 'a\n')])
    const actual = new Map([...expected, src('plan', 'gone.ts', 'x\n')])
    expect(vendorDrift(expected, actual)).toEqual([
      'plan/gone.ts (stale — no longer in the package)',
    ])
  })

  it('reports a changed file and a stale file together', () => {
    const expected = new Map([src('plan', 'a.ts', 'new\n')])
    const actual = new Map([src('plan', 'a.ts', 'old\n'), src('plan', 'gone.ts', 'x\n')])
    expect(vendorDrift(expected, actual)).toEqual([
      'plan/a.ts',
      'plan/gone.ts (stale — no longer in the package)',
    ])
  })
})
