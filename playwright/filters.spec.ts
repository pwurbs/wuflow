import { test, expect } from '@playwright/test';
import { openIssueModal, selectPriority, selectStatus, navigateTo } from './helpers/test-utils';

test.describe('Filtering and Search', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('search filters issues by text', async ({ page }) => {
    // Create some issues with different titles (in To-Do so they appear on board)
    await openIssueModal(page);
    await page.fill('#title', 'Alpha Issue');
    await selectStatus(page, 'Todo');
    await page.click('#save-issue-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    await openIssueModal(page);
    await page.fill('#title', 'Beta Issue');
    await selectStatus(page, 'Todo');
    await page.click('#save-issue-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    await openIssueModal(page);
    await page.fill('#title', 'Gamma Issue');
    await selectStatus(page, 'Todo');
    await page.click('#save-issue-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Verify all three are visible (use .board-card to target board cards specifically)
    await expect(page.locator('.board-card:has-text("Alpha Issue")')).toBeVisible();
    await expect(page.locator('.board-card:has-text("Beta Issue")')).toBeVisible();
    await expect(page.locator('.board-card:has-text("Gamma Issue")')).toBeVisible();

    // Type in search box
    await page.fill('#search-input', 'Alpha');

    // Only Alpha should be visible
    await expect(page.locator('.board-card:has-text("Alpha Issue")')).toBeVisible();
    await expect(page.locator('.board-card:has-text("Beta Issue")')).toBeHidden();
    await expect(page.locator('.board-card:has-text("Gamma Issue")')).toBeHidden();

    // Clear search
    await page.fill('#search-input', '');

    // All should be visible again
    await expect(page.locator('.board-card:has-text("Alpha Issue")')).toBeVisible();
    await expect(page.locator('.board-card:has-text("Beta Issue")')).toBeVisible();
    await expect(page.locator('.board-card:has-text("Gamma Issue")')).toBeVisible();
  });

  test('filter issues by priority', async ({ page }) => {
    // Create issues with different priorities
    await openIssueModal(page);
    await page.fill('#title', 'High Priority Issue');
    await selectStatus(page, 'Todo');
    await selectPriority(page, 'High');
    await page.click('#save-issue-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    await openIssueModal(page);
    await page.fill('#title', 'Normal Priority Issue');
    await selectStatus(page, 'Todo');
    // Normal is default, no need to select
    await page.click('#save-issue-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Both should be visible initially
    await expect(page.locator('.board-card:has-text("High Priority Issue")')).toBeVisible();
    await expect(page.locator('.board-card:has-text("Normal Priority Issue")')).toBeVisible();

    // Open priority filter dropdown
    await page.click('#priority-filter-btn');

    // Select High priority filter
    await page.click('#priority-filter-options .custom-option:has-text("High")');

    // Only High priority issue should be visible
    await expect(page.locator('.board-card:has-text("High Priority Issue")')).toBeVisible();
    await expect(page.locator('.board-card:has-text("Normal Priority Issue")')).toBeHidden();
  });

  test('filter issues by label', async ({ page }) => {
    // First create a label
    await navigateTo(page, 'setup');
    await page.fill('#new-label-input', 'Bug');
    await page.click('#add-label-btn');
    await expect(page.locator('#labels-list')).toContainText('Bug');

    // Go back to board
    await navigateTo(page, 'board');

    // Create issue with label
    await openIssueModal(page);
    await page.fill('#title', 'Bug Issue');
    await selectStatus(page, 'Todo');
    await page.click('#label-trigger');
    await page.click('#label-options .custom-option:has-text("Bug")');
    await page.click('#save-issue-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Create issue without label
    await openIssueModal(page);
    await page.fill('#title', 'Feature Issue');
    await selectStatus(page, 'Todo');
    await page.click('#save-issue-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Both should be visible
    await expect(page.locator('.board-card:has-text("Bug Issue")')).toBeVisible();
    await expect(page.locator('.board-card:has-text("Feature Issue")')).toBeVisible();

    // Open label filter
    await page.click('#label-filter-btn');

    // Select Bug label filter
    await page.click('#label-filter-options .custom-option:has-text("Bug")');

    // Only Bug issue should be visible
    await expect(page.locator('.board-card:has-text("Bug Issue")')).toBeVisible();
    await expect(page.locator('.board-card:has-text("Feature Issue")')).toBeHidden();
  });

  test('combining search with filters', async ({ page }) => {
    // Create issues with High priority
    await openIssueModal(page);
    await page.fill('#title', 'Important Task Alpha');
    await selectStatus(page, 'Todo');
    await selectPriority(page, 'High');
    await page.click('#save-issue-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    await openIssueModal(page);
    await page.fill('#title', 'Important Task Beta');
    await selectStatus(page, 'Todo');
    await selectPriority(page, 'High');
    await page.click('#save-issue-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Apply priority filter
    await page.click('#priority-filter-btn');
    await page.click('#priority-filter-options .custom-option:has-text("High")');

    // Both High priority issues should be visible
    await expect(page.locator('.board-card:has-text("Important Task Alpha")')).toBeVisible();
    await expect(page.locator('.board-card:has-text("Important Task Beta")')).toBeVisible();

    // Add search filter
    await page.fill('#search-input', 'Alpha');

    // Only Alpha should remain visible
    await expect(page.locator('.board-card:has-text("Important Task Alpha")')).toBeVisible();
    await expect(page.locator('.board-card:has-text("Important Task Beta")')).toBeHidden();
  });
});
