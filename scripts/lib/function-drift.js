// The repo side of `supabase/functions/` and the comparison the drift check
// makes against a deployed project: which directories are functions, which files
// end up in each one's bundle, and which of them the project is behind on.
//
// The bundle-input question is what keeps the comparison honest. `functions
// deploy` uploads a content-addressed bundle per function and the platform keeps
// the version it already holds when the bundle is byte-identical, leaving that
// function's `updated_at` where it was. So "the directory changed more recently
// than the deployment" is only evidence of a missed deploy when the change was
// one the bundle can see. Every function directory here also holds `*_test.ts`
// files that nothing in the module graph imports, and `supabase/functions/`
// holds a `README.md` and a `deno.json` whose `tasks` and `fmt` sections no
// bundle reads — dating a function by its whole directory would report every
// test-only commit as drift forever, since no redeploy can ever advance the
// timestamp.
//
// So a function's inputs are its module graph: `index.ts` plus every file
// reachable from it through a relative specifier the transpiler keeps, which
// pulls in the `_shared/` modules it uses and nothing else. A change to a file in
// that graph changes the
// bundle's bytes, so a successful deploy always advances `updated_at` past it.
// The set is deliberately narrower than the bundle rather than wider: if the
// bundler carries a file this graph omits, the check misses a staleness it could
// have caught, which is a quiet gap — whereas a file in the set that the bundle
// ignores is a failure nothing can clear.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

export const REPO_ROOT = join(HERE, '..', '..')
export const FUNCTIONS_SUBDIR = join('supabase', 'functions')
const FUNCTIONS_DIR = join(REPO_ROOT, FUNCTIONS_SUBDIR)

// The entrypoint Supabase deploys a function from; a directory without one is
// not a function.
const ENTRYPOINT = 'index.ts'

// `from '…'`, a bare `import '…'`, and a dynamic `import('…')` — the three ways
// one module names another. Only relative specifiers are followed: everything
// else is a bare name the import map resolves to a registry module, which lives
// outside the repo and so has no commit to date.
const SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g

// A wholly type-only `import type` / `export type` statement names a module for
// the type checker alone; transpiling erases it, so it is not a bundle input and
// counting it as one would date a function by a file its bundle never sees. The
// mixed form (`import { type Foo, bar }`) keeps a runtime binding and so stays a
// real dependency.
const TYPE_ONLY_STATEMENT = /^[ \t]*(?:import|export)[ \t]+type\b[^;]*?from[ \t]*['"][^'"]+['"];?/gm

/**
 * Every deployable function directory, in name order. A directory whose name
 * starts with `_` is shared code (`_shared/`), and one without an `index.ts` has
 * no entrypoint to deploy, so neither is a function.
 */
export function listFunctionSlugs(functionsDir = FUNCTIONS_DIR) {
  return readdirSync(functionsDir)
    .filter((name) => !name.startsWith('_') && !name.startsWith('.'))
    .filter((name) => statSync(join(functionsDir, name)).isDirectory())
    .filter((name) => existsSync(join(functionsDir, name, ENTRYPOINT)))
    .sort()
}

/**
 * The files that end up in a function's bundle: its entrypoint and everything
 * reachable from it by relative specifier, as paths relative to `functionsDir`
 * in POSIX form, in name order.
 */
export function bundleInputs(slug, functionsDir = FUNCTIONS_DIR) {
  const root = resolve(functionsDir)
  const seen = new Set()
  const queue = [join(root, slug, ENTRYPOINT)]

  while (queue.length > 0) {
    const file = queue.pop()
    if (seen.has(file) || !existsSync(file)) continue
    seen.add(file)
    const source = readFileSync(file, 'utf8').replace(TYPE_ONLY_STATEMENT, '')
    for (const [, specifier] of source.matchAll(SPECIFIER)) {
      if (!specifier.startsWith('.')) continue
      const target = resolve(dirname(file), specifier)
      // A specifier that escapes the functions directory names something no
      // bundle carries, so it has nothing to contribute and nothing to follow.
      if (target !== root && !target.startsWith(root + sep)) continue
      queue.push(target)
    }
  }

  return [...seen].map((file) => relative(root, file).split(sep).join('/')).sort()
}

/**
 * Sorts each repo function into how the project stands on it, and reports any
 * deployed function the repo has no directory for.
 *
 * `repo` maps a slug to the date its bundle inputs last changed, or null where
 * no commit accounts for them. `deployed` maps a slug to its `{ status,
 * updatedAt }` in the project. A function is stale when the project has no copy
 * of it (`missing`), holds one that is not serving (`inactive`), or holds one
 * older than its inputs (`behind`).
 *
 * A stale function whose inputs changed within `graceMinutes` of `now` counts as
 * a deploy still in flight rather than as drift — the window covers all three
 * kinds, because a deploy that has not run yet leaves a brand-new function
 * missing just as it leaves an edited one behind. A slug with no date gets no
 * grace: there is nothing to measure the window against.
 */
export function classifyFunctions({ repo, deployed, now = Date.now(), graceMinutes = 0 }) {
  const cutoff = now - graceMinutes * 60_000
  const current = []
  const stale = []
  const inFlight = []

  for (const slug of [...repo.keys()].sort()) {
    const changedAt = repo.get(slug) ?? null
    const live = deployed.get(slug) ?? null
    const row = {
      slug,
      changedAt,
      deployedAt: live?.updatedAt ?? null,
      status: live?.status ?? null,
      reason: null,
    }

    if (!live) row.reason = 'missing'
    else if (live.status !== 'ACTIVE') row.reason = 'inactive'
    else if (changedAt && changedAt.getTime() > live.updatedAt.getTime()) row.reason = 'behind'

    if (!row.reason) current.push(row)
    else if (changedAt && changedAt.getTime() > cutoff) inFlight.push(row)
    else stale.push(row)
  }

  const orphans = [...deployed.keys()].filter((slug) => !repo.has(slug)).sort()

  return { current, stale, inFlight, orphans }
}

/**
 * Deletes every orphan slug through `deleteOrphan`, a `(slug) => void` that
 * throws on failure. Returns the slugs deleted and, for each that threw, its
 * error message. A failed delete is reported, not fatal: an orphan is only ever
 * a warning, so a transient failure to clear one waits for the next run rather
 * than taking a deploy down.
 */
export function pruneOrphans(orphans, deleteOrphan) {
  const deleted = []
  const failed = []
  for (const slug of orphans) {
    try {
      deleteOrphan(slug)
      deleted.push(slug)
    } catch (error) {
      failed.push({ slug, message: error instanceof Error ? error.message : String(error) })
    }
  }
  return { deleted, failed }
}
