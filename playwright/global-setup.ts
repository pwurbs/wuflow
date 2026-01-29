import { execSync } from 'node:child_process';
import { type FullConfig } from '@playwright/test';

async function globalSetup(config: FullConfig) {
  console.log('Global Setup: Restarting test container...');

  // 1. Cleanup existing container
  try {
    console.log('Stopping and removing existing wutrak-test container...');
    // We redirect stderr to null to avoid noise if container doesn't exist
    execSync('container stop wutrak-test 2>/dev/null || true');
    execSync('container rm wutrak-test 2>/dev/null || true');
  } catch (e) {
    // Ignore errors during cleanup
    console.log('Cleanup error (ignored):', e);
  }

  // 2. Start new container
  try {
    const { baseURL } = config.projects[0].use;
    console.log(`Starting new test container at port 8080...`);
    execSync('container run -d -p 8080:8080 --name wutrak-test wutrak');

    // 3. Wait for readiness
    console.log(`Waiting for application at ${baseURL || 'http://localhost:8080'}...`);
    const maxRetries = 30;
    const delayMs = 1000;

    for (let i = 0; i < maxRetries; i++) {
      try {
        // Check if server returns 200 (or any response)
        execSync(`curl -s -f ${baseURL || 'http://localhost:8080'}`);
        console.log('Application is ready!');
        return;
      } catch {
        await new Promise(resolve => setTimeout(resolve, delayMs));
        if (i % 5 === 0) console.log(`Waiting... (${i}/${maxRetries})`);
      }
    }
    throw new Error('Application failed to start within 30 seconds');

  } catch (error) {
    console.error('Error in global setup:', error);
    throw error;
  }
}

export default globalSetup;
