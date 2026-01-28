import { test, expect } from '@playwright/test';

test('landing page loads and title is correct', async ({ page }) => {
  await page.goto('/');

  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/wuTrak/);

  // You can add more assertions here, e.g. checking for specific elements
  // const logo = page.locator('img[src*="logo.png"]');
  // await expect(logo).toBeVisible();
});
