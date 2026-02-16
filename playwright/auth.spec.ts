import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Helper to delay execution (if needed for token internal states, though we rely on API calls)
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test.describe('Authentication Security', () => {

  let adminPassword = '';

  test.beforeAll(() => {
    // Load admin password from global setup
    const configPath = path.join(__dirname, 'test-data', 'admin.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      adminPassword = config.password;
    } else {
      throw new Error(`Admin config not found at ${configPath}. Run global-setup first.`);
    }
  });

  test('Concurrent Sessions: Login on two devices (contexts) should verify both are active', async ({ browser }) => {
    // Context 1 (Device A)
    const context1 = await browser.newContext();
    const page1 = await context1.newPage();
    await page1.goto('/login');
    await page1.fill('#login-email', 'admin@local');
    await page1.fill('#login-password', adminPassword);
    await page1.click('#login-btn');
    await expect(page1.locator('#nav-setup')).toBeVisible();

    // Context 2 (Device B)
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await page2.goto('/login');
    await page2.fill('#login-email', 'admin@local');
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
    await page.fill('#login-email', 'admin@local');
    await page.fill('#login-password', adminPassword);
    await page.click('#login-btn');
    await expect(page.locator('#nav-setup')).toBeVisible();

    // 2. Capture Valid Cookies (Session A)
    const validCookies = await context.cookies();

    // 3. Logout
    await page.click('#nav-logout');
    await expect(page).toHaveURL(/\/login/);

    // 4. Manually Restore Old Cookies
    await context.clearCookies(); // Ensure clean slate
    await context.addCookies(validCookies);

    // 5. Attempt Refresh
    // We expect the ACCESS token to still be valid (stateless JWT), so navigating to '/' might work!
    // But the SESSION (Refresh Token) should be revoked in the DB.
    // So we invoke the refresh endpoint directly to verify revocation.
    const response = await page.request.post('/api/auth/refresh');

    // Expect: 401 Unauthorized (Session Revoked)
    expect(response.status()).toBe(401);
  });

  test('Reuse Detection: Using an outdated refresh token revokes the session', async ({ page, context, request }) => {
    // 1. Login (Session A)
    await page.goto('/login');
    await page.fill('#login-email', 'admin@local');
    await page.fill('#login-password', adminPassword);
    await page.click('#login-btn');
    await expect(page.locator('#nav-setup')).toBeVisible();

    // 2. Capture Cookies (State A - Valid)
    const cookiesA = await context.cookies();

    // 3. Trigger Refresh (Rotate to Session B)
    // We use the page's request context which shares cookies with the browser context
    const refreshResponse = await page.request.post('/api/auth/refresh');
    expect(refreshResponse.status()).toBe(200);

    // 4. State B is now valid in the browser. State A is old.

    // 5. Attack: Use Old Cookies (State A) to try and refresh again
    // We need a pristine request context to simulate an attacker validation
    // using the OLD cookies.
    const attackerResponse = await request.post('/api/auth/refresh', {
      headers: {
        'Cookie': cookiesA.map(c => `${c.name}=${c.value}`).join('; ')
      }
    });

    // Expect: 401 Unauthorized (Reuse Detected and Blocked)
    expect(attackerResponse.status()).toBe(401);

    // 6. Victim: The original user (who had State B) should now be REVOKED.
    // Try to refresh again with the browser's current cookies (State B)
    const victimResponse = await page.request.post('/api/auth/refresh');

    // Expect: 401 Unauthorized (Session Revoked)
    expect(victimResponse.status()).toBe(401);
  });

  test('Automatic Token Refresh: Missing access token triggers silent refresh', async ({ page, context }) => {
    // 1. Login
    await page.goto('/login');
    await page.fill('#login-email', 'admin@local');
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
    await expect(page).toHaveURL('http://localhost:8081/'); // or check path '/' if base url set
    await expect(page.locator('#nav-setup')).toBeVisible();

    // Verify new access token was set
    const newCookies = await context.cookies();
    const newAccessToken = newCookies.find(c => c.name === 'wf_access_token');
    expect(newAccessToken).toBeDefined();
  });

  test('Security: Tampered refresh token is rejected', async ({ page, context }) => {
    // 1. Login
    await page.goto('/login');
    await page.fill('#login-email', 'admin@local');
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

    await page.goto('/');

    // Expect: Redirect to Login (Invalid Token -> 401 -> Redirect)
    await expect(page).toHaveURL(/\/login/);
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
