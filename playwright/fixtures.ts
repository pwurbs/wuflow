// Custom Playwright fixtures for parallel test execution.
//
// workerServer (worker-scoped): spawns a dedicated Go backend per worker on ports 8090–8094,
//   each with its own isolated SQLite database under test-data/worker-{n}/.
// baseURL    (test-scoped):  overrides Playwright's baseURL to the worker's port.
// login      (test-scoped):  performs the standard admin login flow using per-worker credentials.

import { test as base, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { killProcessesOnPort, waitForServer } from './helpers/server-utils';

type WorkerFixtures = {
  workerServer: {
    port: number;
    adminEmail: string;
    adminPassword: string;
  };
};

type TestFixtures = {
  login: () => Promise<void>;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
  workerServer: [async ({}, use, workerInfo) => {
    const workerIndex = workerInfo.parallelIndex;
    const port = 8090 + workerIndex;

    const cwd = process.cwd();
    const isPlaywrightDir = path.basename(cwd) === 'playwright';
    const projectRoot = isPlaywrightDir ? path.join(cwd, '..') : cwd;
    const baseDataDir = isPlaywrightDir
      ? path.join(cwd, 'test-data')
      : path.join(cwd, 'playwright', 'test-data');
    const dbDir = path.join(baseDataDir, `worker-${workerIndex}`);
    const dbPath = path.join(dbDir, 'wuflow.db');
    const logPath = path.join(dbDir, 'backend.log');

    fs.rmSync(dbDir, { recursive: true, force: true });
    fs.mkdirSync(dbDir, { recursive: true });

    try { killProcessesOnPort(port); } catch { /* ignore */ }

    let version = 'dev';
    try {
      version = fs.readFileSync(path.join(projectRoot, 'VERSION'), 'utf-8').trim();
    } catch { /* use default */ }

    const adminPassword = `${crypto.randomBytes(16).toString('hex')}A1!`;
    const secretKey = crypto.randomBytes(32).toString('hex');
    const adminEmail = `superadmin-w${workerIndex}@test.local`;
    fs.writeFileSync(path.join(dbDir, 'admin.json'), JSON.stringify({ email: adminEmail, password: adminPassword, secretKey }));

    console.log(`[worker-${workerIndex}] Starting Go server on port ${port} with db ${dbPath}...`);
    const logFile = fs.openSync(logPath, 'w');

    const server = spawn(
      'go',
      [
        'run', `-ldflags=-X main.Version=${version}`, '.',
        `-port=${port}`,
        `-dbpath=${dbPath}`,
        `-initial-admin-email=${adminEmail}`,
        `-initial-admin-password=${adminPassword}`,
        `-secret-key=${secretKey}`,
        `-api-rate-limit=false`,
        `-remote-ip-header=X-Forwarded-For`,
      ],
      { detached: true, stdio: ['ignore', logFile, logFile], cwd: projectRoot }
    );
    server.unref();

    await waitForServer(`http://localhost:${port}`);
    console.log(`[worker-${workerIndex}] Server ready on port ${port}.`);

    await use({ port, adminEmail, adminPassword });

    // Kill the server process group (go run + the compiled binary it spawns)
    if (server.pid) {
      try {
        process.kill(-server.pid, 'SIGTERM');
        console.log(`[worker-${workerIndex}] Server on port ${port} terminated.`);
      } catch { /* already exited */ }
    }
  }, { scope: 'worker' }],

  baseURL: async ({ workerServer }, use) => {
    await use(`http://localhost:${workerServer.port}`);
  },

  login: async ({ page, workerServer }, use) => {
    await use(async () => {
      await page.goto('/login');
      await page.fill('#login-email', workerServer.adminEmail);
      await page.fill('#login-password', workerServer.adminPassword);
      await page.click('#login-btn');
      await expect(page.locator('#nav-board')).toBeVisible();
    });
  },
});

export { expect } from '@playwright/test';
export type { Page } from '@playwright/test';
