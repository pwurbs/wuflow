import { test, expect } from './fixtures';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Helper to generate random pass
function generatePassword() {
  return `${crypto.randomBytes(16).toString('hex')}U1!`;
}


let adminEmail = 'admin@local';
let adminPassword = '';

test.describe('Authentication Security', () => {

  // Admin credentials previously read from test-data/admin.json; now supplied by the
  // workerServer fixture in fixtures.ts, which spawns a dedicated server per worker.
  test.beforeAll(async ({ workerServer }) => {
    adminEmail = workerServer.adminEmail;
    adminPassword = workerServer.adminPassword;
  });

  test('Initial Admin Config: Verified correct admin user was created', async ({ request }) => {
    // 1. Login and verify 200 OK
    const loginResponse = await request.post('/api/auth/login', {
      headers: { 'Content-Type': 'application/json' },
      data: { email: adminEmail, password: adminPassword }
    });
    expect(loginResponse.status()).toBe(200);

    // 2. Re-login to get a session cookie, then verify the first user has sysadmin role
    const meResponse = await request.get('/api/auth/me');
    const user = await meResponse.json();
    expect(user.role).toBe('sysadmin');
  });

  test('Concurrent Sessions: Login on two devices (contexts) should verify both are active', async ({ browser }) => {
    // Context 1 (Device A)
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();
    await page1.goto('/login');
    await page1.fill('#login-email', adminEmail);
    await page1.fill('#login-password', adminPassword);
    await page1.click('#login-btn');
    await expect(page1.locator('#nav-setup')).toBeVisible();

    // Context 2 (Device B)
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await page2.goto('/login');
    await page2.fill('#login-email', adminEmail);
    await page2.fill('#login-password', adminPassword);
    await page2.click('#login-btn');
    await expect(page2.locator('#nav-setup')).toBeVisible();

    // Verify Context 1 is STILL valid (concurrent session support)
    await page1.reload();
    await expect(page1.locator('#nav-setup')).toBeVisible();

    await context1.close();
    await context2.close();
  });

  test('Strict Logout: Old cookies cannot refresh session', async ({ page, context }) => {
    // 1. Login
    await page.goto('/login');
    await page.fill('#login-email', adminEmail);
    await page.fill('#login-password', adminPassword);
    await page.click('#login-btn');
    await expect(page.locator('#nav-setup')).toBeVisible();

    // 2. Capture Valid Cookies (Session A)
    const validCookies = await context.cookies();

    // 3. Logout
    await page.click('#user-menu-btn');
    await expect(page.locator('#user-menu-dropdown')).toBeVisible();
    await page.click('#user-menu-logout');
    await expect(page).toHaveURL(/\/login/);

    // 4. Manually Restore Old Cookies
    await context.clearCookies(); // Ensure clean slate
    await context.addCookies(validCookies);

    // 5. Attempt Refresh
    // We expect the ACCESS token to still be valid (stateless JWT), so navigating to '/' might work!
    // But the SESSION (Refresh Token) should be revoked in the DB.
    // So we invoke the refresh endpoint directly to verify revocation.
    const response = await page.request.post('/api/auth/refresh', {
      headers: { 'Content-Type': 'application/json' },
      data: {}
    });

    // Expect: 401 Unauthorized (Session Revoked)
    expect(response.status()).toBe(401);
  });

  test('Reuse Detection: Using an outdated refresh token revokes the session', async ({ page, context, request }) => {
    // 1. Login (Session A)
    await page.goto('/login');
    await page.fill('#login-email', adminEmail);
    await page.fill('#login-password', adminPassword);
    await page.click('#login-btn');
    await expect(page.locator('#nav-setup')).toBeVisible();

    // 2. Capture Cookies (State A - Valid)
    const cookiesA = await context.cookies();

    // 3. Trigger Refresh (Rotate to Session B)
    // We use the page's request context which shares cookies with the browser context
    const refreshResponse = await page.request.post('/api/auth/refresh', {
      headers: { 'Content-Type': 'application/json' },
      data: {}
    });
    expect(refreshResponse.status()).toBe(200);

    // 4. State B is now valid in the browser. State A is old.

    // 5. Attack: Use Old Cookies (State A) to try and refresh again
    // We need a pristine request context to simulate an attacker validation
    // using the OLD cookies.
    const attackerResponse = await request.post('/api/auth/refresh', {
      headers: {
        'Cookie': cookiesA.map(c => `${c.name}=${c.value}`).join('; '),
        'Content-Type': 'application/json'
      },
      data: {}
    });

    // Expect: 401 Unauthorized (Reuse Detected and Blocked)
    expect(attackerResponse.status()).toBe(401);

    // 6. Victim: The original user (who had State B) should now be REVOKED.
    // Try to refresh again with the browser's current cookies (State B)
    const victimResponse = await page.request.post('/api/auth/refresh', {
      headers: { 'Content-Type': 'application/json' },
      data: {}
    });

    // Expect: 401 Unauthorized (Session Revoked)
    expect(victimResponse.status()).toBe(401);
  });

  test('Automatic Token Refresh: Missing access token triggers silent refresh', async ({ page, context }) => {
    // 1. Login
    await page.goto('/login');
    await page.fill('#login-email', adminEmail);
    await page.fill('#login-password', adminPassword);
    await page.click('#login-btn');
    await expect(page.locator('#nav-setup')).toBeVisible();

    // 2. Simulate Access Token Expiry by deleting the cookie
    //    (The Refresh Token 'wf_refresh_token' remains)
    const cookies = await context.cookies();
    const refreshTokenCookie = cookies.find(c => c.name === 'wf_refresh_token');
    expect(refreshTokenCookie).toBeDefined();

    await context.clearCookies();
    await context.addCookies([refreshTokenCookie!]); // Restore ONLY refresh token

    // 3. Navigate to protected route
    //    The server middleware should see missing access token, validate refresh token, 
    //    issue new access token, and allow the request (200 OK).
    await page.goto('/');

    // Expect: Stay on Dashboard (Not Redirected)
    await expect(page).toHaveURL(/\/$/); // just verify root path, not hardcoded port
    await expect(page.locator('#nav-setup')).toBeVisible();

    // Verify new access token was set
    const newCookies = await context.cookies();
    const newAccessToken = newCookies.find(c => c.name === 'wf_access_token');
    expect(newAccessToken).toBeDefined();
  });

  test('Security: Tampered refresh token is rejected', async ({ page, context }) => {
    // 1. Login
    await page.goto('/login');
    await page.fill('#login-email', adminEmail);
    await page.fill('#login-password', adminPassword);
    await page.click('#login-btn');
    await expect(page.locator('#nav-setup')).toBeVisible();

    // 2. Tamper with Refresh Token
    const cookies = await context.cookies();
    const refreshToken = cookies.find(c => c.name === 'wf_refresh_token');

    // Modify the signature/content of the opaque token (last few chars)
    const tamperedValue = refreshToken!.value.substring(0, refreshToken!.value.length - 4) + 'FAKE';

    await context.clearCookies();
    await context.addCookies([{ ...refreshToken!, value: tamperedValue }]);

    // 3. Navigate to protected route (Access token missing, so it tries Refresh)
    //    (If we leave access token it works until expiry, so we must clear Access Token too
    //     to force the system to check the Refresh Token)

    // Actually, step 2 cleared ALL cookies then added back ONLY the tampered refresh token.
    // So Access Token is gone.

    // Expect: Redirect to Login (Invalid Token -> 401 -> Redirect)
    // Wrap goto in catch because client-side redirect might interrupt it
    await page.goto('/').catch(() => { });
    await expect(page).toHaveURL(/\/login/);
  });

  test('Cookie Security: Auth cookies have correct security flags and lifetimes', async ({ page, context }) => {
    await page.goto('/login');
    await page.fill('#login-email', adminEmail);
    await page.fill('#login-password', adminPassword);
    await page.click('#login-btn');
    await expect(page.locator('#nav-setup')).toBeVisible();

    const cookies = await context.cookies();
    const accessToken = cookies.find(c => c.name === 'wf_access_token');
    const refreshToken = cookies.find(c => c.name === 'wf_refresh_token');

    expect(accessToken, 'wf_access_token cookie missing').toBeDefined();
    expect(refreshToken, 'wf_refresh_token cookie missing').toBeDefined();

    for (const cookie of [accessToken!, refreshToken!]) {
      expect(cookie.httpOnly, `${cookie.name}: must be HttpOnly`).toBe(true);
      expect(cookie.secure, `${cookie.name}: must be Secure`).toBe(true);
      expect(cookie.sameSite, `${cookie.name}: must be SameSite=Strict`).toBe('Strict');
      expect(cookie.path, `${cookie.name}: path must be /`).toBe('/');
    }

    // Access token lifetime: MaxAge 900 s (15 min)
    const nowSec = Date.now() / 1000;
    expect(accessToken!.expires).toBeGreaterThan(0);
    expect(accessToken!.expires - nowSec).toBeGreaterThan(800);
    expect(accessToken!.expires - nowSec).toBeLessThanOrEqual(910);

    // Refresh token lifetime: MaxAge 86400 s (24 h)
    expect(refreshToken!.expires).toBeGreaterThan(0);
    expect(refreshToken!.expires - nowSec).toBeGreaterThan(86000);
    expect(refreshToken!.expires - nowSec).toBeLessThanOrEqual(86410);
  });

  test('HTTP Security Headers: All expected headers are present on every response type', async ({ request }) => {
    // HTML page (public)
    const loginPage = await request.get('/login');
    expect(loginPage.status()).toBe(200);

    // API endpoint (unauthenticated → 401, but headers must still be set)
    const apiResp = await request.get('/api/issues');
    expect(apiResp.status()).toBe(401);

    for (const response of [loginPage, apiResp]) {
      const h = response.headers();

      // Content-Security-Policy — strictly matched against the backend definition
      const expectedCSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
      expect(h['content-security-policy']).toEqual(expectedCSP);

      expect(h['x-content-type-options']).toBe('nosniff');
      expect(h['x-frame-options']).toBe('DENY');
      expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(h['permissions-policy']).toBe('geolocation=(), camera=(), microphone=()');
      expect(h['x-xss-protection']).toBe('0');
    }
  });

  test('Role-based nav: sysadmin sees Setup, admin role does not', async ({ page }) => {
    // 1. Login as sysadmin — Setup nav must be visible
    await page.goto('/login');
    await page.fill('#login-email', adminEmail);
    await page.fill('#login-password', adminPassword);
    await page.click('#login-btn');
    await expect(page.locator('#nav-setup')).toBeVisible();

    // 2. Create a plain admin-role user via API (sysadmin session is active)
    const adminUserEmail = `nav_admin_${Date.now()}@example.com`;
    const adminUserPassword = `${crypto.randomBytes(16).toString('hex')}U1!`;
    const createResp = await page.request.post('/api/users', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        email: adminUserEmail,
        first_name: 'Nav',
        last_name: 'Admin',
        password: adminUserPassword,
        role: 'admin',
        active: true,
      }
    });
    expect(createResp.status()).toBe(201);
    const createdUser = await createResp.json();

    // 3. Log out sysadmin
    await page.click('#user-menu-btn');
    await page.click('#user-menu-logout');
    await expect(page).toHaveURL(/\/login/);

    // 4. Log in as the plain admin user — Setup nav must be hidden
    await page.fill('#login-email', adminUserEmail);
    await page.fill('#login-password', adminUserPassword);
    await page.click('#login-btn');
    await expect(page.locator('.board')).toBeVisible();
    await expect(page.locator('#nav-setup')).toBeHidden();

    // 5. Cleanup: log back in as sysadmin and deactivate the temp user
    await page.click('#user-menu-btn');
    await page.click('#user-menu-logout');
    await page.fill('#login-email', adminEmail);
    await page.fill('#login-password', adminPassword);
    await page.click('#login-btn');
    await page.request.put(`/api/users/${createdUser.id}`, {
      headers: { 'Content-Type': 'application/json' },
      data: { ...createdUser, active: false }
    });
  });

  test('Login timing equalization: Unknown email returns 401, not a server error', async ({ request }) => {
    // Regression test for: InitSecretKey early-return bug when a configured JWT secret
    // is provided — dummyPasswordHash was never initialised, causing a nil-pointer panic
    // (server crash or 500) on the first login attempt with an unknown email.
    // The global-setup now starts the server with --secret-key, exercising that code path.
    const response = await request.post('/api/auth/login', {
      headers: { 'Content-Type': 'application/json' },
      data: { email: 'nonexistent-user@example.com', password: generatePassword() }
    });

    // Must be 401 (wrong credentials), never 500 (nil panic).
    expect(response.status()).toBe(401);

    // Server must still be healthy after the attempt.
    const health = await request.get('/login');
    expect(health.status()).toBe(200);
  });

  test('Stable token MAC key: Refresh token remains valid across the session', async ({ page, context }) => {
    // Regression test for: computeTokenMAC previously used jwtSecret directly as the HMAC
    // key. After the fix, a domain-separated tokenMACKey is derived from jwtSecret so that
    // JWT signing and refresh-token integrity use independent keys.
    // With the configured --secret-key in global-setup, tokenMACKey is stable, and stored
    // token_hash values must match on every refresh call within the same server run.

    // 1. Login to obtain both tokens
    await page.goto('/login');
    await page.fill('#login-email', adminEmail);
    await page.fill('#login-password', adminPassword);
    await page.click('#login-btn');
    await expect(page.locator('#nav-setup')).toBeVisible();

    // 2. Drop the access token to force a full refresh cycle
    const cookies = await context.cookies();
    const refreshToken = cookies.find(c => c.name === 'wf_refresh_token');
    expect(refreshToken, 'wf_refresh_token cookie must exist after login').toBeDefined();
    await context.clearCookies();
    await context.addCookies([refreshToken!]);

    // 3. Call the refresh endpoint directly — tokenMACKey must match the stored token_hash
    const refreshResponse = await page.request.post('/api/auth/refresh', {
      headers: { 'Content-Type': 'application/json' },
      data: {}
    });
    expect(refreshResponse.status()).toBe(200);

    // 4. A new access token must have been issued
    const newCookies = await context.cookies();
    expect(newCookies.find(c => c.name === 'wf_access_token'),
      'New access token must be set after refresh').toBeDefined();
  });

  test('Guest Access: Unauthenticated users are redirected/blocked', async ({ page, request }) => {
    // 1. Ensure clean state (no cookies)
    await page.context().clearCookies();

    // 2. Client Route (e.g., /board) -> Should Redirect to Login
    await page.goto('/board');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('#nav-setup')).toBeHidden();

    // 3. Protected Static File (index.html) -> Should Redirect to Login
    //    Note: index.html is the default for /, so accessing it directly should also trigger auth check
    await page.goto('/index.html');
    await expect(page).toHaveURL(/\/login/);

    // 4. Protected API Endpoint (/api/issues) -> Should return 401 Unauthorized
    //    (Using request context which shares cookies - i.e., none)
    const apiResponse = await request.get('/api/issues');
    expect(apiResponse.status()).toBe(401);

    // 5. Protected Static Asset (/js/app.js) -> Should Redirect to Login
    //    (app.js is the main application logic, definitely protected)
    //    Note: request.get follows redirects by default, so we check the final URL or status.
    //    However, for static assets served via http.FileServer wrapped in middleware, 
    //    the middleware returns 302. request.get will follow to /login page which returns 200.
    //    So we should check if the final URL contains 'login' OR use maxRedirects: 0.

    const appJsRedirect = await request.get('/js/app.js', { maxRedirects: 0 });
    expect(appJsRedirect.status()).toBe(302);
    expect(appJsRedirect.headers()['location']).toContain('/login');

    // 6. Public Asset (/logo.png) -> Should be accessible (200 OK)
    const logoResponse = await request.get('/logo.png');
    expect(logoResponse.status()).toBe(200);
  });

});

// Use 127.0.0.1 explicitly instead of localhost.
// The rest of the test suite natively uses localhost which resolves to [::1] (IPv6).
// By explicitly targeting 127.0.0.1 here, we can safely exhaust the global 
// IP-based rate limit for IPv4 loopback without accidentally failing all 
// the other concurrent/subsequent tests that use IPv6 loopback!
test.describe('Authentication Rate Limiting', () => {

  // Use 127.0.0.1 (IPv4) explicitly for all requests in this block.
  // The rest of the test suite uses localhost which resolves to [::1] (IPv6).
  // By targeting 127.0.0.1 we exhaust the IPv4 rate limit bucket without
  // affecting the IPv6 bucket used by all other tests.

  test('IP+Email limit returns 401, IP limit returns 429', async ({ request, workerServer }) => {
    const loginURL = `http://127.0.0.1:${workerServer.port}/api/auth/login`;

    // 1. Exhaust the IP+Email limit for victim@example.com
    // The limit is 10 failures per 15 mins.
    for (let i = 0; i < 10; i++) {
      const res = await request.post(loginURL, {
        data: { email: 'victim@example.com', password: generatePassword() }
      });
      expect(res.status()).toBe(401);
    }

    // 11th attempt for the SAME email should still be block by IP+Email limit (401)
    const resBlockedEmail = await request.post(loginURL, {
      data: { email: 'victim@example.com', password: generatePassword() }
    });
    expect(resBlockedEmail.status()).toBe(401);

    // 2. The IP itself has 10 failures now. The IP limit is 20.
    // Let's use a DIFFERENT email to safely reach the IP limit without hitting
    // the IP+Email limit for the second victim until the very end.
    for (let i = 0; i < 10; i++) {
      const res = await request.post(loginURL, {
        data: { email: 'secondvictim@example.com', password: generatePassword() }
      });
      expect(res.status()).toBe(401);
    }

    // At this point, the IP (127.0.0.1) has exactly 20 failures.
    // The very next request from this IP (21st) should hit the pure IP limit and return 429.
    const resBlockedIP = await request.post(loginURL, {
      data: { email: adminEmail, password: generatePassword() }
    });

    expect(resBlockedIP.status()).toBe(429);

    const responseText = await resBlockedIP.text();
    expect(responseText).toContain('Too many login attempts');
  });

  test('X-Forwarded-For header is trusted for rate limiting', async ({ request, workerServer }) => {
    const loginURL = `http://127.0.0.1:${workerServer.port}/api/auth/login`;
    // We use different IPs in X-Forwarded-For to bypass IP-based rate limiting
    // The limit is 20 failures per IP.

    const spoofedIP1 = '1.1.1.1'; //NOSONAR
    const spoofedIP2 = '2.2.2.2'; //NOSONAR

    // 1. Fail 20 times with spoofedIP1
    for (let i = 0; i < 20; i++) {
      const res = await request.post(loginURL, {
        headers: { 'X-Forwarded-For': spoofedIP1 },
        data: { email: `fake-${i}@example.com`, password: generatePassword() }
      });
      expect(res.status()).toBe(401);
    }

    // 21st attempt with spoofedIP1 should be blocked (429)
    const blockedRes1 = await request.post(loginURL, {
      headers: { 'X-Forwarded-For': spoofedIP1 },
      data: { email: 'another@example.com', password: generatePassword() }
    });
    expect(blockedRes1.status()).toBe(429);

    // 2. Attempt with spoofedIP2 should still be allowed (401)
    const allowedRes2 = await request.post(loginURL, {
      headers: { 'X-Forwarded-For': spoofedIP2 },
      data: { email: 'yet-another@example.com', password: generatePassword() }
    });
    expect(allowedRes2.status()).toBe(401);
  });

  test('Invalid IP in X-Forwarded-For falls back to RemoteAddr', async ({ request, workerServer }) => {
    // We use an invalid IP in X-Forwarded-For.
    // The server should log a warning and use the actual remote addr (127.0.0.1).
    const invalidIP = 'not-an-ip';

    const res = await request.post(`http://127.0.0.1:${workerServer.port}/api/auth/login`, {
      headers: { 'X-Forwarded-For': invalidIP },
      data: { email: 'fake@example.com', password: generatePassword() }
    });

    // It should be 401 or 429, but definitely NOT 500.
    expect(res.status()).not.toBe(500);

    // Check backend log for the warning
    const workerIndex = workerServer.port - 8090;
    const logPath = path.join(__dirname, 'test-data', `worker-${workerIndex}`, 'backend.log');
    if (fs.existsSync(logPath)) {
      const logs = fs.readFileSync(logPath, 'utf8');
      expect(logs).toContain('GetClientIP: invalid IP in header, falling back to RemoteAddr');
      expect(logs).toContain('value=not-an-ip');
    }
  });

});
