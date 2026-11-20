import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    // Installable app that opens from the device's cache with no signal.
    // Only active in the built app (npm run build + npm run preview, or once hosted), not in npm run dev.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['dbp-logo.svg', 'dbp-logo.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'du Boulay Projects',
        short_name: 'DBP',
        description: 'du Boulay Projects super app',
        theme_color: '#1f1246',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, // the Excel library is ~1 MB
        navigateFallback: 'index.html',
      },
    }),
  ],
  server: { port: 5173, open: true },
})
