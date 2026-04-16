// Previously: workers: 1, fullyParallel: false, baseURL hardcoded to localhost:8081.
// Each worker now gets its own Go server and SQLite database via the workerServer
// fixture in fixtures.ts. baseURL is therefore set dynamically there, not here.

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  globalSetup: './global-setup',
  globalTeardown: './global-teardown',
  fullyParallel: true,
  workers: 5,
  reporter: [['html', { open: 'never' }]],
  use: {
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Uncomment below for full cross-browser testing
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],
});
