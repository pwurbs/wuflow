import { execSync } from 'node:child_process';
import { type FullConfig } from '@playwright/test';
import path from 'node:path';

async function globalTeardown(config: FullConfig) {
  console.log('Global Teardown: Opening test report...');

  const reportPath = path.join(config.rootDir, 'playwright-report', 'index.html');

  try {
    // macOS 'open' command opens files in the default application (browser for .html)
    execSync(`open "${reportPath}"`);
  } catch (error) {
    console.error('Failed to open test report:', error);
  }
}

export default globalTeardown;
