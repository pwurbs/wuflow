// Shared infrastructure helpers used by global-setup.ts and the worker fixture in fixtures.ts.

import { execSync } from 'node:child_process';

export function killProcessesOnPort(port: number | string): void {
  const pids = execSync(`lsof -t -i:${port} || true`).toString().trim(); //NOSONAR
  if (!pids) return;
  for (const pid of pids.split('\n').filter(p => p.trim())) {
    try {
      execSync(`kill -9 ${pid}`); //NOSONAR
    } catch {
      // Process may have already exited
    }
  }
}

export async function waitForServer(url: string): Promise<void> {
  const maxRetries = 30;
  for (let i = 0; i < maxRetries; i++) {
    try {
      execSync(`curl -s -f ${url}`); //NOSONAR
      return;
    } catch {
      await new Promise(r => setTimeout(r, 1000));
      if (i % 5 === 0) console.log(`Waiting for ${url}... (${i}/${maxRetries})`);
    }
  }
  throw new Error(`Server at ${url} did not start within ${maxRetries} seconds`);
}
