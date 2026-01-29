import { test, expect } from '@playwright/test';
import { createIssue, navigateTo } from './helpers/test-utils';

test.describe('Filtering and Search', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('search filters issues by text', async ({ page }) => {
    // Create some issues with different titles (in To-Do so they appear on board)
    await createIssue(page, { title: 'Alpha Issue', status: 'Todo' });
    await createIssue(page, { title: 'Beta Issue', status: 'Todo' });
    await createIssue(page, { title: 'Gamma Issue', status: 'Todo' });

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
    await createIssue(page, { title: 'High Priority Issue', status: 'Todo', priority: 'High' });
    await createIssue(page, { title: 'Normal Priority Issue', status: 'Todo' });

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
    await createIssue(page, { title: 'Bug Issue', status: 'Todo', label: 'Bug' });

    // Create issue without label
    await createIssue(page, { title: 'Feature Issue', status: 'Todo' });

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
    await createIssue(page, { title: 'Important Task Alpha', status: 'Todo', priority: 'High' });
    await createIssue(page, { title: 'Important Task Beta', status: 'Todo', priority: 'High' });

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
