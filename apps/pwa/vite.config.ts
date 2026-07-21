import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

const underTest = Boolean(process.env.VITEST)

export default defineConfig({
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
              theme_color: '#0b4f4f',
              background_color: '#0b4f4f',
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
