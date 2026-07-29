// Asserts the deployed database has applied every migration in the repo.
//
// `pnpm check:migrations` proves the directory is internally consistent, but it
// cannot see the deployed schema, so it cannot see the failure that matters: a
// migration that merged and never applied. `db push` skips a version already
// recorded in `supabase_migrations.schema_migrations` without an error, and its
// push trigger only fires for a commit that touches `supabase/migrations/**` — so
// nothing in the deploy path itself notices a file that was left behind.
//
// The comparison comes from `supabase migration list`, which reports the local
// directory and the remote history table side by side and takes
// `--output-format json`, so the versions are read from a structured field
// rather than scraped out of its human table. The command only reads: it opens no
// transaction and creates no `supabase_migrations` schema where one is absent.
//
// Usage:
//   node scripts/check-migration-drift.js [--db-url=<url>] [--grace-minutes=<n>]
//
// `--db-url` checks the database at a connection string instead of the linked
// project. `--grace-minutes` forgives a migration that merged within that window,
// whose deploy is presumed still in flight; it defaults to 0, which is what a
// post-deploy assertion wants — there, every migration must already be applied.

import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import {
  FILENAME,
  listMigrationFiles,
  MIGRATIONS_SUBDIR,
  REPO_ROOT,
} from './lib/migration-files.js'

// The CLI the lockfile pins, so the binary reading `supabase/config.toml` here is
// the one the deploy uses.
const SUPABASE_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'supabase')

function die(message) {
  console.error(message)
  annotate('error', message)
  process.exit(1)
}

/** Surfaces the message on the run summary of a GitHub Actions job. */
function annotate(level, message) {
  if (!process.env.GITHUB_ACTIONS) return
  const encoded = message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
  console.log(`::${level} title=Migration drift::${encoded}`)
}

function parseArgs(argv) {
  let dbUrl = null
  let graceMinutes = 0
  for (const arg of argv) {
    // pnpm forwards the end-of-options marker verbatim, so `pnpm
    // check:migration-drift -- --grace-minutes=30` arrives with it attached.
    if (arg === '--') {
      continue
    } else if (arg.startsWith('--db-url=')) {
      dbUrl = arg.slice('--db-url='.length)
    } else if (arg.startsWith('--grace-minutes=')) {
      graceMinutes = Number(arg.slice('--grace-minutes='.length))
      if (!Number.isFinite(graceMinutes) || graceMinutes < 0) {
        die(`${arg}: expected a non-negative number of minutes.`)
      }
    } else {
      die(`${arg}: unknown flag. Usage: [--db-url=<url>] [--grace-minutes=<n>]`)
    }
  }
  return { dbUrl, graceMinutes }
}

/** Versions recorded in the target's `supabase_migrations.schema_migrations`. */
function readAppliedVersions(dbUrl) {
  const target = dbUrl ? ['--db-url', dbUrl] : ['--linked']
  let stdout
  try {
    stdout = execFileSync(
      SUPABASE_BIN,
      ['migration', 'list', ...target, '--output-format', 'json', '--yes'],
      // The CLI writes its progress lines to stderr and the JSON document to
      // stdout, so the two never have to be untangled.
      { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
    )
  } catch (error) {
    stdout = error.stdout ?? ''
  }

  let parsed
  try {
    parsed = JSON.parse(stdout)
  } catch {
    die(`supabase migration list produced no JSON document. Its output was:\n${stdout}`)
  }
  if (!Array.isArray(parsed.migrations)) {
    die(
      `supabase migration list could not read the migration history:\n${parsed.error?.message ?? stdout}`,
    )
  }
  return new Set(parsed.migrations.map((row) => row.remote).filter(Boolean))
}

/** Version -> filename for the repo's migrations. */
function readRepoMigrations() {
  const byVersion = new Map()
  for (const file of listMigrationFiles()) {
    const match = FILENAME.exec(file)
    if (!match) {
      die(`${file}: not a <14-digit version>_<lower_snake_case name>.sql filename.`)
    }
    const [, version] = match
    if (byVersion.has(version)) {
      die(`Two migrations claim version ${version}. Run \`pnpm check:migrations\`.`)
    }
    byVersion.set(version, file)
  }
  return byVersion
}

/** When the file first landed on this branch, or null if it is not committed. */
function mergedAt(file) {
  let stdout
  try {
    stdout = execFileSync(
      'git',
      ['log', '-1', '--format=%cI', '--diff-filter=A', '--', join(MIGRATIONS_SUBDIR, file)],
      { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
  } catch {
    return null
  }
  const merged = stdout ? new Date(stdout) : null
  return merged && !Number.isNaN(merged.getTime()) ? merged : null
}

function describeAge(merged) {
  if (!merged) return 'merge date unknown'
  const minutes = Math.round((Date.now() - merged.getTime()) / 60_000)
  if (minutes < 60) return `merged ${minutes}m ago`
  if (minutes < 48 * 60) return `merged ${Math.round(minutes / 60)}h ago`
  return `merged ${Math.round(minutes / (24 * 60))}d ago`
}

function asList(rows) {
  const width = Math.max(...rows.map(([label]) => label.length))
  return rows.map(([label, note]) => `  ${label.padEnd(width)}  ${note}`).join('\n')
}

const { dbUrl, graceMinutes } = parseArgs(process.argv.slice(2))
const targetLabel = dbUrl ? 'the database at --db-url' : 'the linked project'

const repo = readRepoMigrations()
const applied = readAppliedVersions(dbUrl)

const cutoff = Date.now() - graceMinutes * 60_000
const behind = []
const inFlight = []
for (const [version, file] of repo) {
  if (applied.has(version)) continue
  const merged = mergedAt(file)
  const row = [file, describeAge(merged)]
  if (merged && merged.getTime() > cutoff) inFlight.push(row)
  else behind.push(row)
}

// A version applied with no file behind it means the schema cannot be rebuilt
// from the repo, which is worth saying out loud — but it has no automated remedy,
// so it warns rather than fails. Reserving the failure for a migration that is
// missing keeps the one signal that does have a fix meaningful.
const unknown = [...applied].filter((version) => !repo.has(version)).sort()
if (unknown.length > 0) {
  const report = [
    `Applied to ${targetLabel} with no file in ${MIGRATIONS_SUBDIR}/, so its schema`,
    `cannot be rebuilt from the repo (${unknown.length} of ${applied.size} applied):`,
    '',
    ...unknown.map((version) => `  ${version}`),
    '',
    'Commit the migration that produced each, or clear its row with',
    '`supabase migration repair --status reverted <version>`.',
  ].join('\n')
  console.error(report)
  annotate('warning', report)
}

if (inFlight.length > 0) {
  console.log(
    [
      `Merged within the last ${graceMinutes}m and not yet applied to ${targetLabel},`,
      `so treated as a deploy still in flight (${inFlight.length} of ${repo.size}):`,
      '',
      asList(inFlight),
      '',
    ].join('\n'),
  )
}

if (behind.length > 0) {
  die(
    [
      `${MIGRATIONS_SUBDIR}/ is ahead of ${targetLabel}.`,
      `Unapplied migrations (${behind.length} of ${repo.size}):`,
      '',
      asList(behind),
      '',
      'Apply them by dispatching the deploy workflow:',
      '',
      '  gh workflow run "Deploy migrations"',
      '',
      'If that run reports nothing to push, the version is already recorded in',
      'supabase_migrations.schema_migrations under a different migration — `db push`',
      'skips a recorded version without an error. Give the file a version no applied',
      'migration holds and merge it again.',
    ].join('\n'),
  )
}

console.log(
  `${repo.size - inFlight.length} of ${repo.size} migrations in ${MIGRATIONS_SUBDIR}/ applied to ${targetLabel}.`,
)
