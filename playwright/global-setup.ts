// Runs once before any worker starts.
// Previously this file also spawned the Go backend and wrote test-data/admin.json.
// Server startup has moved to the workerServer fixture in fixtures.ts so that each
// of the 5 workers gets its own isolated server instance (ports 8090–8094).
// This file now only cleans up stale processes and leftover test-data directories
// from previous runs.

import { type FullConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { killProcessesOnPort } from './helpers/server-utils';

const BASE_PORT = 8090;
const WORKER_COUNT = 5;

async function globalSetup(config: FullConfig) {
  if (process.env.SKIP_SETUP) {
    console.log('Global Setup: Skipping (SKIP_SETUP env var is set).');
    return;
  }

  console.log('Global Setup: Cleaning up stale processes and test data...');

  const cwd = config.rootDir;
  const baseDataDir = path.join(cwd, 'test-data');

  for (let i = 0; i < WORKER_COUNT; i++) {
    const port = BASE_PORT + i;
    try { killProcessesOnPort(port); } catch { /* ignore */ }

    const workerDir = path.join(baseDataDir, `worker-${i}`);
    fs.rmSync(workerDir, { recursive: true, force: true });
  }

  console.log('Global Setup: Done.');
}

export default globalSetup;
