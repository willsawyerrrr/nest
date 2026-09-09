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

/**
 * Whether a 14-digit version reads as a real `YYYYMMDDHHMMSS` moment: a month in
 * 1–12, a day that exists in that month, and hours/minutes/seconds in range. The
 * regex alone accepts `20260931000000` (September 31st) or a month of `13`,
 * which is never an intended timestamp — a fat-fingered digit rather than a
 * deliberate value — and reads oddly in the ordered list.
 */
export function isValidVersionTimestamp(version) {
  const year = Number(version.slice(0, 4))
  const month = Number(version.slice(4, 6))
  const day = Number(version.slice(6, 8))
  const hour = Number(version.slice(8, 10))
  const minute = Number(version.slice(10, 12))
  const second = Number(version.slice(12, 14))
  if (month < 1 || month > 12) return false
  if (hour > 23 || minute > 59 || second > 59) return false
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day >= 1 && day <= daysInMonth
}

/** Every `.sql` file in the migrations directory, in version order. */
export function listMigrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
}
