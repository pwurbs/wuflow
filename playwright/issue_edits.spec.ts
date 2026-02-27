import { test, expect } from '@playwright/test';
import { createIssue, openIssueByTitle, selectPriority, login } from './helpers/test-utils';

test.describe('Issue Edit Operations', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('edit issue description', async ({ page }) => {
    // Create an issue
    await createIssue(page, { title: 'Edit Description Issue', status: 'Todo' });

    // Open the issue
    await openIssueByTitle(page, 'Edit Description Issue');

    // Click on description preview to enable inline editing
    await page.click('#description-preview');

    // Fill in new description
    const newDescription = 'This is the updated description';
    await page.fill('#description-editor', newDescription);

    // Click save on inline edit
    await page.click('#desc-save-btn');

    // Close modal
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Reopen and verify the description was saved
    await openIssueByTitle(page, 'Edit Description Issue');
    await expect(page.locator('#description-editor')).toHaveValue(newDescription);
    await expect(page.locator('#description-preview')).toContainText(newDescription);
  });

  test('change issue priority', async ({ page }) => {
    // Create an issue with normal priority (default)
    await createIssue(page, { title: 'Priority Change Issue', status: 'Todo' });

    // Open the issue
    await openIssueByTitle(page, 'Priority Change Issue');

    // Change priority to High
    await selectPriority(page, 'High');

    // Close modal
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Reopen and verify priority is High
    await openIssueByTitle(page, 'Priority Change Issue');
    await expect(page.locator('#priority-text')).toContainText('High');
  });

  test('add deadline to existing issue', async ({ page }) => {
    // Create an issue without deadline
    await createIssue(page, { title: 'Add Deadline Issue', status: 'Todo' });

    // Open the issue
    await openIssueByTitle(page, 'Add Deadline Issue');
    await expect(page.locator('#issue-id')).toHaveValue(/\d+/);

    // Add deadline
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const deadlineStr = tomorrow.toISOString().split('T')[0];

    // Wait for the PUT request (save) and GET request (refresh)
    const savePromise = Promise.all([
      page.waitForResponse(resp => resp.url().includes('/api/issues/') && resp.request().method() === 'PUT'),
      page.waitForResponse(resp => resp.url().includes('/api/issues') && resp.request().method() === 'GET')
    ]);

    await page.fill('#deadline', deadlineStr);

    await savePromise;

    // Close modal
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Verify issue appears in unscheduled section of planning panel (no planned date yet)
    await expect(page.locator('#unscheduled-section')).toContainText('Add Deadline Issue');
  });

  test('change existing deadline', async ({ page }) => {
    // Create an issue with deadline
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const initialDeadline = tomorrow.toISOString().split('T')[0];

    await createIssue(page, {
      title: 'Change Deadline Issue',
      status: 'Todo',
      deadline: initialDeadline
    });

    // Open the issue
    await openIssueByTitle(page, 'Change Deadline Issue');
    await expect(page.locator('#issue-id')).toHaveValue(/\d+/);

    // Change deadline to a different date
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    const newDeadline = nextWeek.toISOString().split('T')[0];

    // Wait for save and refresh
    const savePromise = Promise.all([
      page.waitForResponse(resp => resp.url().includes('/api/issues/') && resp.request().method() === 'PUT'),
      page.waitForResponse(resp => resp.url().includes('/api/issues') && resp.request().method() === 'GET')
    ]);

    await page.fill('#deadline', newDeadline);

    await savePromise;

    // Close modal
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Reopen and verify new deadline
    await openIssueByTitle(page, 'Change Deadline Issue');
    await expect(page.locator('#issue-id')).toHaveValue(/\d+/);
    const deadlineValue = await page.locator('#deadline').inputValue();
    expect(deadlineValue).toBe(newDeadline);
  });

  test('remove deadline from issue', async ({ page }) => {
    // Create an issue with deadline
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const deadline = tomorrow.toISOString().split('T')[0];

    await createIssue(page, {
      title: 'Remove Deadline Issue',
      status: 'Todo',
      deadline: deadline
    });

    // Verify it appears in unscheduled section of planning panel
    await expect(page.locator('#unscheduled-section')).toContainText('Remove Deadline Issue');

    // Open the issue
    await openIssueByTitle(page, 'Remove Deadline Issue');
    await expect(page.locator('#issue-id')).toHaveValue(/\d+/);

    // Clear the deadline
    const savePromise = Promise.all([
      page.waitForResponse(resp => resp.url().includes('/api/issues/') && resp.request().method() === 'PUT'),
      page.waitForResponse(resp => resp.url().includes('/api/issues') && resp.request().method() === 'GET')
    ]);

    await page.fill('#deadline', '');

    await savePromise;

    // Close modal
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Verify it's removed from unscheduled section
    await expect(page.locator('#unscheduled-section')).not.toContainText('Remove Deadline Issue');
  });

  // Note: Label editing tests removed as the UI doesn't support changing labels
  // after issue creation in the current implementation
});
