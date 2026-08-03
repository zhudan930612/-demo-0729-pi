import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
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
