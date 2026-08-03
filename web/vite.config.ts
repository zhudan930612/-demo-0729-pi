import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { copyFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const webDir = dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), { name:'third-party-notices', closeBundle(){ copyFileSync(resolve(webDir,'THIRD_PARTY_NOTICES.md'),resolve(webDir,'dist/THIRD_PARTY_NOTICES.md')) } }],
  test: {
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
  server: {
    proxy: {
      '/api': {
        target: process.env.DEV_API_PROXY_TARGET || 'http://127.0.0.1:8787',
        changeOrigin: false,
      },
    },
  },
})
