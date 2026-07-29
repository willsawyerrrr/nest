// Asserts the deployed project runs every edge function in the repo.
//
// CI's `functions` job proves the sources are well formed, but it cannot see the
// project, so it cannot see the failure that matters: a function that merged and
// never deployed. `functions deploy` bundles each function in a container, and a
// container that fails to start takes the whole step down before anything ships —
// while the push trigger only fires for a commit that touches
// `supabase/functions/**` or `supabase/config.toml`, so a later merge is the only
// thing that would ship the earlier one, by luck rather than design.
//
// The comparison comes from `supabase functions list`, which reports each
// deployed function's status and the time it was last updated. The command only
// reads. The repo side of it — which directories are functions and which files
// end up in each one's bundle — lives in `lib/function-drift.js`, whose header
// explains why the bundle's module graph dates a function rather than its whole
// directory.
//
// Usage:
//   node scripts/check-function-drift.js [--project-ref=<ref>] [--grace-minutes=<n>]
//
// `--project-ref` checks that project instead of the linked one. `--grace-minutes`
// forgives a function whose sources changed within that window, whose deploy is
// presumed still in flight; it defaults to 0, which is what a post-deploy
// assertion wants — there, every function must already be deployed.

import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import {
  bundleInputs,
  classifyFunctions,
  FUNCTIONS_SUBDIR,
  listFunctionSlugs,
  REPO_ROOT,
} from './lib/function-drift.js'

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
  console.log(`::${level} title=Function drift::${encoded}`)
}

function parseArgs(argv) {
  let projectRef = null
  let graceMinutes = 0
  for (const arg of argv) {
    // pnpm forwards the end-of-options marker verbatim, so `pnpm
    // check:function-drift -- --grace-minutes=30` arrives with it attached.
    if (arg === '--') {
      continue
    } else if (arg.startsWith('--project-ref=')) {
      projectRef = arg.slice('--project-ref='.length)
    } else if (arg.startsWith('--grace-minutes=')) {
      graceMinutes = Number(arg.slice('--grace-minutes='.length))
      if (!Number.isFinite(graceMinutes) || graceMinutes < 0) {
        die(`${arg}: expected a non-negative number of minutes.`)
      }
    } else {
      die(`${arg}: unknown flag. Usage: [--project-ref=<ref>] [--grace-minutes=<n>]`)
    }
  }
  return { projectRef, graceMinutes }
}

/** Slug -> `{ status, updatedAt }` for the functions the target project holds. */
function readDeployedFunctions(projectRef) {
  const target = projectRef ? ['--project-ref', projectRef] : []
  let stdout
  try {
    stdout = execFileSync(
      SUPABASE_BIN,
      ['functions', 'list', ...target, '--output-format', 'json', '--yes'],
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
    die(`supabase functions list produced no JSON document. Its output was:\n${stdout}`)
  }
  if (!Array.isArray(parsed.functions)) {
    die(
      `supabase functions list could not read the project's functions:\n${parsed.error?.message ?? stdout}`,
    )
  }

  const deployed = new Map()
  for (const row of parsed.functions) {
    if (!row.slug) continue
    deployed.set(row.slug, { status: row.status, updatedAt: new Date(row.updated_at) })
  }
  return deployed
}

/** Slug -> the date the function's bundle inputs last changed on this branch. */
function readRepoFunctions() {
  const repo = new Map()
  for (const slug of listFunctionSlugs()) {
    const inputs = bundleInputs(slug).map((file) => join(FUNCTIONS_SUBDIR, file))
    repo.set(slug, lastChangedAt(inputs))
  }
  if (repo.size === 0) {
    die(`${FUNCTIONS_SUBDIR}/ holds no function directory with an index.ts.`)
  }
  return repo
}

/** When any of the paths last changed on this branch, or null if none is committed. */
function lastChangedAt(paths) {
  let stdout
  try {
    stdout = execFileSync('git', ['log', '-1', '--format=%cI', '--', ...paths], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
  const changed = stdout ? new Date(stdout) : null
  return changed && !Number.isNaN(changed.getTime()) ? changed : null
}

function describeAge(date, label) {
  if (!date) return `${label} unknown`
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000)
  if (minutes < 60) return `${label} ${minutes}m ago`
  if (minutes < 48 * 60) return `${label} ${Math.round(minutes / 60)}h ago`
  return `${label} ${Math.round(minutes / (24 * 60))}d ago`
}

/** Why the function counts as stale, in the terms the reader can act on. */
function describeReason(row) {
  const source = describeAge(row.changedAt, 'source changed')
  if (row.reason === 'missing') return `${source}, not deployed at all`
  if (row.reason === 'inactive') return `${source}, deployed but ${row.status}`
  return `${source}, ${describeAge(row.deployedAt, 'deployed')}`
}

function asList(rows) {
  const width = Math.max(...rows.map((row) => row.slug.length))
  return rows.map((row) => `  ${row.slug.padEnd(width)}  ${describeReason(row)}`).join('\n')
}

const { projectRef, graceMinutes } = parseArgs(process.argv.slice(2))
const targetLabel = projectRef ? `project ${projectRef}` : 'the linked project'

const repo = readRepoFunctions()
const deployed = readDeployedFunctions(projectRef)
const { current, stale, inFlight, orphans } = classifyFunctions({ repo, deployed, graceMinutes })

// A function deployed with no directory behind it still serves traffic nobody in
// the repo can account for, which is worth saying out loud — but its remedy
// deletes a live endpoint, so it warns rather than fails. Reserving the failure
// for a function that is behind keeps the one signal with a safe fix meaningful.
if (orphans.length > 0) {
  const report = [
    `Deployed to ${targetLabel} with no directory in ${FUNCTIONS_SUBDIR}/, so it serves`,
    `traffic nothing in the repo defines (${orphans.length} of ${deployed.size} deployed):`,
    '',
    ...orphans.map((slug) => `  ${slug}`),
    '',
    'Commit the function that produced each, or delete it with',
    '`supabase functions delete <slug>`.',
  ].join('\n')
  console.error(report)
  annotate('warning', report)
}

if (inFlight.length > 0) {
  console.log(
    [
      `Changed within the last ${graceMinutes}m and not yet deployed to ${targetLabel},`,
      `so treated as a deploy still in flight (${inFlight.length} of ${repo.size}):`,
      '',
      asList(inFlight),
      '',
    ].join('\n'),
  )
}

if (stale.length > 0) {
  die(
    [
      `${FUNCTIONS_SUBDIR}/ is ahead of ${targetLabel}.`,
      `Functions the deployed copy does not match (${stale.length} of ${repo.size}):`,
      '',
      asList(stale),
      '',
      'Deploy them by dispatching the deploy workflow:',
      '',
      '  gh workflow run "Deploy functions"',
      '',
      'If that run reports no change for a function, the commit that dated it never',
      'reached the bundle, and no deploy can advance the timestamp. Narrow that',
      "function's bundle inputs in scripts/lib/function-drift.js instead of",
      'redeploying again.',
    ].join('\n'),
  )
}

console.log(
  `${current.length} of ${repo.size} functions in ${FUNCTIONS_SUBDIR}/ deployed to ${targetLabel} and active.`,
)
