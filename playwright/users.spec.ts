import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Helper to generate random pass
function generatePassword() {
  return `${crypto.randomBytes(16).toString('hex')}U1!`;
}

test.describe('User Management', () => {

  test.beforeEach(async ({ page }) => {
    const configPath = path.join(__dirname, 'test-data', 'admin.json');
    let adminPassword = '';

    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      adminPassword = config.password;
    } else {
      throw new Error(`Admin config not found at ${configPath}. Run global-setup first.`);
    }

    await page.goto('/login');
    await page.fill('#login-email', 'admin@local');
    await page.fill('#login-password', adminPassword);
    await page.click('#login-btn');
    await expect(page.locator('#nav-setup')).toBeVisible();

    await page.click('#nav-setup');
  });

  test('Admin can create, edit, and manage users', async ({ page }) => {
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

    const userRow = page.locator(`.user-row:has-text("${testEmail}")`);
    await expect(userRow).toBeVisible();

    // 2. Edit User (Promote to Admin)
    await userRow.locator('.user-edit-btn').click();
    await page.click('#user-role-trigger');
    await page.click('.custom-option[data-value="admin"]');
    await page.click('#user-modal-save');
    await expect(page.locator('#user-modal-overlay')).toBeHidden();
    await expect(userRow).toContainText('Admin');

    // 3. Deactivate User
    await userRow.locator('.user-edit-btn').click();
    await page.uncheck('#user-active');
    await page.click('#user-modal-save');
    await expect(userRow).toHaveClass(/user-inactive/);

    // 4. Reactivate User
    await userRow.locator('.user-edit-btn').click();
    await page.check('#user-active');
    await page.click('#user-modal-save');
    await expect(userRow).not.toHaveClass(/user-inactive/);

    // 5. Cleanup: Demote and Deactivate so it doesn't interfere with other tests
    await userRow.locator('.user-edit-btn').click();
    await page.click('#user-role-trigger');
    await page.click('.custom-option[data-value="user"]');
    await page.uncheck('#user-active');
    await page.click('#user-modal-save');
    await expect(page.locator('#user-modal-overlay')).toBeHidden();
  });

  test('Admin cannot deactivate the last active administrator', async ({ page }) => {
    // We expect admin@local to be the only active admin here if other tests cleaned up.
    const adminRows = page.locator('.user-row:has-text("admin@local")');
    await expect(adminRows).toBeVisible();

    await adminRows.locator('.user-edit-btn').click();
    await expect(page.locator('#user-modal-overlay')).toBeVisible();

    // Attempt Deactivate
    await page.uncheck('#user-active');
    await page.click('#user-modal-save');

    // Check for error
    const errorDisplay = page.locator('#user-modal-error');
    await expect(errorDisplay).toBeVisible();
    await expect(errorDisplay).toContainText('last active administrator');

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

  test('Standard user cannot access Setup page', async ({ page }) => {
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
    await expect(page.locator('#nav-setup')).toBeHidden();

    // 5. Cleanup - Logout
    // 5. Cleanup - Logout
    await page.click('#user-menu-btn');
    await expect(page.locator('#user-menu-dropdown')).toBeVisible();
    await page.click('#user-menu-logout');
  });

  test('Header User Menu displays badge and email correctly', async ({ page }) => {
    // Already on Setup page from beforeEach (which means logged in)
    const userMenuBtn = page.locator('#user-menu-btn');
    await expect(userMenuBtn).toBeVisible();

    // Check for badge existence and content
    const badge = userMenuBtn.locator('.user-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(/^[A-Z]{2}$/);

    // Check for email text
    await expect(userMenuBtn).toContainText('admin@local');
  });

  test('User Management list displays badges', async ({ page }) => {
    // Already on Setup page from beforeEach
    await expect(page.locator('.users-list')).toBeVisible();

    // Find the row for admin@local
    const adminRow = page.locator('.user-row:has-text("admin@local")');
    await expect(adminRow).toBeVisible();

    // Check for badge in the list row
    const badge = adminRow.locator('.user-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(/^[A-Z]{2}$/);

    // Check background color (should be computed/styled)
    await expect(badge).toHaveCSS('border-radius', '50%');
  });

  test('Newly created user has correct badge initials', async ({ page }) => {
    // Already on Setup page from beforeEach

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
    const userRow = page.locator(`.user-row:has-text("${testEmail}")`);
    await expect(userRow).toBeVisible();

    // Check Badge Initials: Badge + Tester -> BT
    const badge = userRow.locator('.user-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('BT');
  });

});
