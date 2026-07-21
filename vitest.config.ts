import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/tax/**', 'packages/plan/**'],
      // Gate the money-critical packages at (or just below) their current
      // measured coverage, so the thresholds pass today and catch regressions.
      thresholds: {
        'packages/tax/**': {
          statements: 97,
          branches: 88,
          functions: 100,
          lines: 96,
        },
        'packages/plan/**': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
})
