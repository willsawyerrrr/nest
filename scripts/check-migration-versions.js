// Asserts every migration filename carries a unique version.
//
// `supabase_migrations.schema_migrations.version` is the primary key Supabase
// records an applied migration under, so two files sharing a version collapse to
// one row: `db push` sees the version as applied and skips the second file
// without an error. The skipped migration never reaches prod even though its
// branch merged green, which makes uniqueness a build-time invariant rather than
// a review-time one.

import { FILENAME, listMigrationFiles } from './lib/migration-files.js'

const files = listMigrationFiles()

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
