import { test, expect } from '@playwright/test';
import { createIssue, login, selectStatus, selectAssignee, openIssueByTitle } from './helpers/test-utils';

test.describe('Issue CRUD Operations', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('create a new issue', async ({ page }) => {
    const title = `Test Issue ${Date.now()} `;
    // Create a new issue using helper
    await createIssue(page, { title, status: 'Todo' });

    // Verify the issue appears in the To-Do column (use .board-card to be specific)
    await expect(page.locator(`#col-todo .board-card:has-text("${title}")`)).toBeVisible();
  });

  test('create issue with all properties', async ({ page }) => {
    const title = `Complete Issue ${Date.now()} `;
    // Create issue with all properties
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const deadlineStr = tomorrow.toISOString().split('T')[0];

    await createIssue(page, {
      title,
      description: 'This is a test description',
      status: 'Working',
      priority: 'High',
      deadline: deadlineStr
    });

    // Verify issue appears in Working column
    await expect(page.locator(`#col-working .board-card:has-text("${title}")`)).toBeVisible();
  });

  test('edit an existing issue title', async ({ page }) => {
    const title = `Issue to Edit ${Date.now()} `;
    // First create an issue
    // First create an issue
    await createIssue(page, { title, status: 'Todo' });

    // Click on the issue to open it (use board-card to be specific)
    await page.click(`.board-card:has-text("${title}")`);
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
    const title = `Status Change Test ${Date.now()} `;
    // Create an issue in To-Do
    // Create an issue in To-Do
    await createIssue(page, { title, status: 'Todo' });

    // Verify it's in To-Do column
    await expect(page.locator(`#col-todo .board-card:has-text("${title}")`)).toBeVisible();

    // Open the issue
    await page.click(`.board-card:has-text("${title}")`);
    await expect(page.locator('#issue-modal')).toBeVisible();

    // Change status to Pending
    await selectStatus(page, 'Pending');

    // Close modal
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Verify it moved to Pending column
    await expect(page.locator(`#col-pending .board-card:has-text("${title}")`)).toBeVisible();
  });

  test('delete an issue', async ({ page }) => {
    const title = `Issue to Delete ${Date.now()} `;
    // Create an issue to delete
    // Create an issue to delete
    await createIssue(page, { title, status: 'Todo' });

    // Open the issue
    await page.click(`.board-card:has-text("${title}")`);
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
    await expect(page.locator(`.board-card:has-text("${title}")`)).toHaveCount(0);
  });

  test('creator and assignee fields in modal', async ({ page }) => {
    const title = `User Binding Test ${Date.now()}`;
    await createIssue(page, { title, status: 'Todo' });

    // Open the issue
    await openIssueByTitle(page, title);

    // Verify creator display (Read-only Status - Case 1.2)
    // Verify creator display (Now part of timestamp)
    const createdAtDisplay = page.locator('#created-at-display');
    await expect(createdAtDisplay).toBeVisible();
    await expect(createdAtDisplay).toContainText('by Admin User');

    // Verify assignee selection (using the new "Me" option)
    const updatePromise = page.waitForResponse(response =>
      response.url().includes('/api/issues/') && response.request().method() === 'PUT'
    );
    await selectAssignee(page, 'Me (Admin User)');
    await updatePromise;

    // Close and reopen to verify persistence
    await page.click('#done-btn');
    await openIssueByTitle(page, title);

    const assigneeText = page.locator('#assignee-text');
    await expect(assigneeText).toContainText('Admin User');

    // Verify "Unassigned" option
    await selectAssignee(page, 'Unassigned');
    await expect(assigneeText).toContainText('Unassigned');

    // Verify Updater Display
    // Change title to trigger an update
    const newTitle = title + ' Updated';
    await page.click('#title');
    await page.fill('#title', newTitle);
    await page.click('#title-save-btn');

    // Close and reopen to fetch fresh data
    await page.click('#done-btn');
    await openIssueByTitle(page, newTitle);

    // Check updated timestamp
    const updatedAtDisplay = page.locator('#updated-at-display');
    await expect(updatedAtDisplay).toBeVisible();
    await expect(updatedAtDisplay).toContainText('by Admin User');

    await page.click('#done-btn');
  });
});
