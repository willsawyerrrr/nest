import { execSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

const underTest = Boolean(process.env.VITEST)

/**
 * The git commit the build was produced from. Vercel injects
 * `VERCEL_GIT_COMMIT_SHA`; falling back to the local `HEAD` covers manual and
 * dev builds. Stamped into the app so the changelog can hide entries newer than
 * the running build.
 */
function commitSha(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    return process.env.VERCEL_GIT_COMMIT_SHA
  }
  try {
    return execSync('git rev-parse HEAD').toString().trim()
  } catch {
    return ''
  }
}

export default defineConfig({
  define: {
    'import.meta.env.VITE_COMMIT_SHA': JSON.stringify(commitSha()),
  },
  plugins: [
    react(),
    ...(underTest
      ? []
      : [
          VitePWA({
            registerType: 'autoUpdate',
            injectRegister: false,
            // The worker is hand-written (`src/sw.ts`) so it can carry the Web
            // Push handlers; workbox only injects the precache manifest into it.
            strategies: 'injectManifest',
            srcDir: 'src',
            filename: 'sw.ts',
            includeAssets: ['icon.svg', 'icon-app.svg', 'favicon-32.png', 'apple-touch-icon.png'],
            manifest: {
              name: 'nest',
              short_name: 'nest',
              description: 'Household income, tax, spending, and savings',
              theme_color: '#0b0f14',
              background_color: '#0b0f14',
              display: 'standalone',
              start_url: '/',
              icons: [
                { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
                { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
                {
                  src: 'pwa-maskable-512.png',
                  sizes: '512x512',
                  type: 'image/png',
                  purpose: 'maskable',
                },
                { src: 'icon-app.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
              ],
            },
          }),
        ]),
  ],
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    pool: 'threads',
    // `lib/supabase.ts` throws at import time without these, which a test would
    // otherwise need env vars for just to render a component that touches
    // Supabase transitively — even one that mocks `../lib/supabase` outright and
    // never reaches this module's own initialisation.
    env: {
      VITE_SUPABASE_URL: 'https://test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
    // The form-component tests mount the whole Mantine form dozens of times each
    // and drive it through long `userEvent` sequences. They run in a second or
    // two locally, but a loaded `test-shard` runner can tip the heaviest case
    // past the 5s default and fail the whole job on green code. Give every test
    // headroom; a real hang still fails, just later.
    testTimeout: 15_000,
  },
})
