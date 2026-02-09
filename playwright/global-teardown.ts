import { execSync } from 'node:child_process';
import { type FullConfig } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

async function globalTeardown(config: FullConfig) {
  console.log('Global Teardown: Opening test report...');

  const reportPath = path.join(config.rootDir, 'playwright-report', 'index.html');
  // macOS 'open' command opens files in the default application (browser for .html)
  try {
    execSync(`open "${reportPath}"`);
  } catch (error) {
    console.error('Failed to open test report:', error);
  }

  const logPath = path.join(config.rootDir, 'test-data', 'backend.log');

  if (fs.existsSync(logPath)) {
    const logs = fs.readFileSync(logPath, 'utf-8');
    const lines = logs.split('\n');
    const problems = lines.filter(line => line.includes('WARN') || line.includes('ERROR'));

    console.error('\n\n==================================================');
    if (problems.length > 0) {
      console.error('--- Backend Log Issues ---');
      problems.forEach(p => console.error(p));
      console.error('--------------------------');
    } else {
      console.error('Backend logs are clean (no WARN/ERROR).');
    }
    console.error('==================================================\n\n');
  } else {
    console.error(`\n\nBackend log file not found at: ${logPath}\n\n`);
  }

  // Allow extra time for logs to flush
  await new Promise(resolve => setTimeout(resolve, 500));
}

export default globalTeardown;
