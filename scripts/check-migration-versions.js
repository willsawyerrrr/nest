// Asserts every migration filename carries a unique version.
//
// `supabase_migrations.schema_migrations.version` is the primary key Supabase
// records an applied migration under, so two files sharing a version collapse to
// one row: `db push` sees the version as applied and skips the second file
// without an error. The skipped migration never reaches prod even though its
// branch merged green, which makes uniqueness a build-time invariant rather than
// a review-time one.

import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations')

// Supabase parses the version as the digits before the first underscore; the
// rest is a human label. A name that does not match has no parseable version.
const FILENAME = /^(\d{14})_[a-z0-9_]+\.sql$/

const files = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort()

const errors = []
const byVersion = new Map()

for (const file of files) {
  const match = FILENAME.exec(file)
  if (!match) {
    errors.push(`${file}: not a <14-digit version>_<lower_snake_case name>.sql filename`)
    continue
  }
  const [, version] = match
  const seen = byVersion.get(version)
  if (seen) {
    errors.push(`Duplicate migration version ${version}:\n  ${seen}\n  ${file}`)
  } else {
    byVersion.set(version, file)
  }
}

if (errors.length > 0) {
  console.error(
    `${errors.join('\n')}\n\nGive each migration its own version, or it will not deploy.`,
  )
  process.exit(1)
}

console.log(`${files.length} migrations, all versions unique.`)
