import { test, expect } from '@playwright/test';
import { createIssue, openIssueByTitle, selectPriority } from './helpers/test-utils';

test.describe('Issue Edit Operations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('edit issue description', async ({ page }) => {
    // Create an issue
    await createIssue(page, { title: 'Edit Description Issue', status: 'Todo' });

    // Open the issue
    await openIssueByTitle(page, 'Edit Description Issue');

    // Click on description to enable inline editing
    await page.click('#description-editor');

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
    await expect(page.locator('#description-editor')).toContainText(newDescription);
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

    // Add deadline
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const deadlineStr = tomorrow.toISOString().split('T')[0];
    await page.fill('#deadline', deadlineStr);

    // Close modal
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Verify issue appears in deadline panel
    await expect(page.locator('#deadline-list')).toContainText('Add Deadline Issue');
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

    // Change deadline to a different date
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    const newDeadline = nextWeek.toISOString().split('T')[0];
    await page.fill('#deadline', newDeadline);

    // Close modal
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Reopen and verify new deadline
    await openIssueByTitle(page, 'Change Deadline Issue');
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

    // Verify it appears in deadline panel
    await expect(page.locator('#deadline-list')).toContainText('Remove Deadline Issue');

    // Open the issue
    await openIssueByTitle(page, 'Remove Deadline Issue');

    // Clear the deadline
    await page.fill('#deadline', '');

    // Close modal
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Verify it's removed from deadline panel
    await expect(page.locator('#deadline-list')).not.toContainText('Remove Deadline Issue');
  });

  // Note: Label editing tests removed as the UI doesn't support changing labels
  // after issue creation in the current implementation
});
