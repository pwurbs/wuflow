import { test, expect } from '@playwright/test';
import { login } from './helpers/test-utils';
import fs from 'node:fs';
import path from 'node:path';

test.describe('Landing Page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
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

  test('should display the correct version in the header', async ({ page }) => {
    // Read expected version from the VERSION file
    // We assume we are running from the 'playwright' directory, so VERSION is in ..
    const versionPath = path.join(process.cwd(), '..', 'VERSION');
    // Fallback checks just in case we are running from root
    const finalVersionPath = fs.existsSync(versionPath) ? versionPath : path.join(process.cwd(), 'VERSION');

    let expectedVersion = 'dev';
    if (fs.existsSync(finalVersionPath)) {
      expectedVersion = fs.readFileSync(finalVersionPath, 'utf-8').trim();
    }

    const versionElement = page.locator('#app-version');
    await expect(versionElement).toBeVisible();

    // The app prepends 'v' to the version
    await expect(versionElement).toHaveText(`v${expectedVersion}`);
  });

  test('filter controls are visible', async ({ page }) => {
    // Filter label
    await expect(page.locator('.filter-card:has-text("Filter") .filter-label')).toBeVisible();

    // Label filter button
    await expect(page.locator('#label-filter-btn')).toBeVisible();

    // Priority filter button
    await expect(page.locator('#priority-filter-btn')).toBeVisible();

    // User filter button
    await expect(page.locator('#user-filter-btn')).toBeVisible();

    // Search input
    await expect(page.locator('#search-input')).toBeVisible();
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

    // User Menu button
    await expect(page.locator('#user-menu-btn')).toBeVisible();
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

  test('sidebar planning panel is visible', async ({ page }) => {
    // Planning panel is visible by default on board view
    await expect(page.locator('#planning-panel')).toBeVisible();
    await expect(page.locator('.sidebar-header h3:has-text("Planning")')).toBeVisible();
  });
});
