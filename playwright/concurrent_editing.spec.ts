import { test, expect } from '@playwright/test';
import { createIssue, openIssueByTitle, selectPriority, login } from './helpers/test-utils';

test.describe('Concurrent Editing', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('conflict dialog shown when another user edits the issue', async ({ page }) => {
    // Create an issue
    await createIssue(page, { title: 'Conflict Test Issue', status: 'Todo' });

    // Open the issue modal (this fetches fresh data and stores ETag)
    await openIssueByTitle(page, 'Conflict Test Issue');
    await expect(page.locator('#issue-id')).toHaveValue(/\d+/);

    // Mock the PUT response to return 409 Conflict
    await page.route('**/api/issues/*', async route => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Conflict' })
        });
      } else {
        await route.continue();
      }
    });

    // Make a change that triggers an auto-save (e.g., change priority)
    await selectPriority(page, 'High');

    // Verify the conflict dialog appears
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await expect(page.locator('#confirm-title')).toContainText('Conflict');
    await expect(page.locator('#confirm-message')).toContainText('modified by another user');

    // Unroute to allow GET request for fresh data
    await page.unroute('**/api/issues/*');

    // Click Reload button
    await page.click('#confirm-ok-btn');

    // Verify modal stays open (not closed)
    await expect(page.locator('#issue-modal')).toBeVisible();

    // Verify reload notification appears
    await expect(page.locator('#notification-toast')).toContainText('Reloaded with latest data');
  });

  test('normal edit succeeds when no conflict', async ({ page }) => {
    // Create an issue
    await createIssue(page, { title: 'Normal Edit Issue', status: 'Todo' });

    // Open the issue
    await openIssueByTitle(page, 'Normal Edit Issue');
    await expect(page.locator('#issue-id')).toHaveValue(/\d+/);

    // Wait for PUT and GET responses (normal flow)
    const savePromise = Promise.all([
      page.waitForResponse(resp => resp.url().includes('/api/issues/') && resp.request().method() === 'PUT'),
      page.waitForResponse(resp => resp.url().includes('/issues/active') && resp.request().method() === 'GET')
    ]);

    // Change priority
    await selectPriority(page, 'High');

    await savePromise;

    // Verify NO conflict dialog
    await expect(page.locator('#confirm-modal')).toBeHidden();

    // Close modal and verify change persisted
    await page.click('#done-btn');
    await openIssueByTitle(page, 'Normal Edit Issue');
    await expect(page.locator('#priority-text')).toContainText('High');
  });

  test('ETag is sent with If-Match header on save', async ({ page }) => {
    // Create an issue
    await createIssue(page, { title: 'ETag Header Issue', status: 'Todo' });

    // Open the issue
    await openIssueByTitle(page, 'ETag Header Issue');
    await expect(page.locator('#issue-id')).toHaveValue(/\d+/);

    // Intercept the PUT request to verify If-Match header
    let ifMatchHeader: string | null = null;
    await page.route('**/api/issues/*', async route => {
      if (route.request().method() === 'PUT') {
        ifMatchHeader = route.request().headers()['if-match'];
        await route.continue();
      } else {
        await route.continue();
      }
    });

    // Make a change
    await selectPriority(page, 'High');

    // Wait for the request to complete
    await page.waitForResponse(resp => resp.url().includes('/api/issues/') && resp.request().method() === 'PUT');

    // Verify If-Match header was sent
    expect(ifMatchHeader).not.toBeNull();
    expect(ifMatchHeader).toMatch(/^".*"$/); // ETag format: quoted string
  });
});
