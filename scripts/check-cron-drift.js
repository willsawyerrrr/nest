// Asserts every `pg_cron` job a migration schedules is actually registered and
// active in the deployed database.
//
// A `cron.schedule(...)` call inside a migration's guarded `do $$ ... end $$`
// block (see `20260719040000_up_sync_schedule.sql` and
// `20260905000000_notification_triggers.sql`) is written to no-op cleanly when
// the extensions or the Vault secrets it needs are absent, so the migration
// still applies on plain Postgres (CI, local) and on a fresh prod before ops has
// created its secrets. That guard has no deploy trigger to catch its failure
// mode: unlike a missing migration or function, which `check-migration-drift.js`
// and `check-function-drift.js` catch because a later push re-applies the gap,
// a `cron.schedule` call that no-ops because a secret was never created stays
// silently unscheduled forever — nothing re-runs the migration to try again, and
// nothing else in the deploy path ever calls `cron.schedule` for it. This is
// exactly the failure that left `notify-eval-daily` unscheduled in prod from the
// migration that was meant to create it until the gap was noticed by hand.
//
// The comparison comes from `supabase db query --linked`, which runs arbitrary
// SQL against the linked project's database via the Management API, the same
// authorization path `migration list --linked` uses. The repo side scans every
// migration file for `cron.schedule(` calls and reads the job name each
// schedules, so adding a new scheduled job to a migration extends the expected
// set with no change needed here.
//
// Usage:
//   node scripts/check-cron-drift.js [--db-url=<url>]
//
// `--db-url` checks the database at a connection string instead of the linked
// project.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  listMigrationFiles,
  MIGRATIONS_DIR,
  MIGRATIONS_SUBDIR,
  REPO_ROOT,
} from './lib/migration-files.js'

// The CLI the lockfile pins, so the binary reading `supabase/config.toml` here is
// the one the deploy uses.
const SUPABASE_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'supabase')

// Matches `cron.schedule(` followed by the job name as the first argument,
// however the call wraps across lines — every call in the repo opens with the
// name as a quoted string literal on its own line.
const SCHEDULE_CALL = /cron\.schedule\(\s*\n?\s*'([a-z0-9-]+)'/g

function die(message) {
  console.error(message)
  annotate('error', message)
  process.exit(1)
}

/** Surfaces the message on the run summary of a GitHub Actions job. */
function annotate(level, message) {
  if (!process.env.GITHUB_ACTIONS) return
  const encoded = message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
  console.log(`::${level} title=Cron drift::${encoded}`)
}

function parseArgs(argv) {
  let dbUrl = null
  for (const arg of argv) {
    // pnpm forwards the end-of-options marker verbatim, so `pnpm
    // check:cron-drift -- --db-url=...` arrives with it attached.
    if (arg === '--') {
      continue
    } else if (arg.startsWith('--db-url=')) {
      dbUrl = arg.slice('--db-url='.length)
    } else {
      die(`${arg}: unknown flag. Usage: [--db-url=<url>]`)
    }
  }
  return { dbUrl }
}

/** Job name -> the migration file that schedules it. */
function readExpectedJobs() {
  const expected = new Map()
  for (const file of listMigrationFiles()) {
    const contents = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
    for (const match of contents.matchAll(SCHEDULE_CALL)) {
      const [, jobname] = match
      if (!expected.has(jobname)) expected.set(jobname, file)
    }
  }
  return expected
}

/** Job name -> whether it is registered and active in the target database. */
function readDeployedJobs(dbUrl) {
  const target = dbUrl ? ['--db-url', dbUrl] : ['--linked']
  let stdout
  try {
    stdout = execFileSync(
      SUPABASE_BIN,
      [
        'db',
        'query',
        ...target,
        '--output-format',
        'json',
        '--yes',
        'select jobname, active from cron.job',
      ],
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
    die(`supabase db query produced no JSON document. Its output was:\n${stdout}`)
  }
  if (!Array.isArray(parsed)) {
    die(`supabase db query could not read cron.job:\n${parsed.error?.message ?? stdout}`)
  }
  return new Map(parsed.map((row) => [row.jobname, row.active === true]))
}

const { dbUrl } = parseArgs(process.argv.slice(2))
const targetLabel = dbUrl ? 'the database at --db-url' : 'the linked project'

const expected = readExpectedJobs()
const deployed = readDeployedJobs(dbUrl)

const missing = []
const inactive = []
for (const [jobname, file] of expected) {
  if (!deployed.has(jobname)) missing.push([jobname, file])
  else if (deployed.get(jobname) !== true) inactive.push([jobname, file])
}

if (missing.length > 0 || inactive.length > 0) {
  const width = Math.max(...[...missing, ...inactive].map(([jobname]) => jobname.length))
  const asList = (rows, note) =>
    rows
      .map(([jobname, file]) => `  ${jobname.padEnd(width)}  ${note}, scheduled by ${file}`)
      .join('\n')

  die(
    [
      `${MIGRATIONS_SUBDIR}/ schedules a pg_cron job that ${targetLabel} does not run.`,
      '',
      ...(missing.length > 0 ? [asList(missing, 'not registered at all'), ''] : []),
      ...(inactive.length > 0 ? [asList(inactive, 'registered but inactive'), ''] : []),
      'A job can be missing because the migration that schedules it guards on Vault',
      'secrets (its own `do $$ ... end $$` block checks `vault.decrypted_secrets`)',
      'that were never created in this project — re-running the migration will not',
      'fix this, since a version already applied is never re-applied. Create the',
      'secrets the migration names, then register the job directly:',
      '',
      '  select cron.schedule(<jobname>, <schedule>, <command>);',
      '',
      '(copy the exact call out of the migration file named above).',
    ].join('\n'),
  )
}

console.log(
  `${expected.size} of ${expected.size} pg_cron jobs in ${MIGRATIONS_SUBDIR}/ registered and active on ${targetLabel}.`,
)
