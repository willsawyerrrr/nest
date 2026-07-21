import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/tax/**', 'packages/plan/**', 'apps/pwa/src/**'],
      exclude: [
        'apps/pwa/src/main.tsx',
        'apps/pwa/src/lib/database.types.ts',
        'apps/pwa/src/lib/supabase.ts',
        'apps/pwa/src/lib/domain.ts',
        'apps/pwa/src/pwa.ts',
        'apps/pwa/src/vite-env.d.ts',
        'apps/pwa/src/test/**',
        '**/*.test.*',
        '**/*.d.ts',
      ],
      // Gate the money-critical packages at (or just below) their current
      // measured coverage, so the thresholds pass today and catch regressions.
      thresholds: {
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
      },
    },
  },
})
