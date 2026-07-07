import { test, expect } from './fixtures';
import crypto from 'node:crypto';
import {
  createIssue, createRelease, triggerRelease, openIssueByTitle, navigateTo,
  selectPriority, waitForToast, waitForToastHidden,
} from './helpers/test-utils';

function generatePassword(): string {
  return `${crypto.randomBytes(16).toString('hex')}U1!`;
}

/**
 * End-to-end tests for the unified notification toast (#notification-toast).
 *
 * All app-level feedback — success and error — surfaces in the single
 * #notification-toast element centred in the header between the filter card
 * and the user menu.
 */

test.describe('Notifications', () => {
  test.beforeEach(async ({ page, login }) => {
    await login();
  });

  // ─── Issue notifications ──────────────────────────────────────────────────

  test.describe('Issue', () => {
    test('issue created', async ({ page }) => {
      await page.click('#add-issue-btn');
      await expect(page.locator('#issue-modal')).toBeVisible();
      await page.fill('#title', `Notif Create ${Date.now()}`);
      await page.click('#save-issue-btn');
      await expect(page.locator('#issue-modal')).toBeHidden();
      await waitForToast(page, 'created successfully');
    });

    test('issue deleted', async ({ page, workerServer }) => {
      const title = `Notif Delete ${Date.now()}`;
      await createIssue(page, { title, status: 'Todo' });
      await openIssueByTitle(page, title);
      await page.click('#delete-issue-btn');
      await expect(page.locator('#admin-confirm-modal')).toBeVisible();
      await page.fill('#admin-confirm-password', workerServer.adminPassword);
      await page.click('#admin-confirm-ok-btn');
      await expect(page.locator('#issue-modal')).toBeHidden();
      await waitForToast(page, 'Issue deleted');
    });

    test('issue archived', async ({ page }) => {
      const title = `Notif Archive ${Date.now()}`;
      await createIssue(page, { title, status: 'Todo' });
      await openIssueByTitle(page, title);
      await page.click('#archive-issue-btn');
      await expect(page.locator('#confirm-modal')).toBeVisible();
      await page.click('#confirm-ok-btn');
      await expect(page.locator('#issue-modal')).toBeHidden();
      await waitForToast(page, 'Issue archived');
    });

    test('issue unarchived', async ({ page }) => {
      const title = `Notif Unarchive ${Date.now()}`;
      await createIssue(page, { title, status: 'Todo' });
      // Archive it first
      await openIssueByTitle(page, title);
      await page.click('#archive-issue-btn');
      await expect(page.locator('#confirm-modal')).toBeVisible();
      await page.click('#confirm-ok-btn');
      await expect(page.locator('#issue-modal')).toBeHidden();
      // Open from archive view and unarchive
      await navigateTo(page, 'archive');
      await page.click(`.card:has-text("${title}")`);
      await expect(page.locator('#issue-modal')).toBeVisible();
      await page.click('#unarchive-issue-btn');
      await expect(page.locator('#confirm-modal')).toBeVisible();
      await page.click('#confirm-ok-btn');
      await expect(page.locator('#issue-modal')).toBeHidden();
      await waitForToast(page, 'Issue unarchived');
    });

    test('Done shows notification when changes were made', async ({ page }) => {
      const title = `Notif Done ${Date.now()}`;
      await createIssue(page, { title, status: 'Todo' });
      await openIssueByTitle(page, title);
      // Trigger an auto-save by changing a field
      const savePromise = page.waitForResponse(
        r => r.url().includes('/issues/') && r.request().method() === 'PUT'
      );
      await selectPriority(page, 'High');
      await savePromise;
      // Close with Done
      await page.click('#done-btn');
      await expect(page.locator('#issue-modal')).toBeHidden();
      await waitForToast(page, 'Issue updated');
    });

    test('Done shows no notification when no changes were made', async ({ page }) => {
      const title = `Notif Done No Change ${Date.now()}`;
      await createIssue(page, { title, status: 'Todo' });
      // Wait for the "created" toast from createIssue to clear before proceeding
      await waitForToastHidden(page);
      await openIssueByTitle(page, title);
      await page.click('#done-btn');
      await expect(page.locator('#issue-modal')).toBeHidden();
      // Toast must remain hidden
      await expect(page.locator('#notification-toast')).toBeHidden();
    });
  });

  // ─── Task notifications ───────────────────────────────────────────────────

  test.describe('Task', () => {
    test('task created', async ({ page }) => {
      const title = `Notif Task Create ${Date.now()}`;
      await createIssue(page, { title, status: 'Todo' });
      await openIssueByTitle(page, title);
      await page.fill('#new-task-title', 'My notification task');
      const taskPost = page.waitForResponse(
        r => r.url().split('?')[0].endsWith('/tasks') && r.request().method() === 'POST'
      );
      await page.click('#add-task-btn');
      await taskPost;
      await waitForToast(page, 'Task created');
    });

    test('task deleted', async ({ page }) => {
      const title = `Notif Task Delete ${Date.now()}`;
      await createIssue(page, { title, status: 'Todo' });
      await openIssueByTitle(page, title);
      // Add a task first
      const taskPost = page.waitForResponse(
        r => r.url().split('?')[0].endsWith('/tasks') && r.request().method() === 'POST'
      );
      await page.fill('#new-task-title', 'Task to delete');
      await page.click('#add-task-btn');
      await taskPost;
      await expect(page.locator('#task-list li')).toHaveCount(1);
      // Delete it
      await page.locator('#task-list .task-item').first().locator('.delete-task-btn').click();
      await expect(page.locator('#confirm-modal')).toBeVisible();
      await page.click('#confirm-ok-btn');
      await waitForToast(page, 'Task deleted');
    });
  });

  // ─── Label notifications ──────────────────────────────────────────────────

  test.describe('Label', () => {
    test.beforeEach(async ({ page }) => {
      await navigateTo(page, 'project-settings');
    });

    test('label created', async ({ page }) => {
      // Max 15 chars; use last 8 digits of timestamp to stay unique
      const name = `L${Date.now().toString().slice(-8)}`;
      await page.fill('#ps-new-label-input', name);
      await page.press('#ps-new-label-input', 'Enter');
      await waitForToast(page, 'Label created');
    });

    test('label deleted', async ({ page, workerServer }) => {
      const name = `D${Date.now().toString().slice(-8)}`;
      await page.fill('#ps-new-label-input', name);
      await page.press('#ps-new-label-input', 'Enter');
      await expect(page.locator('#ps-labels-list')).toContainText(name);
      // Delete it
      const labelItem = page.locator(`#ps-labels-list .label-item:has-text("${name}")`);
      await labelItem.locator('.delete-label-btn').click();
      await expect(page.locator('#admin-confirm-modal')).toBeVisible();
      await page.fill('#admin-confirm-password', workerServer.adminPassword);
      await page.click('#admin-confirm-ok-btn');
      await waitForToast(page, 'Label deleted');
    });
  });

  // ─── User notifications ───────────────────────────────────────────────────

  test.describe('User', () => {
    test.beforeEach(async ({ page }) => {
      await navigateTo(page, 'system-settings');
    });

    test('user created', async ({ page }) => {
      await page.click('#add-user-btn');
      await expect(page.locator('#user-modal-overlay')).toBeVisible();
      await page.fill('#user-email', `notif-create-${Date.now()}@example.com`);
      await page.fill('#user-first-name', 'Notif');
      await page.fill('#user-last-name', 'Create');
      await page.fill('#user-password', generatePassword());
      await page.click('#user-modal-save');
      await expect(page.locator('#user-modal-overlay')).toBeHidden();
      await waitForToast(page, 'User created');
    });

    test('user updated', async ({ page }) => {
      const email = `notif-update-${Date.now()}@example.com`;
      // Create a user to edit
      await page.click('#add-user-btn');
      await page.fill('#user-email', email);
      await page.fill('#user-first-name', 'Notif');
      await page.fill('#user-last-name', 'Update');
      await page.fill('#user-password', generatePassword());
      await page.click('#user-modal-save');
      await expect(page.locator('#user-modal-overlay')).toBeHidden();
      // Edit the user
      await page.locator(`.settings-entry:has-text("${email}")`).click();
      await expect(page.locator('#user-modal-overlay')).toBeVisible();
      await page.fill('#user-first-name', 'Updated');
      await page.click('#user-modal-save');
      await expect(page.locator('#user-modal-overlay')).toBeHidden();
      await waitForToast(page, 'User updated');
    });
  });

  test.describe('Release', () => {
    test.beforeEach(async ({ page }) => {
      await navigateTo(page, 'releases');
    });

    test('release created', async ({ page }) => {
      await createRelease(page, { name: `NR_${Date.now().toString().slice(-7)}` });
      await waitForToast(page, 'Release created');
    });

    test('release updated', async ({ page }) => {
      const name = `NU_${Date.now().toString().slice(-7)}`;
      await createRelease(page, { name });
      await page.locator(`.release-row:has-text("${name}") .release-card-left`).click();
      await expect(page.locator('#release-modal-overlay')).toBeVisible();
      await page.fill('#release-modal-name', `${name}X`);
      await page.click('#release-modal-save');
      await waitForToast(page, 'Release updated');
    });

    test('release closed', async ({ page }) => {
      const name = `NC_${Date.now().toString().slice(-7)}`;
      await createRelease(page, { name });
      await triggerRelease(page, name, false);
      await waitForToast(page, 'Release closed');
    });

    test('release reopened', async ({ page }) => {
      const name = `NRO_${Date.now().toString().slice(-6)}`;
      await createRelease(page, { name });
      await triggerRelease(page, name, false);
      await waitForToast(page, 'Release closed');
      await page.locator(`.release-row:has-text("${name}") .release-card-left`).click();
      await expect(page.locator('#release-modal-overlay')).toBeVisible();
      await page.click('#release-modal-reopen');
      await expect(page.locator('#confirm-modal')).toBeVisible();
      await page.click('#confirm-ok-btn');
      await waitForToast(page, 'Release reopened');
    });

    test('release deleted', async ({ page, workerServer }) => {
      const name = `ND_${Date.now().toString().slice(-7)}`;
      await createRelease(page, { name });
      await page.locator(`.release-row:has-text("${name}") .release-card-left`).click();
      await expect(page.locator('#release-modal-overlay')).toBeVisible();
      await page.click('#release-modal-delete');
      await expect(page.locator('#admin-confirm-modal')).toBeVisible();
      await page.fill('#admin-confirm-password', workerServer.adminPassword);
      await page.click('#admin-confirm-ok-btn');
      await waitForToast(page, 'Release deleted');
    });
  });
});
