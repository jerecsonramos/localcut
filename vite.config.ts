import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'node:fs'
import path from 'node:path'

function localFfmpegAssets() {
  const root = path.resolve(process.cwd(), 'node_modules')
  const assets = {
    'ffmpeg-core.js': path.join(root, '@ffmpeg', 'core', 'dist', 'esm', 'ffmpeg-core.js'),
    'ffmpeg-core.wasm': path.join(root, '@ffmpeg', 'core', 'dist', 'esm', 'ffmpeg-core.wasm'),
    'worker.js': path.join(root, '@ffmpeg', 'ffmpeg', 'dist', 'esm', 'worker.js'),
    'const.js': path.join(root, '@ffmpeg', 'ffmpeg', 'dist', 'esm', 'const.js'),
    'errors.js': path.join(root, '@ffmpeg', 'ffmpeg', 'dist', 'esm', 'errors.js'),
  }

  return {
    name: 'local-ffmpeg-assets',
    configureServer(server: { middlewares: { use: (handler: (request: { url?: string }, response: { setHeader: (name: string, value: string) => void; end: (body: Buffer) => void }, next: () => void) => void) => void } }) {
      server.middlewares.use((request, response, next) => {
        const assetName = request.url?.split('?')[0]?.replace(/^\/ffmpeg\//, '')
        if (!assetName || !(assetName in assets)) {
          next()
          return
        }
        const filePath = assets[assetName as keyof typeof assets]
        response.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        response.setHeader('Content-Type', assetName.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
        response.end(fs.readFileSync(filePath))
      })
    },
    generateBundle(this: { emitFile: (asset: { type: 'asset'; fileName: string; source: Buffer }) => void }) {
      for (const [assetName, filePath] of Object.entries(assets)) {
        this.emitFile({ type: 'asset', fileName: `ffmpeg/${assetName}`, source: fs.readFileSync(filePath) })
      }
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    localFfmpegAssets(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'LocalCut — private media trimming',
        short_name: 'LocalCut',
        description: 'Trim audio and video privately, entirely on your device.',
        theme_color: '#f4f0e8',
        background_color: '#f4f0e8',
        display: 'standalone',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        navigateFallback: 'index.html',
        globPatterns: ['**/*.{js,css,html,svg,woff2,wasm}'],
        maximumFileSizeToCacheInBytes: 40 * 1024 * 1024,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
