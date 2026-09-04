// Brings up the whole app locally with one command: the local Supabase stack
// (Docker), every migration applied, a signed-in dev session, and the PWA dev
// server — so trying out a change never again means hand-assembling a login
// via curl and psql.
//
// A Google-only auth screen (see CLAUDE.md) has nothing to sign in with
// locally, and the local stack starts empty, so a bare `pnpm dev` leaves
// nothing to click past the login screen. This script seeds a two-member
// household, mints a one-time magic-link sign-in for its first member via
// GoTrue's admin API (no Google credentials needed), and prints it before
// handing off to Vite. Every step is idempotent: rerunning after a
// `supabase db reset`, or with the stack already up, converges to the same
// state rather than erroring or duplicating rows.
//
// `migration up` only applies versions the local database has not recorded, so
// a migration edited in place after it was first applied leaves the local schema
// behind the repo. `--reset` swaps it for `supabase db reset`, which drops the
// database and replays every migration from scratch — the one command to run
// when `pnpm db:types` or the app disagree with `supabase/migrations/`.
//
// Usage:
//   node scripts/dev-app.js [--port=<n>] [--reset]

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from './lib/migration-files.js'

// The CLI the lockfile pins, matching how the drift checks resolve it.
const SUPABASE_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'supabase')
const PWA_DIR = join(REPO_ROOT, 'apps', 'pwa')
const ENV_PATH = join(PWA_DIR, '.env')

const HOUSEHOLD_NAME = 'Local dev household'
const DEV_MEMBERS = [
  { name: 'Alice', email: 'alice@dev.local' },
  { name: 'Bob', email: 'bob@dev.local' },
]

function die(message) {
  console.error(message)
  process.exit(1)
}

function parsePort(argv) {
  for (const arg of argv) {
    if (arg.startsWith('--port=')) {
      const port = Number(arg.slice('--port='.length))
      if (!Number.isInteger(port) || port <= 0) die(`${arg}: expected a positive port number.`)
      return port
    }
  }
  return 5173 // Vite's own default — also the port docs/README.md tells a developer to expect.
}

const wantsReset = (argv) => argv.includes('--reset')

function supabase(args, errorHint) {
  try {
    return execFileSync(SUPABASE_BIN, args, { cwd: REPO_ROOT, encoding: 'utf8' })
  } catch (error) {
    die(`${errorHint ?? `supabase ${args.join(' ')} failed`}:\n${error.stderr ?? error.message}`)
  }
}

function readStatus() {
  try {
    return JSON.parse(supabase(['status', '-o', 'json']))
  } catch (error) {
    die(
      `Could not read the local Supabase stack's status. Is Docker running?\n${error.stderr ?? error.message}`,
    )
  }
}

/** Runs SQL against the local database as its owning `postgres` role — used for
 * seeding, since `service_role` (what `rest()` below authenticates as) has no
 * table grants of its own: the app reaches Postgres only through RLS-gated
 * `authenticated` requests or specific SECURITY DEFINER RPCs, neither of which
 * a generic seed can piggyback on. */
function dbQuery(sql, errorHint) {
  try {
    const stdout = execFileSync(SUPABASE_BIN, ['db', 'query', '--local', sql, '-o', 'json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
    return JSON.parse(stdout).rows
  } catch (error) {
    die(`${errorHint ?? 'Local database query failed'}:\n${error.stderr ?? error.message}`)
  }
}

const sqlQuote = (value) => `'${value.replace(/'/g, "''")}'`

async function rest(status, path, init = {}) {
  const response = await fetch(`${status.API_URL}${path}`, {
    ...init,
    headers: {
      apikey: status.SERVICE_ROLE_KEY,
      Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  if (!response.ok) {
    die(`${init.method ?? 'GET'} ${path} -> ${response.status}: ${await response.text()}`)
  }
  return response.status === 204 ? null : response.json()
}

/** Finds an auth user by email, or creates one — email/password local dev has
 * no confirmation step to wait on, so the user is ready to sign in immediately. */
async function getOrCreateAuthUser(status, email, name) {
  const created = await fetch(`${status.API_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: status.SERVICE_ROLE_KEY,
      Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, email_confirm: true, user_metadata: { name } }),
  })
  if (created.ok) return created.json()

  // Already registered from a previous run — look it up instead.
  const list = await rest(status, `/auth/v1/admin/users?page=1&per_page=200`)
  const existing = list.users?.find((user) => user.email === email)
  if (!existing) die(`Could not create or find the auth user for ${email}.`)
  return existing
}

/** Finds a household by name, or creates one — `households` has no unique
 * constraint on `name`, so this reads before it writes rather than relying on
 * Postgres to dedupe. */
function getOrCreateHousehold() {
  const [existing] = dbQuery(
    `select id from public.households where name = ${sqlQuote(HOUSEHOLD_NAME)}`,
  )
  if (existing) return existing.id

  const [household] = dbQuery(
    `insert into public.households (name) values (${sqlQuote(HOUSEHOLD_NAME)}) returning id`,
  )
  return household.id
}

function ensureMember(householdId, userId, name, email) {
  // `-o json` only emits JSON for a query with a result set, so every seed
  // query here carries `returning id` even where the id itself is unused.
  dbQuery(
    `insert into public.members (household_id, user_id, name, email)
     values (${sqlQuote(householdId)}, ${sqlQuote(userId)}, ${sqlQuote(name)}, ${sqlQuote(email)})
     on conflict (household_id, user_id) do nothing
     returning id`,
  )
}

/** A one-time sign-in link good for the first member — GoTrue redeems it
 * itself and hands the app a session, so no Google OAuth client is needed
 * locally. */
async function generateSignInLink(status, email, redirectTo) {
  const link = await rest(status, '/auth/v1/admin/generate_link', {
    method: 'POST',
    body: JSON.stringify({ type: 'magiclink', email, redirect_to: redirectTo }),
  })
  return link.action_link
}

function ensureEnvFile(status) {
  if (existsSync(ENV_PATH)) {
    const contents = readFileSync(ENV_PATH, 'utf8')
    if (!contents.includes(status.API_URL)) {
      console.warn(
        `${ENV_PATH} exists and does not point at the local stack (${status.API_URL}) — leaving it as is.`,
      )
    }
    return
  }
  writeFileSync(
    ENV_PATH,
    `VITE_SUPABASE_URL=${status.API_URL}\nVITE_SUPABASE_ANON_KEY=${status.ANON_KEY}\n`,
  )
  console.log(`Wrote ${ENV_PATH} for the local stack.`)
}

async function main() {
  const argv = process.argv.slice(2)
  const port = parsePort(argv)
  const reset = wantsReset(argv)
  const redirectTo = `http://127.0.0.1:${port}`

  console.log('Starting the local Supabase stack...')
  console.log(supabase(['start'], 'Could not start the local stack — is Docker running?'))

  if (reset) {
    console.log('Resetting the local database and replaying every migration...')
    console.log(supabase(['db', 'reset', '--local'], 'Could not reset the local database'))
  } else {
    console.log('Applying any pending migrations...')
    console.log(supabase(['migration', 'up', '--local'], 'Could not apply pending migrations'))
  }

  const status = readStatus()
  ensureEnvFile(status)

  console.log('Seeding a local dev household...')
  const householdId = getOrCreateHousehold()
  const members = []
  for (const { name, email } of DEV_MEMBERS) {
    const user = await getOrCreateAuthUser(status, email, name)
    ensureMember(householdId, user.id, name, email)
    members.push({ name, email })
  }

  const [signInAs] = members
  const link = await generateSignInLink(status, signInAs.email, redirectTo)

  console.log('')
  console.log(`Sign in as ${signInAs.name} (${signInAs.email}) — open this link once:`)
  console.log(link)
  console.log('')
  console.log(`Household: "${HOUSEHOLD_NAME}" — members: ${members.map((m) => m.name).join(', ')}`)
  console.log('')
  console.log(`Starting the PWA dev server on port ${port}...`)

  // Runs Vite's own binary directly rather than through `pnpm --filter ...
  // dev --`: pnpm inserts a literal `--` ahead of forwarded args there, which
  // Vite's CLI treats as "everything after this is positional", silently
  // dropping --port/--host. Bound explicitly to 127.0.0.1 — Vite's default
  // host otherwise resolves to the IPv6 loopback on some machines, which the
  // sign-in link above (built against 127.0.0.1, matching
  // `supabase/config.toml`'s redirect allow-list) would then fail to reach.
  // --strictPort: the sign-in link above is already baked to this port, so
  // Vite silently falling back to the next free one (its own default) would
  // leave a link that redirects nowhere useful.
  const VITE_BIN = join(PWA_DIR, 'node_modules', '.bin', 'vite')
  const vite = spawn(VITE_BIN, ['--port', String(port), '--host', '127.0.0.1', '--strictPort'], {
    cwd: PWA_DIR,
    stdio: 'inherit',
  })
  vite.on('exit', (code) => process.exit(code ?? 0))
}

main()
