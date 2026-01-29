import { test, expect } from '@playwright/test';
import { createIssue, navigateTo, selectStatus } from './helpers/test-utils';

test.describe('Backlog View', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('navigate to Backlog view', async ({ page }) => {
    await navigateTo(page, 'backlog');

    // Backlog view should be visible
    await expect(page.locator('#backlog-view')).toBeVisible();

    // Board should be hidden
    await expect(page.locator('.board')).toBeHidden();

    // Backlog sections should be visible
    await expect(page.locator('#backlog-todo-section')).toBeVisible();
    await expect(page.locator('#backlog-open-section')).toBeVisible();
  });

  test('create issue with Open status appears in Backlog', async ({ page }) => {
    // Create issue with Open status (this is the default)
    // Note: createIssue defaults to Open if no status is provided
    await createIssue(page, { title: 'Backlog Issue' });

    // Navigate to Backlog
    await navigateTo(page, 'backlog');

    // Verify issue appears in Backlog (Open) section
    await expect(page.locator('#backlog-list')).toContainText('Backlog Issue');
  });

  test('move issue from Open to To-Do', async ({ page }) => {
    // Create issue with Open status (default)
    await createIssue(page, { title: 'Move to Board Issue' });

    // Navigate to Backlog
    await navigateTo(page, 'backlog');

    // Verify issue is in backlog
    await expect(page.locator('#backlog-list')).toContainText('Move to Board Issue');

    // Open the issue
    await page.click('#backlog-list .card:has-text("Move to Board Issue")');
    await expect(page.locator('#issue-modal')).toBeVisible();

    // Change status to To-Do
    await selectStatus(page, 'Todo');

    // Close modal
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Navigate to Board
    await navigateTo(page, 'board');

    // Verify issue is now in To-Do column on Board
    await expect(page.locator('#col-todo .card')).toContainText('Move to Board Issue');
  });

  test('backlog counts are displayed', async ({ page }) => {
    await navigateTo(page, 'backlog');

    // Verify count elements exist
    await expect(page.locator('#backlog-count')).toBeVisible();
    await expect(page.locator('#todo-count')).toBeVisible();
  });

  test('return to Board view from Backlog', async ({ page }) => {
    // Go to Backlog
    await navigateTo(page, 'backlog');
    await expect(page.locator('#backlog-view')).toBeVisible();

    // Return to Board
    await navigateTo(page, 'board');

    // Board should be visible again
    await expect(page.locator('.board')).toBeVisible();
    await expect(page.locator('#backlog-view')).toBeHidden();
  });
});
