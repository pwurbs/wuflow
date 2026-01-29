import { test, expect } from '@playwright/test';
import { createIssue, selectStatus } from './helpers/test-utils';

test.describe('Issue CRUD Operations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('create a new issue', async ({ page }) => {
    // Create a new issue using helper
    await createIssue(page, { title: 'Test Issue 1', status: 'Todo' });

    // Verify the issue appears in the To-Do column (use .board-card to be specific)
    await expect(page.locator('#col-todo .board-card:has-text("Test Issue 1")')).toBeVisible();
  });

  test('create issue with all properties', async ({ page }) => {
    // Create issue with all properties
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const deadlineStr = tomorrow.toISOString().split('T')[0];

    await createIssue(page, {
      title: 'Complete Issue',
      description: 'This is a test description',
      status: 'Working',
      priority: 'High',
      deadline: deadlineStr
    });

    // Verify issue appears in Working column
    await expect(page.locator('#col-working .board-card:has-text("Complete Issue")')).toBeVisible();
  });

  test('edit an existing issue title', async ({ page }) => {
    // First create an issue
    // First create an issue
    await createIssue(page, { title: 'Issue to Edit', status: 'Todo' });

    // Click on the issue to open it (use board-card to be specific)
    await page.click('.board-card:has-text("Issue to Edit")');
    await expect(page.locator('#issue-modal')).toBeVisible();

    // Click on title to enable inline editing
    await page.click('#title');

    // Clear and change the title
    await page.fill('#title', 'Edited Issue Title');

    // Click save on inline edit
    await page.click('#title-save-btn');

    // Close modal
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Verify the updated title appears
    await expect(page.locator('.board-card:has-text("Edited Issue Title")')).toBeVisible();
  });

  test('change issue status', async ({ page }) => {
    // Create an issue in To-Do
    // Create an issue in To-Do
    await createIssue(page, { title: 'Status Change Test', status: 'Todo' });

    // Verify it's in To-Do column
    await expect(page.locator('#col-todo .board-card:has-text("Status Change Test")')).toBeVisible();

    // Open the issue
    await page.click('.board-card:has-text("Status Change Test")');
    await expect(page.locator('#issue-modal')).toBeVisible();

    // Change status to Pending
    await selectStatus(page, 'Pending');

    // Close modal
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Verify it moved to Pending column
    await expect(page.locator('#col-pending .board-card:has-text("Status Change Test")')).toBeVisible();
  });

  test('delete an issue', async ({ page }) => {
    // Create an issue to delete
    // Create an issue to delete
    await createIssue(page, { title: 'Issue to Delete', status: 'Todo' });

    // Open the issue
    await page.click('.board-card:has-text("Issue to Delete")');
    await expect(page.locator('#issue-modal')).toBeVisible();

    // Click delete button
    await page.click('#delete-issue-btn');

    // Confirm deletion in the confirmation modal
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await page.click('#confirm-ok-btn');

    // Wait for modals to close
    await expect(page.locator('#confirm-modal')).toBeHidden();
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Verify issue is gone
    await expect(page.locator('.board-card:has-text("Issue to Delete")')).toHaveCount(0);
  });
});
