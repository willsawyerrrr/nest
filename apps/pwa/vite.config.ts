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
            includeAssets: ['icon.svg', 'apple-touch-icon.png'],
            manifest: {
              name: 'Nest',
              short_name: 'Nest',
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
                { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
              ],
            },
          }),
        ]),
  ],
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    pool: 'threads',
  },
})
