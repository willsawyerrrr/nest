import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const underTest = Boolean(process.env.VITEST)

export default defineConfig({
  plugins: [
    react(),
    ...(underTest
      ? []
      : [
          VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['icon.svg'],
            manifest: {
              name: 'Personal Budget',
              short_name: 'Budget',
              description: 'Household income, tax, spending, and savings',
              theme_color: '#1864ab',
              background_color: '#1864ab',
              display: 'standalone',
              start_url: '/',
              icons: [
                {
                  src: 'icon.svg',
                  sizes: 'any',
                  type: 'image/svg+xml',
                  purpose: 'any maskable',
                },
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
