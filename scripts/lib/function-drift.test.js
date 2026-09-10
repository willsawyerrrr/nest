import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  bundleInputs,
  classifyFunctions,
  listFunctionSlugs,
  pruneOrphans,
} from './function-drift.js'

const NOW = new Date('2026-07-29T12:00:00Z').getTime()

/** Minutes before `NOW`, as the classifier reads dates. */
function ago(minutes) {
  return new Date(NOW - minutes * 60_000)
}

/** A deployed function, active and last updated `minutes` before `NOW`. */
function live(minutes, status = 'ACTIVE') {
  return { status, updatedAt: ago(minutes) }
}

describe('classifyFunctions', () => {
  it('counts a function deployed after its last source change as current', () => {
    const result = classifyFunctions({
      repo: new Map([
        ['up-sync', ago(600)],
        ['changelog', ago(4_000)],
      ]),
      deployed: new Map([
        ['up-sync', live(590)],
        ['changelog', live(590)],
      ]),
      now: NOW,
    })

    expect(result.current.map((row) => row.slug)).toEqual(['changelog', 'up-sync'])
    expect(result.stale).toEqual([])
    expect(result.inFlight).toEqual([])
    expect(result.orphans).toEqual([])
  })

  it('reports a function whose source changed after its deployment as behind', () => {
    const result = classifyFunctions({
      repo: new Map([
        ['up-sync', ago(120)],
        ['changelog', ago(4_000)],
      ]),
      deployed: new Map([
        ['up-sync', live(600)],
        ['changelog', live(600)],
      ]),
      now: NOW,
    })

    expect(result.stale).toEqual([
      {
        slug: 'up-sync',
        changedAt: ago(120),
        deployedAt: ago(600),
        status: 'ACTIVE',
        reason: 'behind',
      },
    ])
    expect(result.current.map((row) => row.slug)).toEqual(['changelog'])
  })

  it('reports a function the project does not hold at all as missing', () => {
    const result = classifyFunctions({
      repo: new Map([['push-test', ago(4_000)]]),
      deployed: new Map(),
      now: NOW,
    })

    expect(result.stale).toEqual([
      {
        slug: 'push-test',
        changedAt: ago(4_000),
        deployedAt: null,
        status: null,
        reason: 'missing',
      },
    ])
  })

  it('reports a deployed function that is not serving as inactive', () => {
    const result = classifyFunctions({
      repo: new Map([['push-test', ago(4_000)]]),
      deployed: new Map([['push-test', live(10, 'THROTTLED')]]),
      now: NOW,
    })

    // Newer than its source, so only the status makes it stale.
    expect(result.stale).toEqual([
      {
        slug: 'push-test',
        changedAt: ago(4_000),
        deployedAt: ago(10),
        status: 'THROTTLED',
        reason: 'inactive',
      },
    ])
  })

  it('reports a deployed function with no repo directory as an orphan, not a failure', () => {
    const result = classifyFunctions({
      repo: new Map([['up-sync', ago(4_000)]]),
      deployed: new Map([
        ['up-sync', live(600)],
        ['retired-thing', live(9_000)],
      ]),
      now: NOW,
    })

    expect(result.orphans).toEqual(['retired-thing'])
    expect(result.stale).toEqual([])
  })

  it('treats a source change inside the grace window as a deploy in flight', () => {
    const result = classifyFunctions({
      repo: new Map([['up-sync', ago(20)]]),
      deployed: new Map([['up-sync', live(600)]]),
      now: NOW,
      graceMinutes: 30,
    })

    expect(result.inFlight.map((row) => row.slug)).toEqual(['up-sync'])
    expect(result.stale).toEqual([])
  })

  it('treats a source change outside the grace window as drift', () => {
    const result = classifyFunctions({
      repo: new Map([['up-sync', ago(40)]]),
      deployed: new Map([['up-sync', live(600)]]),
      now: NOW,
      graceMinutes: 30,
    })

    expect(result.stale.map((row) => row.slug)).toEqual(['up-sync'])
    expect(result.inFlight).toEqual([])
  })

  it('gives a brand-new function inside the grace window the same benefit', () => {
    const result = classifyFunctions({
      repo: new Map([['brand-new', ago(5)]]),
      deployed: new Map(),
      now: NOW,
      graceMinutes: 30,
    })

    expect(result.inFlight).toEqual([
      { slug: 'brand-new', changedAt: ago(5), deployedAt: null, status: null, reason: 'missing' },
    ])
    expect(result.stale).toEqual([])
  })

  it('withholds grace from a function no commit dates, having no window to measure', () => {
    const result = classifyFunctions({
      repo: new Map([['uncommitted', null]]),
      deployed: new Map(),
      now: NOW,
      graceMinutes: 30,
    })

    expect(result.stale).toEqual([
      { slug: 'uncommitted', changedAt: null, deployedAt: null, status: null, reason: 'missing' },
    ])
  })

  it('cannot call a function behind when no commit dates its sources', () => {
    const result = classifyFunctions({
      repo: new Map([['uncommitted', null]]),
      deployed: new Map([['uncommitted', live(9_000)]]),
      now: NOW,
    })

    expect(result.current.map((row) => row.slug)).toEqual(['uncommitted'])
  })

  it('defaults to no grace, so any change ahead of the deployment is drift', () => {
    const result = classifyFunctions({
      repo: new Map([['up-sync', ago(1)]]),
      deployed: new Map([['up-sync', live(2)]]),
      now: NOW,
    })

    expect(result.stale.map((row) => row.slug)).toEqual(['up-sync'])
  })
})

describe('pruneOrphans', () => {
  it('deletes every orphan in order and reports them', () => {
    const seen = []
    const result = pruneOrphans(['old-a', 'old-b'], (slug) => seen.push(slug))

    expect(seen).toEqual(['old-a', 'old-b'])
    expect(result).toEqual({ deleted: ['old-a', 'old-b'], failed: [] })
  })

  it('collects a delete that throws without stopping the rest', () => {
    const result = pruneOrphans(['old-a', 'old-b', 'old-c'], (slug) => {
      if (slug === 'old-b') throw new Error('network down')
    })

    expect(result.deleted).toEqual(['old-a', 'old-c'])
    expect(result.failed).toEqual([{ slug: 'old-b', message: 'network down' }])
  })

  it('does nothing for an empty orphan list', () => {
    let called = false
    const result = pruneOrphans([], () => {
      called = true
    })

    expect(called).toBe(false)
    expect(result).toEqual({ deleted: [], failed: [] })
  })
})

describe('listFunctionSlugs and bundleInputs', () => {
  let dir

  /** Writes a file under the fixture functions directory, creating its parents. */
  function write(path, source) {
    const target = join(dir, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, source)
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nest-functions-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true })
  })

  it('lists only directories holding an entrypoint, excluding shared code', () => {
    write('_shared/http.ts', 'export const json = 1\n')
    write('up-sync/index.ts', "import './sync.ts'\n")
    write('up-sync/sync.ts', 'export const run = 1\n')
    write('docs/notes.md', 'not a function\n')
    write('half-built/helper.ts', 'export const x = 1\n')
    write('deno.json', '{}\n')

    expect(listFunctionSlugs(dir)).toEqual(['up-sync'])
  })

  it('walks the entrypoint through its relative imports, including shared modules', () => {
    write(
      'up-sync/index.ts',
      [
        "import { json } from '../_shared/http.ts'",
        "import { runSync } from './sync.ts'",
        "await import('./lazy.ts')",
        "export { thing } from './reexport.ts'",
        '',
      ].join('\n'),
    )
    write('up-sync/sync.ts', "import { cors } from '../_shared/cors.ts'\n")
    write('up-sync/lazy.ts', 'export const lazy = 1\n')
    write('up-sync/reexport.ts', 'export const thing = 1\n')
    write('_shared/http.ts', "import './cors.ts'\n")
    write('_shared/cors.ts', 'export const cors = 1\n')

    expect(bundleInputs('up-sync', dir)).toEqual([
      '_shared/cors.ts',
      '_shared/http.ts',
      'up-sync/index.ts',
      'up-sync/lazy.ts',
      'up-sync/reexport.ts',
      'up-sync/sync.ts',
    ])
  })

  it('leaves out the files a bundle never carries', () => {
    write(
      'up-sync/index.ts',
      [
        // Erased by transpiling, so the module it names is not a bundle input.
        "import type { Row } from './types.ts'",
        "import { runSync } from './sync.ts'",
        // A relative path escaping the functions directory names nothing a bundle
        // carries, and neither does one with no file behind it.
        "import { tax } from '../../../packages/tax/src/index.ts'",
        "import './absent.ts'",
        '',
      ].join('\n'),
    )
    write('up-sync/sync.ts', 'export const runSync = 1\n')
    write('up-sync/types.ts', 'export type Row = { id: string }\n')
    write('up-sync/sync_test.ts', "import { runSync } from './sync.ts'\n")
    write('up-sync/README.md', 'notes\n')

    expect(bundleInputs('up-sync', dir)).toEqual(['up-sync/index.ts', 'up-sync/sync.ts'])
  })

  it('keeps a module named by a mixed type-and-value import', () => {
    write(
      'up-sync/index.ts',
      "import { type Row, runSync } from './sync.ts'\nexport type { Row }\n",
    )
    write('up-sync/sync.ts', 'export const runSync = 1\n')

    expect(bundleInputs('up-sync', dir)).toEqual(['up-sync/index.ts', 'up-sync/sync.ts'])
  })

  it('survives a cycle between two modules', () => {
    write('up-sync/index.ts', "import './a.ts'\n")
    write('up-sync/a.ts', "import './b.ts'\n")
    write('up-sync/b.ts', "import './a.ts'\n")

    expect(bundleInputs('up-sync', dir)).toEqual([
      'up-sync/a.ts',
      'up-sync/b.ts',
      'up-sync/index.ts',
    ])
  })
})
