// Vendors the pure `@nest/plan` and `@nest/tax` sources into
// `supabase/functions/_shared/vendor/` so the edge functions can import them.
//
// The Supabase CLI bundles each edge function inside a container that sees only
// `supabase/functions/`, so an import that reaches `../../packages` fails the
// deploy ("failed to create the graph: Module not found"). The packages stay
// the single source of truth — this copies their `src/` verbatim (minus tests),
// stamps a "generated" header, and the `--check` mode fails CI when the copy has
// drifted from the source.
//
//   node scripts/vendor-edge-packages.js          # rewrite the vendored copy
//   node scripts/vendor-edge-packages.js --check  # assert it is in sync

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { vendorDrift, vendoredContent } from './lib/vendor-edge.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..')
const PACKAGES = ['plan', 'tax']
const VENDOR_DIR = join(REPO_ROOT, 'supabase', 'functions', '_shared', 'vendor')

/** Every non-test `.ts` file under a package's `src/`, relative to that `src/`. */
function sourceFiles(pkg) {
  const srcDir = join(REPO_ROOT, 'packages', pkg, 'src')
  return readdirSync(srcDir, { recursive: true })
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .sort()
}

/** Every `.ts` file already under a package's vendor dir, relative to that dir. */
function vendoredFiles(pkg) {
  const dir = join(VENDOR_DIR, pkg)
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true }).filter((name) => name.endsWith('.ts'))
}

const check = process.argv.includes('--check')

/** `Map<"<pkg>/<file>", content>` of what the vendored tree should hold. */
const expected = new Map(
  PACKAGES.flatMap((pkg) =>
    sourceFiles(pkg).map((file) => [
      `${pkg}/${file}`,
      vendoredContent(
        pkg,
        file,
        readFileSync(join(REPO_ROOT, 'packages', pkg, 'src', file), 'utf8'),
      ),
    ]),
  ),
)

if (check) {
  const actual = new Map(
    PACKAGES.flatMap((pkg) =>
      vendoredFiles(pkg).map((file) => [
        `${pkg}/${file}`,
        readFileSync(join(VENDOR_DIR, pkg, file), 'utf8'),
      ]),
    ),
  )
  const drift = vendorDrift(expected, actual)
  if (drift.length > 0) {
    console.error(
      `The vendored edge copies are out of sync with packages/:\n  ${drift.join(
        '\n  ',
      )}\n\nRun \`pnpm vendor:edge\` and commit the result.`,
    )
    process.exit(1)
  }
  console.log('Vendored edge copies are in sync with packages/.')
} else {
  for (const pkg of PACKAGES) {
    rmSync(join(VENDOR_DIR, pkg), { recursive: true, force: true })
  }
  for (const [path, content] of expected) {
    const target = join(VENDOR_DIR, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  console.log(`Vendored ${expected.size} files into supabase/functions/_shared/vendor/.`)
}
