import { defineConfig } from 'vitest/config'

// The repo scripts are plain Node ESM outside the pnpm workspace, so they carry
// their own Vitest project rather than joining a package's.
export default defineConfig({
  test: {
    name: 'scripts',
    environment: 'node',
    pool: 'threads',
  },
})
