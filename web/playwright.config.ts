import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node e2e/fixture-server.mjs',
      url: 'http://127.0.0.1:8790/healthz',
      reuseExistingServer: false,
      timeout: 10_000,
    },
    {
      command: 'pnpm dev --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173',
      env: { DEV_API_PROXY_TARGET: 'http://127.0.0.1:8790' },
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
})
