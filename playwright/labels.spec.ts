import { test, expect } from '@playwright/test';
import { createIssue, navigateTo, login } from './helpers/test-utils';

test.describe('Label Management', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to Setup view', async ({ page }) => {
    await navigateTo(page, 'setup');

    // Setup view should be visible
    await expect(page.locator('#setup-view')).toBeVisible();

    // Board should be hidden
    await expect(page.locator('.board')).toBeHidden();

    // Label management section should be visible
    await expect(page.locator('.column-header h2:has-text("Label Management")')).toBeVisible();
  });

  test('create a new label', async ({ page }) => {
    await navigateTo(page, 'setup');

    // Enter label name
    await page.fill('#new-label-input', 'TestLabel');

    // Click Add button
    await page.click('#add-label-btn');

    // Verify label appears in the list
    await expect(page.locator('#labels-list')).toContainText('TestLabel');
  });

  test('label input has max length of 15 characters', async ({ page }) => {
    await navigateTo(page, 'setup');

    // Try to enter more than 15 characters
    const longText = 'ThisIsAVeryLongLabelName';
    await page.fill('#new-label-input', longText);

    // Verify only 15 characters are entered
    const inputValue = await page.locator('#new-label-input').inputValue();
    expect(inputValue.length).toBeLessThanOrEqual(15);
  });

  test('assign label to an issue', async ({ page }) => {
    // First create a label
    await navigateTo(page, 'setup');
    await page.fill('#new-label-input', 'Priority');
    await page.click('#add-label-btn');
    await expect(page.locator('#labels-list')).toContainText('Priority');

    // Go back to board
    await navigateTo(page, 'board');

    // Create an issue and assign the label
    await createIssue(page, { title: 'Labeled Issue', status: 'Todo', label: 'Priority' });

    // Open the issue and verify label is set
    await page.click('.card:has-text("Labeled Issue")');
    await expect(page.locator('#label-text')).toContainText('Priority');
  });

  test('delete a label', async ({ page }) => {
    // Create a label first
    await navigateTo(page, 'setup');
    await page.fill('#new-label-input', 'ToDelete');
    await page.click('#add-label-btn');
    await expect(page.locator('#labels-list')).toContainText('ToDelete');

    // Find and click the delete button for this label
    const labelItem = page.locator('#labels-list .label-item:has-text("ToDelete")');
    await labelItem.locator('.delete-label-btn').click();

    // Confirm deletion if there's a confirmation
    const confirmModal = page.locator('#confirm-modal');
    if (await confirmModal.isVisible()) {
      await page.click('#confirm-ok-btn');
    }

    // Verify label is removed
    await expect(page.locator('#labels-list')).not.toContainText('ToDelete');
  });
});
