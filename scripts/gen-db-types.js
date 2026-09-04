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

/** The generated types, minus any trailing telemetry noise the CLI appends. */
function generate(source) {
  // The CLI exits non-zero when its telemetry flush times out even though the
  // types printed fine (which is why `db:types` has always used a `>` redirect),
  // so the exit code is ignored and the output is validated instead.
  let stdout
  try {
    stdout = execFileSync(
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
    stdout = error.stdout ?? ''
  }
  const lines = stdout.split('\n')
  const end = lines.lastIndexOf('} as const')
  if (end === -1)
    die('supabase gen types produced no `} as const` — is the schema source reachable?')
  return lines.slice(0, end + 1).join('\n') + '\n'
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
