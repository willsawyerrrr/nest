/**
 * The React-free shaping of a household's raw database rows into `@nest/plan` /
 * `@nest/tax` engine inputs, and the whole-year + active-now tax estimate and
 * fortnightly buffer built on them. Imported by the PWA (for the instant
 * client-side reading) and, through the vendored copy, by the edge functions
 * (`notify-eval`, `intent-summary`), so the numbers a household files a tax
 * return on and asks Siri about have one implementation. Pure — no I/O, no
 * React.
 */

export * from './rows.ts'
