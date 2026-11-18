import { test, expect } from './fixtures';
import fs from 'node:fs';
import path from 'node:path';

test.describe('Landing Page', () => {
  test.beforeEach(async ({ page, login }) => {
    await login();
  });

  test('page loads with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/wuFlow/);
  });

  test('logo and header are visible', async ({ page }) => {
    // Logo
    const logo = page.locator('img.logo-img');
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
    await expect(page.locator('#filter-container .toolbar-label')).toBeVisible();

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

    // System Settings navigation
    await expect(page.locator('#nav-system-settings')).toBeVisible();

    // User Menu button
    await expect(page.locator('#user-menu-btn')).toBeVisible();
  });

  test('board columns are displayed', async ({ page }) => {
    // All four columns should be visible
    await expect(page.locator('.column[data-status="Todo"]')).toBeVisible();
    await expect(page.locator('.column[data-status="Stage1"]')).toBeVisible();
    await expect(page.locator('.column[data-status="Stage2"]')).toBeVisible();
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
    await expect(page.locator('.board .sidebar-header h3:has-text("Planning")')).toBeVisible();
  });

  test('the header leaves no empty space: the first section follows the logo, the user menu ends the bar', async ({ page }) => {
    // first: the section right after the logo (System Settings has only the user menu, at the right edge)
    const views = [
      { view: 'board',            first: '#project-selector-container', filterLine: true },
      { view: 'my-work',          first: '#filter-container',           filterLine: false },
      { view: 'project-settings', first: '#project-selector-container', filterLine: false },
      { view: 'system-settings',  first: null,                          filterLine: false },
    ] as const;
    const box = async (selector: string) => {
      const b = await page.locator(selector).boundingBox();
      expect(b, `${selector} has no box`).not.toBeNull();
      return b ?? { x: 0, y: 0, width: 0, height: 0 }; // never reached: the expect above fails first
    };

    for (const { view, first, filterLine } of views) {
      await page.click(`#nav-${view}`);
      await expect(page.locator(`#nav-${view}`)).toHaveClass(/active/);

      const logo = await box('.header-left');
      const toolbar = await box('.toolbar');
      const userMenu = await box('#user-menu-container');
      if (first) {
        // header gap only (20px), no empty block in between
        const firstSection = await box(first);
        expect(firstSection.x - (logo.x + logo.width), view).toBeLessThan(30);
      }
      expect(Math.abs(userMenu.x + userMenu.width - (toolbar.x + toolbar.width)), view).toBeLessThan(2);

      const filterBorder = await page.locator('#filter-container').evaluate(el => getComputedStyle(el).borderLeftWidth);
      if (view !== 'project-settings' && view !== 'system-settings') {
        expect(filterBorder, view).toBe(filterLine ? '1px' : '0px');
      }
    }
  });
});
