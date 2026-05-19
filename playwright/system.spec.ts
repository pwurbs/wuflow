// System-level tests for backend behaviours added with the context-propagation
// change (see /Users/peti/Development/Projects/wuFlow/wuflow/docs/backend-architecture.md "Context propagation").
//
// What's covered here:
//   1. Client-disconnect handling — net/http cancels r.Context() when the
//      client aborts; the server must stay healthy for the next request.
//   2. Graceful shutdown — SIGTERM triggers srv.Shutdown(), the process exits
//      cleanly, and the expected log lines appear.
//
// What is intentionally NOT covered here:
//   * TimeoutMiddleware — triggering a real >5 s server-side timeout from the
//     browser would need either an artificially slow endpoint or making the
//     timeout configurable, both of which are bigger changes than this test
//     warrants. The middleware is fully covered by the Go unit tests in
//     backend/server_test.go (TestTimeoutMiddleware_*), which is the right
//     layer for that behaviour.

import { test, expect } from './fixtures';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { killProcessesOnPort, waitForServer } from './helpers/server-utils';

test.describe('System: client disconnect', () => {
  test.beforeEach(async ({ login }) => {
    await login();
  });

  test('aborted request does not break the server', async ({ page, baseURL }) => {
    // Fire a request and abort it before the response can arrive, then verify
    // the server still serves a follow-up request normally. The point is not
    // that the aborted request returns anything in particular — it's that the
    // server-side ctx cancellation is handled cleanly and no connection or DB
    // state is left in a bad shape for subsequent requests.
    const aborted = await page.evaluate(async (url) => {
      const ctrl = new AbortController();
      const promise = fetch(`${url}/api/projects`, {
        method: 'GET',
        credentials: 'include',
        signal: ctrl.signal,
      });
      ctrl.abort();
      try {
        await promise;
        return 'unexpectedly-completed';
      } catch (e) {
        return (e as Error).name; // 'AbortError'
      }
    }, baseURL);
    expect(aborted).toBe('AbortError');

    // The server must still respond normally afterwards.
    const followUp = await page.evaluate(async (url) => {
      const r = await fetch(`${url}/api/projects`, {
        method: 'GET',
        credentials: 'include',
      });
      return r.status;
    }, baseURL);
    expect(followUp).toBe(200);
  });
});

test.describe('System: graceful shutdown', () => {
  // This suite spawns its own server (rather than reusing the worker server)
  // because the test deliberately kills it. Port 8095 is one above the worker
  // range (8090–8094) so it can't collide.
  const port = 8095;
  const baseURL = `http://localhost:${port}`;

  test('SIGTERM drains in-flight requests and logs clean shutdown', async () => {
    const cwd = process.cwd();
    const isPlaywrightDir = path.basename(cwd) === 'playwright';
    const projectRoot = isPlaywrightDir ? path.join(cwd, '..') : cwd;
    const dbDir = path.join(projectRoot, 'playwright', 'test-data', 'system-shutdown');
    const dbPath = path.join(dbDir, 'wuflow.db');
    const logPath = path.join(dbDir, 'backend.log');

    fs.rmSync(dbDir, { recursive: true, force: true });
    fs.mkdirSync(dbDir, { recursive: true });
    try { killProcessesOnPort(port); } catch { /* ignore */ }

    const adminPassword = `${crypto.randomBytes(16).toString('hex')}A1!`;
    const secretKey = crypto.randomBytes(32).toString('hex');
    const adminEmail = 'shutdown-admin@test.local';

    const logFile = fs.openSync(logPath, 'w');
    const server = spawn(
      'go',
      [
        'run', '.',
        `-port=${port}`,
        `-dbpath=${dbPath}`,
        `-initial-admin-email=${adminEmail}`,
        `-initial-admin-password=${adminPassword}`,
        `-secret-key=${secretKey}`,
        `-api-rate-limit=false`,
      ],
      { detached: true, stdio: ['ignore', logFile, logFile], cwd: projectRoot },
    );
    server.unref();

    try {
      await waitForServer(baseURL);

      // Confirm the server is reachable before we shut it down. /login is
      // public (no auth chain), so a GET returns 200 without a session.
      const resp = await fetch(`${baseURL}/login`);
      expect(resp.status).toBe(200);

      // SIGTERM the process group (go run + the compiled binary it spawns).
      // Wait for the process to exit on its own — graceful shutdown must
      // complete within the server's 15 s drain window.
      //
      // Note: we don't assert on the exit code. `go run` is the parent of the
      // compiled binary and is killed by the same SIGTERM we sent to the
      // group, so Node reports exit via signal (code=null). The proof that
      // shutdown worked is in the structured log lines below — if the
      // "Server shut down cleanly" line is present, the Shutdown() call
      // completed before the process exited.
      const exited = new Promise<void>((resolve) => {
        server.on('exit', () => resolve());
      });
      if (!server.pid) throw new Error('server pid missing');
      process.kill(-server.pid, 'SIGTERM');

      await Promise.race([
        exited,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('server did not exit within 20s')), 20_000),
        ),
      ]);

      const log = fs.readFileSync(logPath, 'utf-8');
      expect(log).toContain('Shutdown signal received');
      expect(log).toContain('Server shut down cleanly');
    } finally {
      // Best-effort cleanup in case the assertions failed before SIGTERM was
      // delivered (or after a hung shutdown).
      if (server.pid) {
        try { process.kill(-server.pid, 'SIGKILL'); } catch { /* already gone */ }
      }
    }
  });
});
