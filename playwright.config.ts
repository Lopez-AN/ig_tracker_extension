import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45000,
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5173', viewport: { width: 1536, height: 1024 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI },
});
