import { execSync } from 'node:child_process';
import { type FullConfig } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

const WORKER_COUNT = 5;

async function globalTeardown(config: FullConfig) {
  console.log('Global Teardown: Opening test report...');

  const reportPath = path.join(config.rootDir, 'playwright-report', 'index.html');
  try {
    execSync(`open "${reportPath}"`); //NOSONAR
  } catch (error) {
    console.error('Failed to open test report:', error);
  }

  const baseDataDir = path.join(config.rootDir, 'test-data');
  const allProblems: string[] = [];

  for (let i = 0; i < WORKER_COUNT; i++) {
    const logPath = path.join(baseDataDir, `worker-${i}`, 'backend.log');
    if (!fs.existsSync(logPath)) continue;

    const lines = fs.readFileSync(logPath, 'utf-8').split('\n');
    const problems = lines.filter(line => line.includes('WARN') || line.includes('ERROR'));
    if (problems.length > 0) {
      allProblems.push(`--- Worker ${i} (port ${8090 + i}) ---`, ...problems);
    }
  }

  console.error('\n\n==================================================');
  if (allProblems.length > 0) {
    console.error('--- Backend Log Issues ---');
    allProblems.forEach(p => console.error(p));
    console.error('--------------------------');
  } else {
    console.error('Backend logs are clean (no WARN/ERROR).');
  }
  console.error('==================================================\n\n');

  await new Promise(resolve => setTimeout(resolve, 500));
}

export default globalTeardown;
