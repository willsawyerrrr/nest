// Generates `apps/pwa/src/lib/database.types.ts` from the Postgres schema and
// formats it, or — with `--check` — asserts the committed file already matches.
//
// `supabase gen types typescript` introspects a database and prints the types to
// stdout. Two wrinkles this wrapper handles:
//
//   - The CLI occasionally appends a telemetry line (`{"_tag":"Error",…}`) after
//     the types when its analytics flush times out. Left in the file it breaks
//     Prettier and the TypeScript build, so everything past the final
//     `} as const` is dropped.
//   - The generated file is Prettier-formatted in the repo, so the raw output is
//     run through Prettier before it is written or compared.
//
// The schema source is `--local` (a running `supabase start` stack) by default,
// or `--db-url <url>` to introspect an arbitrary database — how CI checks the
// output against a Postgres that has had every migration applied.
//
// Usage:
//   node scripts/gen-db-types.js [--local | --db-url <url>]
//   node scripts/gen-db-types.js --check [--local | --db-url <url>]

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripToGeneratedSchema } from './lib/db-types.js'
import { REPO_ROOT } from './lib/migration-files.js'

const SUPABASE_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'supabase')
const PRETTIER_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'prettier')
const TYPES_PATH = join(REPO_ROOT, 'apps', 'pwa', 'src', 'lib', 'database.types.ts')
const TYPES_REL = 'apps/pwa/src/lib/database.types.ts'

// `supabase gen types --local` reads the schema list from `supabase/config.toml`
// (`public`, `graphql_public`); `--db-url` does not, so both are named here to
// keep the two sources producing the same file.
const SCHEMAS = 'public,graphql_public'

function die(message) {
  console.error(message)
  process.exit(1)
}

function parseArgs(argv) {
  const args = { check: false, source: ['--local'] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--check') args.check = true
    else if (arg === '--local') args.source = ['--local']
    else if (arg === '--db-url') {
      const url = argv[++i]
      if (!url) die('--db-url needs a connection string.')
      args.source = ['--db-url', url]
    } else die(`Unexpected argument: ${arg}`)
  }
  return args
}

/** One `supabase gen types` invocation; returns stdout whether or not it exits 0. */
function runGenTypes(source) {
  // The CLI exits non-zero when its telemetry flush times out even though the
  // types printed fine (which is why `db:types` has always used a `>` redirect),
  // so the exit code is ignored and the output is validated instead.
  try {
    return execFileSync(
      SUPABASE_BIN,
      ['gen', 'types', 'typescript', ...source, '--schema', SCHEMAS],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'inherit'],
      },
    )
  } catch (error) {
    return error.stdout ?? ''
  }
}

function generate(source) {
  // `gen types` starts a Postgres container to introspect the schema; on a CI
  // runner the Docker daemon intermittently can't start it ("error running
  // container: exit 125"), leaving output with no `} as const`. Retry a few
  // times before giving up, the same way the function-bundle deploy does.
  const attempts = 3
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const types = stripToGeneratedSchema(runGenTypes(source))
    if (types !== null) return types
    if (attempt < attempts) {
      console.error(
        `supabase gen types produced no \`} as const\` (attempt ${attempt}/${attempts}); retrying in 5s`,
      )
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000)
    }
  }
  die('supabase gen types produced no `} as const` — is the schema source reachable?')
}

/** Runs the raw generated types through Prettier, as the committed file is. */
function format(source) {
  try {
    return execFileSync(PRETTIER_BIN, ['--stdin-filepath', TYPES_PATH], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      input: source,
      maxBuffer: 32 * 1024 * 1024,
    })
  } catch (error) {
    die(`prettier failed to format the generated types:\n${error.stderr ?? error.message}`)
  }
}

const args = parseArgs(process.argv.slice(2))
const generated = format(generate(args.source))

if (!args.check) {
  writeFileSync(TYPES_PATH, generated)
  console.log(
    `Wrote ${TYPES_REL} from ${args.source[0] === '--local' ? 'the local stack' : args.source[1]}.`,
  )
  process.exit(0)
}

const committed = readFileSync(TYPES_PATH, 'utf8')
if (committed === generated) {
  console.log(`${TYPES_REL} is up to date with the migrations.`)
  process.exit(0)
}

die(
  `${TYPES_REL} is out of date with the migrations.\n\n` +
    'Run `pnpm db:types` against a database with every migration applied and commit the result.',
)
