// Session & connection resilience: an expired session or a lost connection must never
// discard the user's input or make an unsaved change look saved.
// - Expired session: an in-place re-login dialog opens and the failed request is replayed.
// - Network error: the change is not saved, text being edited stays in its field, other
//   controls (cards, dropdowns) return to their saved state, and a connection banner shows.

import { test, expect } from './fixtures';
import type { BrowserContext, Page } from './fixtures';
import { createIssue, openIssueByTitle, selectPriority, waitForToast } from './helpers/test-utils';

const NETWORK_ERROR = 'Connection to the server failed';

function boardCard(page: Page, status: string, title: string) {
  return page.locator(`.column[data-status="${status}"] .board-card:has-text("${title}")`);
}

// Expires the session and simulates the user returning to the tab: the re-login dialog opens.
async function expireSessionAndReturn(page: Page, context: BrowserContext) {
  await context.clearCookies();
  await page.evaluate(() => globalThis.dispatchEvent(new Event('focus')));
  await expect(page.locator('#reauth-modal')).toBeVisible();
}

test.beforeEach(async ({ page, login }) => {
  await login();
  // Wait until app init is done: the version label is filled only after the session
  // handling is installed. Clearing cookies earlier hits the page-load auth check,
  // which (by design) redirects to /login instead of opening the re-login dialog.
  await expect(page.locator('#app-version')).not.toHaveText('v...');
});

test.describe('Expired session: re-login dialog', () => {
  test('save during an expired session: sign in in place and the edit is persisted', async ({ page, context, workerServer }) => {
    const title = `Reauth-${Date.now()}`;
    await createIssue(page, { title, status: 'Todo' });
    await openIssueByTitle(page, title);

    await page.click('#title');
    await page.fill('#title', `${title} edited`);
    await context.clearCookies(); // session gone (e.g. 24 h idle expiry)
    await page.press('#title', 'Enter');

    const dialog = page.locator('#reauth-modal');
    await expect(dialog).toBeVisible();
    await expect(page.locator('#reauth-email')).toHaveValue(workerServer.adminEmail);
    await expect(page.locator('#title')).toHaveValue(`${title} edited`); // input kept

    await page.fill('#reauth-password', workerServer.adminPassword);
    await page.click('#reauth-submit-btn');
    await expect(dialog).toBeHidden();
    await waitForToast(page, 'Title updated');

    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();
    await expect(page.locator(`.card:has-text("${title} edited")`)).toBeVisible();
  });

  test('card move during an expired session is saved after signing in', async ({ page, context, workerServer }) => {
    const title = `Reauth-Drag-${Date.now()}`;
    await createIssue(page, { title, status: 'Todo' });

    await context.clearCookies();
    await boardCard(page, 'Todo', title).dragTo(page.locator('.column[data-status="Stage2"]'));

    await expect(page.locator('#reauth-modal')).toBeVisible();
    await page.fill('#reauth-password', workerServer.adminPassword);
    await page.click('#reauth-submit-btn');
    await expect(page.locator('#reauth-modal')).toBeHidden();
    await expect(boardCard(page, 'Stage2', title)).toBeVisible();

    await page.reload();
    await expect(boardCard(page, 'Stage2', title)).toBeVisible(); // persisted on the server
  });

  test('wrong password shows an error and keeps the dialog open', async ({ page, context }) => {
    await expireSessionAndReturn(page, context);
    await page.fill('#reauth-password', 'definitely-wrong-password');
    await page.click('#reauth-submit-btn');

    await expect(page.locator('#reauth-error')).toBeVisible();
    await expect(page.locator('#reauth-modal')).toBeVisible();
  });

  test('returning to the tab with an expired session opens the dialog before any edit', async ({ page, context }) => {
    await expireSessionAndReturn(page, context);
  });

  test('dialog closes by itself after signing in in another tab', async ({ page, context, workerServer }) => {
    await expireSessionAndReturn(page, context);

    // Login from "another tab": context.request shares the browser context's cookies
    const res = await context.request.post('/api/auth/login', {
      data: { email: workerServer.adminEmail, password: workerServer.adminPassword },
    });
    expect(res.ok()).toBe(true);

    await page.evaluate(() => globalThis.dispatchEvent(new Event('focus')));
    await expect(page.locator('#reauth-modal')).toBeHidden();
  });

  test('Log Out in the dialog leads to the login page', async ({ page, context }) => {
    await expireSessionAndReturn(page, context);

    await page.click('#reauth-logout-btn');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Network error: change not saved, nothing lost or faked', () => {
  test('description save while offline keeps the modal and the text; saved once back online', async ({ page, context }) => {
    const title = `Offline-${Date.now()}`;
    const text = 'Written while the connection was lost';
    await createIssue(page, { title, status: 'Todo' });
    await openIssueByTitle(page, title);

    await page.click('#description-preview');
    await page.fill('#description-editor', text);

    await context.setOffline(true);
    await expect(page.locator('#connection-banner')).toBeVisible();

    await page.click('#done-btn');
    await page.click('#confirm-ok-btn'); // "Save Description?" → Save
    await waitForToast(page, NETWORK_ERROR);
    await expect(page.locator('#issue-modal')).toBeVisible();
    await expect(page.locator('#description-editor')).toHaveValue(text);

    await context.setOffline(false);
    await page.click('#done-btn');
    await page.click('#confirm-ok-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();
    await expect(page.locator('#connection-banner')).toBeHidden();

    await openIssueByTitle(page, title);
    await expect(page.locator('#description-editor')).toHaveValue(text);
  });

  test('task title edit while offline: Done keeps the modal open and the typed text', async ({ page, context }) => {
    const title = `Offline-Task-${Date.now()}`;
    await createIssue(page, { title, status: 'Todo' });
    await openIssueByTitle(page, title);
    await page.fill('#new-task-title', 'Original Task');
    await page.click('#add-task-btn');
    const taskInput = page.locator('#task-list .task-title-input').first();
    await expect(taskInput).toHaveValue('Original Task');

    await taskInput.click(); // enter edit mode
    await taskInput.fill('Renamed while offline');
    await context.setOffline(true);
    await page.click('#done-btn');

    await waitForToast(page, NETWORK_ERROR);
    await expect(page.locator('#issue-modal')).toBeVisible();
    await expect(taskInput).toHaveValue('Renamed while offline');

    await context.setOffline(false);
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    await openIssueByTitle(page, title);
    await expect(page.locator('#task-list .task-title-input').first()).toHaveValue('Renamed while offline');
  });

  test('sidebar change while offline returns to the saved value', async ({ page, context }) => {
    const title = `Offline-Priority-${Date.now()}`;
    await createIssue(page, { title, status: 'Todo' });
    await openIssueByTitle(page, title);
    await expect(page.locator('#priority-text')).toContainText('Normal');

    await context.setOffline(true);
    await selectPriority(page, 'High');

    await waitForToast(page, NETWORK_ERROR);
    await expect(page.locator('#priority-text')).toContainText('Normal');
  });

  test('comment post while offline keeps the typed comment', async ({ page, context }) => {
    const title = `Offline-Comment-${Date.now()}`;
    await createIssue(page, { title, status: 'Todo' });
    await openIssueByTitle(page, title);

    await page.fill('#new-comment-body', 'Comment written offline');
    await context.setOffline(true);
    await page.click('#add-comment-btn');

    await waitForToast(page, NETWORK_ERROR);
    await expect(page.locator('#new-comment-body')).toHaveValue('Comment written offline');

    await context.setOffline(false);
    await page.click('#add-comment-btn');
    await expect(page.locator('.comment-item').filter({ hasText: 'Comment written offline' })).toBeVisible();
  });
});

test.describe('Network error: card move', () => {
  test('card moved while offline returns to its old column and stays there online', async ({ page, context }) => {
    const title = `Offline-Drag-${Date.now()}`;
    await createIssue(page, { title, status: 'Todo' });
    await expect(boardCard(page, 'Todo', title)).toBeVisible();

    await context.setOffline(true);
    await boardCard(page, 'Todo', title).dragTo(page.locator('.column[data-status="Stage2"]'));

    await waitForToast(page, NETWORK_ERROR);
    await expect(boardCard(page, 'Todo', title)).toBeVisible();
    await expect(boardCard(page, 'Stage2', title)).toHaveCount(0);

    await context.setOffline(false);
    await page.reload();
    await expect(boardCard(page, 'Todo', title)).toBeVisible();
    await expect(boardCard(page, 'Stage2', title)).toHaveCount(0);
  });
});
