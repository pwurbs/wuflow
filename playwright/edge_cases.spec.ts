import { test, expect } from '@playwright/test';
import { createIssue, openIssueByTitle, navigateTo, login } from './helpers/test-utils';

test.describe('Edge Cases and Validation', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('cancel issue deletion', async ({ page }) => {
    // Create an issue
    await createIssue(page, { title: 'Cancel Delete Issue', status: 'Todo' });

    // Open the issue
    await openIssueByTitle(page, 'Cancel Delete Issue');

    // Click delete button
    await page.click('#delete-issue-btn');

    // Verify confirmation modal appears
    await expect(page.locator('#confirm-modal')).toBeVisible();

    // Click cancel instead of confirm
    await page.click('#confirm-cancel-btn');

    // Verify confirmation modal closes
    await expect(page.locator('#confirm-modal')).toBeHidden();

    // Close the issue modal
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Verify issue still exists
    await expect(page.locator('.board-card:has-text("Cancel Delete Issue")')).toBeVisible();
  });

  test('cancel task deletion', async ({ page }) => {
    // Create an issue with a task
    await createIssue(page, { title: 'Cancel Task Delete Issue', status: 'Todo' });

    // Open the issue
    await openIssueByTitle(page, 'Cancel Task Delete Issue');

    // Add a task
    await page.fill('#new-task-title', 'Task to Keep');
    await page.click('#add-task-btn');
    await expect(page.locator('#task-list .task-title-input[value="Task to Keep"]')).toBeVisible();

    // Find and click delete button on the task
    const taskItem = page.locator('#task-list .task-item').filter({
      has: page.locator('.task-title-input[value="Task to Keep"]')
    });
    await taskItem.locator('.delete-task-btn').click();

    // Verify confirmation dialog appears
    await expect(page.locator('#confirm-modal')).toBeVisible();

    // Click cancel
    await page.click('#confirm-cancel-btn');
    await expect(page.locator('#confirm-modal')).toBeHidden();

    // Verify task still exists
    await expect(page.locator('#task-list .task-title-input[value="Task to Keep"]')).toBeVisible();
  });

  test('cancel label deletion', async ({ page }) => {
    // Create a label
    await navigateTo(page, 'setup');
    await page.fill('#new-label-input', 'KeepLabel');
    await page.click('#add-label-btn');
    await expect(page.locator('#labels-list')).toContainText('KeepLabel');

    // Find and click the delete button for this label
    const labelItem = page.locator('#labels-list .label-item:has-text("KeepLabel")');
    await labelItem.locator('.delete-label-btn').click();

    // Check if confirmation modal appears
    const confirmModal = page.locator('#confirm-modal');
    if (await confirmModal.isVisible()) {
      // Click cancel
      await page.click('#confirm-cancel-btn');
      await expect(confirmModal).toBeHidden();
    }

    // Verify label still exists
    await expect(page.locator('#labels-list')).toContainText('KeepLabel');
  });

  test('delete issue with tasks (cascading delete)', async ({ page }) => {
    // Create an issue with multiple tasks
    await createIssue(page, { title: 'Issue With Tasks', status: 'Todo' });

    // Open the issue
    await openIssueByTitle(page, 'Issue With Tasks');

    // Add multiple tasks
    await page.fill('#new-task-title', 'Task 1');
    await page.click('#add-task-btn');
    await page.waitForTimeout(300);
    await page.fill('#new-task-title', 'Task 2');
    await page.click('#add-task-btn');
    await page.waitForTimeout(300);
    await page.fill('#new-task-title', 'Task 3');
    await page.click('#add-task-btn');
    await page.waitForTimeout(300);

    // Verify tasks exist
    await expect(page.locator('#task-list .task-item')).toHaveCount(3);

    // Delete the issue
    await page.click('#delete-issue-btn');
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await page.click('#confirm-ok-btn');

    // Wait for modals to close
    await expect(page.locator('#confirm-modal')).toBeHidden();
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Verify issue is gone
    await expect(page.locator('.board-card:has-text("Issue With Tasks")')).toHaveCount(0);
  });

  test('delete label assigned to issues', async ({ page }) => {
    // Create a label
    await navigateTo(page, 'setup');
    await page.fill('#new-label-input', 'AssignedLabel');
    await page.click('#add-label-btn');

    // Go back to board
    await navigateTo(page, 'board');

    // Create multiple issues with this label
    await createIssue(page, { title: 'Issue 1', status: 'Todo', label: 'AssignedLabel' });
    await createIssue(page, { title: 'Issue 2', status: 'Todo', label: 'AssignedLabel' });

    // Go back to setup
    await navigateTo(page, 'setup');

    // Delete the label
    const labelItem = page.locator('#labels-list .label-item:has-text("AssignedLabel")');
    await labelItem.locator('.delete-label-btn').click();

    // Confirm deletion if modal appears
    const confirmModal = page.locator('#confirm-modal');
    if (await confirmModal.isVisible()) {
      await page.click('#confirm-ok-btn');
    }

    // Verify label is removed
    await expect(page.locator('#labels-list')).not.toContainText('AssignedLabel');

    // Go back to board and verify issues still exist but without the label
    await navigateTo(page, 'board');
    await expect(page.locator('.board-card:has-text("Issue 1")')).toBeVisible();
    await expect(page.locator('.board-card:has-text("Issue 2")')).toBeVisible();
  });

  test('data persists after page reload', async ({ page }) => {
    // Create an issue with various properties
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    // First create a label
    await navigateTo(page, 'setup');
    await page.fill('#new-label-input', 'PersistLabel');
    await page.click('#add-label-btn');
    await navigateTo(page, 'board');

    await createIssue(page, {
      title: 'Persistent Issue',
      description: 'This issue should persist',
      status: 'Working',
      priority: 'High',
      deadline: tomorrow.toISOString().split('T')[0],
      label: 'PersistLabel'
    });

    // Open and add a task
    await openIssueByTitle(page, 'Persistent Issue');
    await page.fill('#new-task-title', 'Persistent Task');
    await page.click('#add-task-btn');
    await page.click('#done-btn');

    // Reload the page
    await page.reload();

    // Verify issue still exists in Working column
    await expect(page.locator('#col-working .board-card:has-text("Persistent Issue")')).toBeVisible();

    // Open the issue and verify all properties
    await openIssueByTitle(page, 'Persistent Issue');

    // Check title
    await expect(page.locator('#title')).toHaveValue('Persistent Issue');

    // Check description
    await expect(page.locator('#description-editor')).toContainText('This issue should persist');

    // Check priority
    await expect(page.locator('#priority-text')).toContainText('High');

    // Check label
    await expect(page.locator('#label-text')).toContainText('PersistLabel');

    // Check deadline
    const deadlineValue = await page.locator('#deadline').inputValue();
    expect(deadlineValue).toBe(tomorrow.toISOString().split('T')[0]);

    // Check task exists
    await expect(page.locator('#task-list .task-title-input[value="Persistent Task"]')).toBeVisible();
  });

  test('issue remains in correct column after reload', async ({ page }) => {
    // Create issues in different columns
    await createIssue(page, { title: 'Todo Issue', status: 'Todo' });
    await createIssue(page, { title: 'Pending Issue', status: 'Pending' });
    await createIssue(page, { title: 'Working Issue', status: 'Working' });
    await createIssue(page, { title: 'Done Issue', status: 'Done' });

    // Reload the page
    await page.reload();

    // Verify each issue is in the correct column
    await expect(page.locator('#col-todo .board-card:has-text("Todo Issue")')).toBeVisible();
    await expect(page.locator('#col-pending .board-card:has-text("Pending Issue")')).toBeVisible();
    await expect(page.locator('#col-working .board-card:has-text("Working Issue")')).toBeVisible();
    await expect(page.locator('#col-done .board-card:has-text("Done Issue")')).toBeVisible();
  });

  test('empty title validation', async ({ page }) => {
    // Try to create an issue without a title
    await page.click('#add-issue-btn');
    await expect(page.locator('#issue-modal')).toBeVisible();

    // Don't fill the title, just try to save
    await page.click('#save-issue-btn');

    // Modal should stay open (validation prevents save)
    // Wait a bit to see if modal closes (it shouldn't)
    await page.waitForTimeout(500);
    await expect(page.locator('#issue-modal')).toBeVisible();
  });
  test('drag outside of columns validation (cancellation)', async ({ page }) => {
    // Create an issue in To-do
    await createIssue(page, { title: 'Drag Cancel Test', status: 'Todo' });

    const issueCard = page.locator('#col-todo .board-card:has-text("Drag Cancel Test")');
    await expect(issueCard).toBeVisible();

    // Get initial position/state
    // We will drag it to the header or somewhere safe that is NOT a column

    // Use manual drag to drop it "nowhere"
    const box = await issueCard.boundingBox();

    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      // Drag up to the header area (y=10)
      await page.mouse.move(box.x + box.width / 2, 10, { steps: 5 });
      await page.waitForTimeout(100);
      await page.mouse.up();
    }

    // Give time for any potential (wrong) updates
    await page.waitForTimeout(500);

    // Verify it is STILL in To-do
    await expect(page.locator('#col-todo .board-card:has-text("Drag Cancel Test")')).toBeVisible();

    // Verify it is NOT in other columns
    await expect(page.locator('#col-pending .board-card:has-text("Drag Cancel Test")')).toBeHidden();
    await expect(page.locator('#col-working .board-card:has-text("Drag Cancel Test")')).toBeHidden();
    await expect(page.locator('#col-done .board-card:has-text("Drag Cancel Test")')).toBeHidden();
  });

  test('strict validation: rejects query parameters', async ({ page }) => {
    // Make an API request with query parameters
    const response = await page.request.get('/api/issues?foo=bar');

    // Expect 400 Bad Request
    expect(response.status()).toBe(400);

    const text = await response.text();
    expect(text).toContain('Query parameters are not allowed');
  });

  test('strict validation: returns 404 for invalid path', async ({ page }) => {
    // Make an API request to a non-existent path
    const response = await page.request.get('/api/invalid-path-xyz');

    // Expect 404 Not Found
    expect(response.status()).toBe(404);
  });
});
