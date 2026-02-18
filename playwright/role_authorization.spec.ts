import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createIssue } from './helpers/test-utils';

// Helper to generate random pass
function generatePassword() {
  return `${crypto.randomBytes(16).toString('hex')}U1!`;
}

test.describe('Role Based Authorization', () => {
  let adminPassword = '';
  let standardUserEmail = '';
  let standardUserPassword = '';
  let adminEmail = 'admin@local';

  test.beforeAll(() => {
    const configPath = path.join(__dirname, 'test-data', 'admin.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      adminPassword = config.password;
    } else {
      throw new Error(`Admin config not found at ${configPath}. Run global-setup first.`);
    }
  });

  // Setup: Create a standard user for testing
  test.beforeEach(async ({ page }) => {
    // 1. Login as Admin
    await page.goto('/login');
    await page.fill('#login-email', adminEmail);
    await page.fill('#login-password', adminPassword);
    await page.click('#login-btn');
    await expect(page.locator('#nav-setup')).toBeVisible();

    // 2. Create a Standard User
    await page.click('#nav-setup');
    await page.click('#add-user-btn');

    const timestamp = Date.now();
    standardUserEmail = `std_auth_${timestamp}@example.com`;
    standardUserPassword = generatePassword();

    await page.fill('#user-email', standardUserEmail);
    await page.fill('#user-first-name', 'Standard');
    await page.fill('#user-last-name', 'AuthUser');
    await page.fill('#user-password', standardUserPassword);
    // Default role is 'user', so we just save
    await page.click('#user-modal-save');
    await expect(page.locator('#user-modal-overlay')).toBeHidden();

    // Verify creation
    await expect(page.locator(`.user-row:has-text("${standardUserEmail}")`)).toBeVisible();

    // 3. Logout
    await page.click('#user-menu-btn');
    await page.click('#user-menu-logout');
    await expect(page).toHaveURL(/\/login/);
  });

  test('Standard user has restricted UI access', async ({ page }) => {
    // 1. Login as Standard User
    await page.fill('#login-email', standardUserEmail);
    await page.fill('#login-password', standardUserPassword);
    await page.click('#login-btn');
    await expect(page.locator('.board')).toBeVisible();

    // 2. Verify User Management is not accessible
    await expect(page.locator('#nav-setup')).toBeHidden();

    // 3. Create an Issue to test restrictions on it
    const issueTitle = `User Issue ${Date.now()}`;
    await createIssue(page, { title: issueTitle, status: 'Todo' });
    // Toast might cover the card, so we wait or force click
    await expect(page.locator('#notification-toast')).toBeVisible();

    // 4. Open the issue
    // Verify it is in the To-do column and is visible
    const cardSelector = `#col-todo .card:has-text("${issueTitle}")`;
    await expect(page.locator('#col-todo')).toBeVisible();
    await expect(page.locator(cardSelector)).toBeVisible();
    await page.click(cardSelector, { force: true });
    await expect(page.locator('#issue-modal')).toBeVisible();

    // 5. Verify Restricted Buttons are Hidden
    // backend/permissions.go: ActionDeleteIssue: {RoleAdmin}, ActionArchiveIssue: {RoleAdmin}
    await expect(page.locator('#delete-issue-btn')).toBeHidden();
    await expect(page.locator('#archive-issue-btn')).toBeHidden();

    // Unarchive button should also be hidden (though this is an open issue, so it would be hidden anyway)
    // We can check if we can see the "Archive" button on the board or backlog if we implemented drag-to-archive restrictions visually?
    // The modal check is the primary one.
  });

  test('Standard user cannot perform admin actions via API (403)', async ({ page, request }) => {
    // 1. Login as Standard User via UI to get cookies/session
    await page.fill('#login-email', standardUserEmail);
    await page.fill('#login-password', standardUserPassword);
    await page.click('#login-btn');
    await expect(page.locator('.board')).toBeVisible();

    // 2. Create an Issue (allowed)
    const issueTitle = `API Test Issue ${Date.now()}`;
    await createIssue(page, { title: issueTitle, status: 'Todo' });
    // Wait for board reload and find the issue ID
    // Pass a function to evaluate to get the ID from the DOM
    // Verify it is in the To-do column
    const cardSelector = `#col-todo .card:has-text("${issueTitle}")`;
    const issueCard = page.locator(cardSelector).first();
    await expect(page.locator('#col-todo')).toBeVisible();
    // Wait for overlay to be hidden before interacting/checking visibility
    await expect(page.locator('#issue-modal-overlay')).toBeHidden();

    // Check if visible - if toast covers it, toBeVisible might fail if strict? 
    // Usually toBeVisible passes even if covered, unless completely obscured by something that eats events?
    // But error said "Received: hidden".
    await expect(issueCard).toBeVisible();

    // Extract ID from card attribute or text (usually #ID)
    const cardText = await issueCard.innerText();
    const idMatch = /#(\d+)/.exec(cardText);
    const issueId = idMatch ? idMatch[1] : null;

    if (!issueId) {
      throw new Error('Could not determine issue ID for API test');
    }


    // 3. Attempt DELETE /api/issues/{id}
    const deleteResp = await page.request.delete(`/api/issues/${issueId}`);
    expect(deleteResp.status()).toBe(403);

    // 4. Attempt POST /api/issues/{id}/archive
    const archiveResp = await page.request.post(`/api/issues/${issueId}/archive`);
    expect(archiveResp.status()).toBe(403);

    // 5. Attempt POST /api/issues/{id}/unarchive
    const unarchiveResp = await page.request.post(`/api/issues/${issueId}/unarchive`);
    expect(unarchiveResp.status()).toBe(403);

    // 6. Attempt POST /api/labels (Create Label)
    const createLabelResp = await page.request.post('/api/labels', {
      data: { name: 'Restricted Label', color: '#ff0000' }
    });
    expect(createLabelResp.status()).toBe(403);

    // 7. Attempt DELETE /api/labels/1
    // backend/permissions.go: denyForbidden happens before DB calls usually if using standard flow, but let's check.
    // In handlers.go: HandleLabel -> DELETE -> Can(ActionDeleteLabel) -> denyForbidden. 
    // So ID existence might not matter for the 403 check.
    const labelResp = await page.request.delete(`/api/labels/999999`);
    expect(labelResp.status()).toBe(403);

    // 8. Attempt POST /api/users (Create User)
    const createUserResp = await page.request.post('/api/users', {
      data: {
        email: `forbidden_user_${Date.now()}@example.com`,
        password: generatePassword(),
        first_name: 'Forbidden',
        last_name: 'User',
        role: 'user'
      }
    });
    expect(createUserResp.status()).toBe(403);

    // 9. Attempt PUT /api/users/{id} (Update another user)
    // We can try to update the admin user (ID 1 usually) or even themselves via the admin endpoint /api/users/{id}
    // Users can update themselves via /api/auth/me, but /api/users/{id} is admin only for updates.
    // Let's try to update the admin user (assumed ID 1, or we can't easily guess, but 1 is safe/likely)
    // Or just use the current user's ID but via the admin endpoint.
    // First we need our own ID, which we don't strictly have in this test context easily without fetching /api/auth/me
    const meResp = await page.request.get('/api/auth/me');
    const meData = await meResp.json();
    const myId = meData.id;

    const updateUserResp = await page.request.put(`/api/users/${myId}`, {
      data: { ...meData, first_name: 'HackedName' }
    });
    expect(updateUserResp.status()).toBe(403);

    const updateAdminResp = await page.request.put(`/api/users/1`, {
      data: { first_name: 'HackedAdmin' }
    });
    expect(updateAdminResp.status()).toBe(403);
  });

  test('Admin has full access', async ({ page }) => {
    // 1. Login as Admin
    await page.fill('#login-email', adminEmail);
    await page.fill('#login-password', adminPassword);
    await page.click('#login-btn');
    await expect(page.locator('.board')).toBeVisible();

    // 2. Verify User Management is accessible
    await expect(page.locator('#nav-setup')).toBeVisible();

    // 3. Create an Issue
    const issueTitle = `Admin Issue ${Date.now()}`;
    await createIssue(page, { title: issueTitle, status: 'Todo' });

    // 4. Open Issue
    const cardSelector = `#col-todo .card:has-text("${issueTitle}")`;
    await expect(page.locator(cardSelector)).toBeVisible();
    await page.click(cardSelector, { force: true });

    // 5. Verify Admin Buttons are Visible
    await expect(page.locator('#delete-issue-btn')).toBeVisible();
    await expect(page.locator('#archive-issue-btn')).toBeVisible();

    // 6. Test Archive (functionality check)
    await page.click('#archive-issue-btn');
    // Confirm dialog
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await page.click('#confirm-ok-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // 7. Verify it's in Archive (Navigate to Archive)
    await page.click('#nav-archive');
    await expect(page.locator(`.card:has-text("${issueTitle}")`)).toBeVisible();

    // 8. Open it in Archive
    await page.click(`.card:has-text("${issueTitle}")`);
    await expect(page.locator('#modal-title')).toContainText('Archived Issue');

    // 9. Verify Unarchive button is visible
    await expect(page.locator('#unarchive-issue-btn')).toBeVisible();
    await expect(page.locator('#archive-issue-btn')).toBeHidden(); // Should be hidden if already archived
  });

});
