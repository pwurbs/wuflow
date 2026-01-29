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

  test('delete issue from backlog', async ({ page }) => {
    // Create issue with Open status (in backlog)
    await createIssue(page, { title: 'Backlog Delete Issue' });

    // Navigate to Backlog
    await navigateTo(page, 'backlog');

    // Verify issue is in backlog
    await expect(page.locator('#backlog-list')).toContainText('Backlog Delete Issue');

    // Open the issue
    await page.click('#backlog-list .card:has-text("Backlog Delete Issue")');
    await expect(page.locator('#issue-modal')).toBeVisible();

    // Delete the issue
    await page.click('#delete-issue-btn');
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await page.click('#confirm-ok-btn');

    // Wait for modals to close
    await expect(page.locator('#confirm-modal')).toBeHidden();
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Verify issue is removed from backlog
    await expect(page.locator('#backlog-list')).not.toContainText('Backlog Delete Issue');
  });

  test('edit issue in backlog view', async ({ page }) => {
    // Create issue in backlog
    await createIssue(page, { title: 'Backlog Edit Issue' });

    // Navigate to Backlog
    await navigateTo(page, 'backlog');

    // Open the issue
    await page.click('#backlog-list .card:has-text("Backlog Edit Issue")');
    await expect(page.locator('#issue-modal')).toBeVisible();

    // Edit the title
    await page.click('#title');
    await page.fill('#title', 'Edited Backlog Issue');
    await page.click('#title-save-btn');

    // Close modal
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Verify the updated title appears in backlog
    await expect(page.locator('#backlog-list')).toContainText('Edited Backlog Issue');
    await expect(page.locator('#backlog-list')).not.toContainText('Backlog Edit Issue');
  });

  test('filter and search in backlog view', async ({ page }) => {
    // Create multiple issues in backlog with different properties
    await createIssue(page, { title: 'Alpha Backlog Issue', priority: 'High' });
    await createIssue(page, { title: 'Beta Backlog Issue', priority: 'Normal' });
    await createIssue(page, { title: 'Gamma Backlog Issue', priority: 'High' });

    // Navigate to Backlog
    await navigateTo(page, 'backlog');

    // Verify all issues are visible
    await expect(page.locator('#backlog-list .card:has-text("Alpha Backlog Issue")')).toBeVisible();
    await expect(page.locator('#backlog-list .card:has-text("Beta Backlog Issue")')).toBeVisible();
    await expect(page.locator('#backlog-list .card:has-text("Gamma Backlog Issue")')).toBeVisible();

    // Test search filter
    await page.fill('#search-input', 'Alpha');

    // Only Alpha should be visible
    await expect(page.locator('#backlog-list .card:has-text("Alpha Backlog Issue")')).toBeVisible();
    await expect(page.locator('#backlog-list .card:has-text("Beta Backlog Issue")')).toBeHidden();
    await expect(page.locator('#backlog-list .card:has-text("Gamma Backlog Issue")')).toBeHidden();

    // Clear search
    await page.fill('#search-input', '');

    // All should be visible again
    await expect(page.locator('#backlog-list .card:has-text("Alpha Backlog Issue")')).toBeVisible();
    await expect(page.locator('#backlog-list .card:has-text("Beta Backlog Issue")')).toBeVisible();
    await expect(page.locator('#backlog-list .card:has-text("Gamma Backlog Issue")')).toBeVisible();

    // Test priority filter
    await page.click('#priority-filter-btn');
    await page.click('#priority-filter-options .custom-option:has-text("High")');

    // Only High priority issues should be visible
    await expect(page.locator('#backlog-list .card:has-text("Alpha Backlog Issue")')).toBeVisible();
    await expect(page.locator('#backlog-list .card:has-text("Beta Backlog Issue")')).toBeHidden();
    await expect(page.locator('#backlog-list .card:has-text("Gamma Backlog Issue")')).toBeVisible();
  });
});

