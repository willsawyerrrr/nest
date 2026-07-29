import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*', 'scripts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/tax/src/**', 'packages/plan/src/**', 'apps/pwa/src/**'],
      exclude: [
        'apps/pwa/src/main.tsx',
        'apps/pwa/src/lib/database.types.ts',
        'apps/pwa/src/lib/supabase.ts',
        'apps/pwa/src/lib/domain.ts',
        'apps/pwa/src/pwa.ts',
        // Worker-scope registration, like `pwa.ts`. Its payload parsing and
        // click-target resolution live in `lib/push.ts` and are tested there.
        'apps/pwa/src/sw.ts',
        'apps/pwa/src/vite-env.d.ts',
        'apps/pwa/src/test/**',
        '**/*.test.*',
        '**/*.d.ts',
      ],
      // Gate the money-critical packages at (or just below) their current
      // measured coverage, so the thresholds pass today and catch regressions.
      // A single test shard only exercises part of the suite, so its coverage
      // is partial by construction; the shard steps set
      // VITEST_SKIP_COVERAGE_THRESHOLDS to skip the check while still recording
      // a blob report, and the merge step evaluates the thresholds against the
      // combined coverage of every shard.
      thresholds: process.env.VITEST_SKIP_COVERAGE_THRESHOLDS
        ? undefined
        : {
            'packages/tax/**': {
              statements: 100,
              branches: 100,
              functions: 100,
              lines: 100,
            },
            'packages/plan/**': {
              statements: 100,
              branches: 100,
              functions: 100,
              lines: 100,
            },
            'apps/pwa/**': {
              statements: 100,
              branches: 93,
              functions: 100,
              lines: 100,
            },
            // The app-level money logic is held to the same bar as the pure
            // packages: every reachable branch is covered, so it gates at 100%
            // branches while the rest of apps/pwa keeps the lower branch floor.
            'apps/pwa/src/lib/**': {
              branches: 100,
            },
          },
    },
  },
})
