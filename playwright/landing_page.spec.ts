import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('page loads with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/wuFlow/);
  });

  test('logo and header are visible', async ({ page }) => {
    // Logo
    const logo = page.locator('img[src*="logo.png"]');
    await expect(logo).toBeVisible();

    // Header title
    await expect(page.locator('header h1')).toContainText('wuFlow');
  });

  test('filter controls are visible', async ({ page }) => {
    // Filter label
    await expect(page.locator('.filter-label')).toBeVisible();

    // Label filter button
    await expect(page.locator('#label-filter-btn')).toBeVisible();

    // Priority filter button
    await expect(page.locator('#priority-filter-btn')).toBeVisible();

    // Search input
    await expect(page.locator('#search-input')).toBeVisible();
  });

  test('view toggle buttons are visible', async ({ page }) => {
    await expect(page.locator('#btn-deadlines')).toBeVisible();
    await expect(page.locator('#btn-planning')).toBeVisible();
  });

  test('navigation menu is visible with all buttons', async ({ page }) => {
    // New Issue button
    await expect(page.locator('#add-issue-btn')).toBeVisible();

    // Backlog navigation
    await expect(page.locator('#nav-backlog')).toBeVisible();

    // Board navigation
    await expect(page.locator('#nav-board')).toBeVisible();

    // Setup navigation
    await expect(page.locator('#nav-setup')).toBeVisible();
  });

  test('board columns are displayed', async ({ page }) => {
    // All four columns should be visible
    await expect(page.locator('.column[data-status="Todo"]')).toBeVisible();
    await expect(page.locator('.column[data-status="Pending"]')).toBeVisible();
    await expect(page.locator('.column[data-status="Working"]')).toBeVisible();
    await expect(page.locator('.column[data-status="Done"]')).toBeVisible();

    // Column headers
    await expect(page.locator('.column-header h2:has-text("Todo")')).toBeVisible();
    await expect(page.locator('.column-header h2:has-text("Pending")')).toBeVisible();
    await expect(page.locator('.column-header h2:has-text("Working")')).toBeVisible();
    await expect(page.locator('.column-header h2:has-text("Done")')).toBeVisible();
  });

  test('sidebar panel is visible', async ({ page }) => {
    // Deadlines panel is visible by default
    await expect(page.locator('#deadlines-panel')).toBeVisible();
    await expect(page.locator('.sidebar-header h3:has-text("Upcoming Deadlines")')).toBeVisible();
  });
});
