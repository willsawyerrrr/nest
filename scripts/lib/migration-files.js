// The naming contract for `supabase/migrations/`, shared by the two checks that
// depend on it: `check-migration-versions.js` asserts it holds, and
// `check-migration-drift.js` reads versions back out of it.

import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

export const REPO_ROOT = join(HERE, '..', '..')
export const MIGRATIONS_SUBDIR = join('supabase', 'migrations')
export const MIGRATIONS_DIR = join(REPO_ROOT, MIGRATIONS_SUBDIR)

// Supabase parses the version as the digits before the first underscore; the
// rest is a human label. A name that does not match has no parseable version.
export const FILENAME = /^(\d{14})_[a-z0-9_]+\.sql$/

/** Every `.sql` file in the migrations directory, in version order. */
export function listMigrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
}
