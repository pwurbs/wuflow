import { test, expect } from './fixtures';
import crypto from 'node:crypto';

// Helper to generate random pass
function generatePassword() {
  return `${crypto.randomBytes(16).toString('hex')}U1!`;
}

test.describe('User Management', () => {

  let adminEmail = 'admin@local';

  // Admin credentials previously read from test-data/admin.json; now supplied by the
  // workerServer fixture in fixtures.ts, which spawns a dedicated server per worker.
  test.beforeEach(async ({ page, workerServer }) => {
    adminEmail = workerServer.adminEmail;
    await page.goto('/login');
    await page.fill('#login-email', adminEmail);
    await page.fill('#login-password', workerServer.adminPassword);
    await page.click('#login-btn');
    await expect(page.locator('#nav-system-settings')).toBeVisible();

    await page.click('#nav-system-settings');
  });

  test('Sysadmin can create, edit, and manage users', async ({ page, workerServer }) => {
    // 1. Create User
    await page.click('#add-user-btn');
    const timestamp = Date.now();
    const testEmail = `user_${timestamp}@example.com`;
    const testPassword = generatePassword();

    await page.fill('#user-email', testEmail);
    await page.fill('#user-first-name', 'Test');
    await page.fill('#user-last-name', 'User');
    await page.fill('#user-password', testPassword);
    await page.click('#user-modal-save');
    await expect(page.locator('#user-modal-overlay')).toBeHidden();

    const userRow = page.locator(`.settings-entry:has-text("${testEmail}")`);
    await expect(userRow).toBeVisible();

    // 2. Edit User (Promote to Admin — not Sysadmin)
    await userRow.click();
    await page.click('#user-role-trigger');
    await page.click('.custom-option[data-value="admin"]');
    await page.click('#user-modal-save');
    // Role promotion requires admin password confirmation
    await expect(page.locator('#admin-confirm-modal')).toBeVisible();
    await page.fill('#admin-confirm-password', workerServer.adminPassword);
    await page.click('#admin-confirm-ok-btn');
    await expect(page.locator('#user-modal-overlay')).toBeHidden();
    // Admin badge (not Sysadmin badge) is shown
    await expect(userRow.locator('.settings-entry-badge.admin')).toBeVisible();
    await expect(userRow.locator('.settings-entry-badge.sysadmin')).toBeHidden();

    // 3. Deactivate User
    await userRow.click();
    await page.uncheck('#user-active');
    await page.click('#user-modal-save');
    await expect(userRow).toHaveClass(/user-inactive/);

    // 4. Reactivate User
    await userRow.click();
    await page.check('#user-active');
    await page.click('#user-modal-save');
    await expect(userRow).not.toHaveClass(/user-inactive/);

    // 5. Cleanup: Demote and Deactivate so it doesn't interfere with other tests
    await userRow.click();
    await page.click('#user-role-trigger');
    await page.click('.custom-option[data-value="user"]');
    await page.uncheck('#user-active');
    await page.click('#user-modal-save');
    await expect(page.locator('#user-modal-overlay')).toBeHidden();
  });

  test('Sysadmin cannot deactivate the last active sysadmin', async ({ page }) => {
    // We expect the configured sysadmin to be the only active sysadmin here.
    const sysadminRow = page.locator(`.settings-entry:has-text("${adminEmail}")`);
    await expect(sysadminRow).toBeVisible();

    await sysadminRow.click();
    await expect(page.locator('#user-modal-overlay')).toBeVisible();

    // Attempt Deactivate
    await page.uncheck('#user-active');
    await page.click('#user-modal-save');

    // Check for error
    const errorDisplay = page.locator('#user-modal-error');
    await expect(errorDisplay).toBeVisible();
    await expect(errorDisplay).toContainText('last active system administrator');

    await page.click('#user-modal-cancel');
  });

  test('Admin password validation', async ({ page }) => {
    await page.click('#add-user-btn');
    await page.fill('#user-email', `badpass_${Date.now()}@example.com`);
    await page.fill('#user-first-name', 'Bad');
    await page.fill('#user-last-name', 'Pass');
    await page.fill('#user-password', 'short');
    await page.click('#user-modal-save');

    const errorDisplay = page.locator('#user-modal-error');
    await expect(errorDisplay).toBeVisible();
    await expect(errorDisplay).toContainText('at least 12 characters');

    await page.click('#user-modal-cancel');
  });

  test('Standard user cannot access System Settings page', async ({ page }) => {
    // 1. Create a Standard User
    await page.click('#add-user-btn');
    const userEmail = `std_${Date.now()}@example.com`;
    const userPassword = generatePassword();

    await page.fill('#user-email', userEmail);
    await page.fill('#user-first-name', 'Standard');
    await page.fill('#user-last-name', 'User');
    await page.fill('#user-password', userPassword);
    await page.click('#user-modal-save');
    await expect(page.locator('#user-modal-overlay')).toBeHidden();

    // 2. Log out
    await page.click('#user-menu-btn');
    await expect(page.locator('#user-menu-dropdown')).toBeVisible();
    await page.click('#user-menu-logout');
    await expect(page).toHaveURL(/\/login/);

    // 3. Log in as Standard User
    await page.fill('#login-email', userEmail);
    await page.fill('#login-password', userPassword);
    await page.click('#login-btn');

    // 4. Verify Setup Nav is Not Visible
    await expect(page.locator('.board')).toBeVisible();
    await expect(page.locator('#nav-system-settings')).toBeHidden();

    // 5. Cleanup - Logout
    await page.click('#user-menu-btn');
    await expect(page.locator('#user-menu-dropdown')).toBeVisible();
    await page.click('#user-menu-logout');
  });

  test('Admin role user cannot access System Settings page', async ({ page }) => {
    // 1. Create an Admin-role user (not sysadmin)
    await page.click('#add-user-btn');
    const adminUserEmail = `admin_role_${Date.now()}@example.com`;
    const adminUserPassword = generatePassword();

    await page.fill('#user-email', adminUserEmail);
    await page.fill('#user-first-name', 'Admin');
    await page.fill('#user-last-name', 'Role');
    await page.fill('#user-password', adminUserPassword);
    await page.click('#user-role-trigger');
    await page.click('.custom-option[data-value="admin"]');
    await page.click('#user-modal-save');
    await expect(page.locator('#user-modal-overlay')).toBeHidden();

    // 2. Log out
    await page.click('#user-menu-btn');
    await expect(page.locator('#user-menu-dropdown')).toBeVisible();
    await page.click('#user-menu-logout');
    await expect(page).toHaveURL(/\/login/);

    // 3. Log in as Admin-role user
    await page.fill('#login-email', adminUserEmail);
    await page.fill('#login-password', adminUserPassword);
    await page.click('#login-btn');

    // 4. Verify Setup Nav is hidden (admin role does NOT see Setup)
    await expect(page.locator('.board')).toBeVisible();
    await expect(page.locator('#nav-system-settings')).toBeHidden();

    // 5. Cleanup - Logout, then log back in as sysadmin to deactivate
    await page.click('#user-menu-btn');
    await page.click('#user-menu-logout');
    await expect(page).toHaveURL(/\/login/);
  });

  test('Initial sysadmin has Sysadmin role badge', async ({ page }) => {
    // Already on System Settings page from beforeEach
    const adminRow = page.locator(`.settings-entry:has-text("${adminEmail}")`);
    await expect(adminRow).toBeVisible();
    await expect(adminRow.locator('.settings-entry-badge.sysadmin')).toBeVisible();
    await expect(adminRow.locator('.settings-entry-badge.sysadmin')).toContainText('Sysadmin');
  });

  test('Header User Menu displays badge and email correctly', async ({ page }) => {
    // Already on System Settings page from beforeEach (which means logged in)
    const userMenuBtn = page.locator('#user-menu-btn');
    await expect(userMenuBtn).toBeVisible();

    // Check for badge existence and content
    const badge = userMenuBtn.locator('.user-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(/^[A-Z]{2}$/);

    // Check for email text
    await expect(userMenuBtn).toContainText(adminEmail);
  });

  test('User Management list displays badges', async ({ page }) => {
    // Already on System Settings page from beforeEach
    await expect(page.locator('#users-list')).toBeVisible();

    // Find the row for the admin email
    const adminRow = page.locator(`.settings-entry:has-text("${adminEmail}")`);
    await expect(adminRow).toBeVisible();

    // Check for badge in the list row
    const badge = adminRow.locator('.user-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(/^[A-Z]{2}$/);

    // Check background color (should be computed/styled)
    await expect(badge).toHaveCSS('border-radius', '50%');
  });

  test('Newly created user has correct badge initials', async ({ page }) => {
    // Already on System Settings page from beforeEach

    // Create a user with known names
    await page.click('#add-user-btn');
    const testEmail = `badge_test_${Date.now()}@example.com`;
    const safePassword = generatePassword();

    await page.fill('#user-email', testEmail);
    await page.fill('#user-first-name', 'Badge');
    await page.fill('#user-last-name', 'Tester');
    await page.fill('#user-password', safePassword);
    await page.click('#user-modal-save');
    await expect(page.locator('#user-modal-overlay')).toBeHidden();

    // Find the new row
    const userRow = page.locator(`.settings-entry:has-text("${testEmail}")`);
    await expect(userRow).toBeVisible();

    // Check Badge Initials: Badge + Tester -> BT
    const badge = userRow.locator('.user-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('BT');
  });

  test('Newly created user shows "Never" as last login and a User role badge', async ({ page }) => {
    await page.click('#add-user-btn');
    const testEmail = `never_login_${Date.now()}@example.com`;
    await page.fill('#user-email', testEmail);
    await page.fill('#user-first-name', 'Never');
    await page.fill('#user-last-name', 'Login');
    await page.fill('#user-password', generatePassword());
    await page.click('#user-modal-save');
    await expect(page.locator('#user-modal-overlay')).toBeHidden();

    const userRow = page.locator(`.settings-entry:has-text("${testEmail}")`);
    await expect(userRow).toBeVisible();
    await expect(userRow).toContainText('Last login: Never');
    await expect(userRow.locator('.settings-entry-badge.user')).toBeVisible();
    await expect(userRow.locator('.settings-entry-badge.user')).toContainText('User');
  });

  test('Last login is recorded and displayed after the user logs in', async ({ page, workerServer }) => {
    // 1. Create a test user
    await page.click('#add-user-btn');
    const testEmail = `last_login_${Date.now()}@example.com`;
    const testPassword = generatePassword();
    await page.fill('#user-email', testEmail);
    await page.fill('#user-first-name', 'Last');
    await page.fill('#user-last-name', 'Login');
    await page.fill('#user-password', testPassword);
    await page.click('#user-modal-save');
    await expect(page.locator('#user-modal-overlay')).toBeHidden();

    const userRowBeforeLogin = page.locator(`.settings-entry:has-text("${testEmail}")`);
    await expect(userRowBeforeLogin).toContainText('Last login: Never');

    // 2. Log out sysadmin, log in as the new user, then log back out
    await page.click('#user-menu-btn');
    await page.click('#user-menu-logout');
    await expect(page).toHaveURL(/\/login/);

    await page.fill('#login-email', testEmail);
    await page.fill('#login-password', testPassword);
    await page.click('#login-btn');
    await expect(page.locator('.board')).toBeVisible();

    await page.click('#user-menu-btn');
    await page.click('#user-menu-logout');
    await expect(page).toHaveURL(/\/login/);

    // 3. Log back in as sysadmin and verify the row no longer shows "Never"
    await page.fill('#login-email', workerServer.adminEmail);
    await page.fill('#login-password', workerServer.adminPassword);
    await page.click('#login-btn');
    await expect(page.locator('#nav-system-settings')).toBeVisible();
    await page.click('#nav-system-settings');

    const userRowAfterLogin = page.locator(`.settings-entry:has-text("${testEmail}")`);
    await expect(userRowAfterLogin).toBeVisible();
    await expect(userRowAfterLogin).toContainText('Last login:');
    await expect(userRowAfterLogin).not.toContainText('Last login: Never');
  });

  test('Admin confirmation dialog is required when changing a user password', async ({ page, workerServer }) => {
    // Create a test user to edit
    await page.click('#add-user-btn');
    const testEmail = `confirm_pw_${Date.now()}@example.com`;
    await page.fill('#user-email', testEmail);
    await page.fill('#user-first-name', 'Confirm');
    await page.fill('#user-last-name', 'Test');
    await page.fill('#user-password', generatePassword());
    await page.click('#user-modal-save');
    await expect(page.locator('#user-modal-overlay')).toBeHidden();

    const userRow = page.locator(`.settings-entry:has-text("${testEmail}")`);

    // Cancel aborts the save — user modal stays open
    await userRow.click();
    await page.fill('#user-password', generatePassword());
    await page.click('#user-modal-save');
    await expect(page.locator('#admin-confirm-modal')).toBeVisible();
    await page.click('#admin-confirm-cancel-btn');
    await expect(page.locator('#admin-confirm-modal')).toBeHidden();
    await expect(page.locator('#user-modal-overlay')).toBeVisible();
    await page.click('#user-modal-cancel');

    // Wrong admin password → confirm modal closes, backend rejects, error in user modal
    await userRow.click();
    await page.fill('#user-password', generatePassword());
    await page.click('#user-modal-save');
    await expect(page.locator('#admin-confirm-modal')).toBeVisible();
    await page.fill('#admin-confirm-password', 'WrongAdminPass123!');
    await page.click('#admin-confirm-ok-btn');
    await expect(page.locator('#admin-confirm-modal')).toBeHidden();
    await expect(page.locator('#user-modal-error')).toBeVisible();
    await page.click('#user-modal-cancel');

    // Correct admin password → success, user modal closes
    await userRow.click();
    await page.fill('#user-password', generatePassword());
    await page.click('#user-modal-save');
    await expect(page.locator('#admin-confirm-modal')).toBeVisible();
    await page.fill('#admin-confirm-password', workerServer.adminPassword);
    await page.click('#admin-confirm-ok-btn');
    await expect(page.locator('#user-modal-overlay')).toBeHidden();
  });

  test('Admin confirmation dialog is required for role promotion but not demotion', async ({ page, workerServer }) => {
    // Create a test user
    await page.click('#add-user-btn');
    const testEmail = `confirm_role_${Date.now()}@example.com`;
    await page.fill('#user-email', testEmail);
    await page.fill('#user-first-name', 'Role');
    await page.fill('#user-last-name', 'Confirm');
    await page.fill('#user-password', generatePassword());
    await page.click('#user-modal-save');
    await expect(page.locator('#user-modal-overlay')).toBeHidden();

    const userRow = page.locator(`.settings-entry:has-text("${testEmail}")`);

    // Promotion (user → admin) requires confirmation
    await userRow.click();
    await page.click('#user-role-trigger');
    await page.click('.custom-option[data-value="admin"]');
    await page.click('#user-modal-save');
    await expect(page.locator('#admin-confirm-modal')).toBeVisible();
    await page.fill('#admin-confirm-password', workerServer.adminPassword);
    await page.click('#admin-confirm-ok-btn');
    await expect(page.locator('#user-modal-overlay')).toBeHidden();
    await expect(userRow.locator('.settings-entry-badge.admin')).toBeVisible();

    // Demotion (admin → user) does NOT require confirmation
    await userRow.click();
    await page.click('#user-role-trigger');
    await page.click('.custom-option[data-value="user"]');
    await page.click('#user-modal-save');
    await expect(page.locator('#admin-confirm-modal')).toBeHidden();
    await expect(page.locator('#user-modal-overlay')).toBeHidden();
  });

  test('Self-service password change requires the current password', async ({ page }) => {
    // Wrong current password is rejected (test as sysadmin, no actual change)
    await page.click('#user-menu-btn');
    await page.click('#user-menu-password');
    await expect(page.locator('#password-modal')).toBeVisible();
    await page.fill('#current-password', 'WrongCurrentPass123!');
    await page.fill('#new-password', generatePassword());
    await page.locator('#password-form button[type="submit"]').click();
    await expect(page.locator('#password-modal-error')).toBeVisible();
    await page.click('#password-cancel-btn');

    // Correct current password succeeds and logs the user out
    // Use a dedicated test user to avoid invalidating the sysadmin session
    await page.click('#add-user-btn');
    const testEmail = `self_pw_${Date.now()}@example.com`;
    const testPassword = generatePassword();
    await page.fill('#user-email', testEmail);
    await page.fill('#user-first-name', 'SelfPw');
    await page.fill('#user-last-name', 'Test');
    await page.fill('#user-password', testPassword);
    await page.click('#user-modal-save');
    await expect(page.locator('#user-modal-overlay')).toBeHidden();

    // Log out and in as the test user
    await page.click('#user-menu-btn');
    await page.click('#user-menu-logout');
    await expect(page).toHaveURL(/\/login/);
    await page.fill('#login-email', testEmail);
    await page.fill('#login-password', testPassword);
    await page.click('#login-btn');
    await expect(page.locator('.board')).toBeVisible();

    // Change own password with correct current password → success, redirected to login
    await page.click('#user-menu-btn');
    await page.click('#user-menu-password');
    await expect(page.locator('#password-modal')).toBeVisible();
    await page.fill('#current-password', testPassword);
    await page.fill('#new-password', generatePassword());
    await page.locator('#password-form button[type="submit"]').click();
    await expect(page).toHaveURL(/\/login/);
  });

});
