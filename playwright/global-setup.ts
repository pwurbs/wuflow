import { execSync, spawn } from 'node:child_process';
import { type FullConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

function killProcessesOnPort(port: string): void {
  console.log(`Checking for existing process on port ${port}...`);
  const pids = execSync(`lsof -t -i:${port} || true`).toString().trim();
  if (!pids) return;

  const pidList = pids.split('\n').filter(p => p.trim());
  for (const pid of pidList) {
    console.log(`Killing existing process (PID ${pid}) on port ${port}...`);
    try {
      execSync(`kill -9 ${pid}`);
    } catch (killError) {
      console.log(`Failed to kill PID ${pid}:`, killError);
    }
  }
}

function cleanupDatabase(dbDir: string): void {
  if (fs.existsSync(dbDir)) {
    console.log(`Cleaning up database directory at ${dbDir}...`);
    fs.rmSync(dbDir, { recursive: true, force: true });
  }
}

async function waitForServer(targetURL: string): Promise<void> {
  console.log(`Waiting for application at ${targetURL}...`);
  const maxRetries = 30;
  const delayMs = 1000;

  for (let i = 0; i < maxRetries; i++) {
    try {
      execSync(`curl -s -f ${targetURL}`);
      console.log('Application is ready!');
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, delayMs));
      if (i % 5 === 0) console.log(`Waiting... (${i}/${maxRetries})`);
    }
  }
  throw new Error('Application failed to start within 30 seconds');
}

async function globalSetup(config: FullConfig) {
  if (process.env.SKIP_SETUP) {
    console.log('Global Setup: Skipping (SKIP_SETUP env var is set). Assumes manual server start.');
    return;
  }

  console.log('Global Setup: Starting local Go server...');

  const port = '8081';
  const { baseURL } = config.projects[0].use;
  const targetURL = baseURL || `http://localhost:${port}`;

  const cwd = process.cwd();
  const isPlaywrightDir = path.basename(cwd) === 'playwright';

  const dbDir = isPlaywrightDir
    ? path.join(cwd, 'test-data')
    : path.join(cwd, 'playwright', 'test-data');
  const dbPath = path.join(dbDir, 'wuflow.db');
  const logPath = path.join(dbDir, 'backend.log');

  // 1. Cleanup
  try {
    killProcessesOnPort(port);
    cleanupDatabase(dbDir);
  } catch (e) {
    console.log('Cleanup error (ignored):', e);
  }

  // 2. Start Go server
  try {
    console.log(`Starting Go server on port ${port} with db ${dbPath}...`);

    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    const logFile = fs.openSync(logPath, 'w');

    const projectRoot = isPlaywrightDir ? path.join(cwd, '..') : cwd;
    const versionPath = path.join(projectRoot, 'VERSION');
    let version = 'dev';
    try {
      if (fs.existsSync(versionPath)) {
        version = fs.readFileSync(versionPath, 'utf-8').trim();
      }
    } catch (e) {
      console.log('Failed to read VERSION file, using default "dev":', e);
    }

    console.log(`Using application version: ${version}`);
    console.log(`Redirecting backend logs to: ${logPath}`);

    const server = spawn('go', ['run', `-ldflags=-X main.Version=${version}`, '.', `-port=${port}`, `-dbpath=${dbPath}`], {
      detached: true,
      stdio: ['ignore', logFile, logFile],
      cwd: projectRoot
    });

    server.unref();

    // 3. Wait for readiness
    await waitForServer(targetURL);

  } catch (error) {
    console.error('Error in global setup:', error);
    throw error;
  }
}

export default globalSetup;
