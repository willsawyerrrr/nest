/**
 * Runs the golden parity fixtures through the VENDORED `@nest/household` — the
 * copy the edge functions actually import — and asserts each frozen `expected`.
 * The vitest `packages/household/src/parity.test.ts` runs the same cases through
 * the package source. If the vendored copy drifts, or the two implementations
 * disagree, one of the two suites fails.
 */

import { assertEquals } from '@std/assert'
import {
  runSummaryCase,
  runTaxCase,
  summaryParityCases,
  taxParityCases,
} from './vendor/household/goldenCases.ts'

for (const parityCase of taxParityCases) {
  Deno.test(`golden parity — tax — ${parityCase.label}`, () => {
    assertEquals(runTaxCase(parityCase), parityCase.expected)
  })
}

for (const parityCase of summaryParityCases) {
  Deno.test(`golden parity — buffer — ${parityCase.label}`, () => {
    assertEquals(runSummaryCase(parityCase), parityCase.expected)
  })
}
