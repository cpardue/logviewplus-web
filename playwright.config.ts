import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 300_000,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4173/logviewplus-web/',
  },
  webServer: {
    command: 'npm run preview',
    url: 'http://127.0.0.1:4173/logviewplus-web/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
