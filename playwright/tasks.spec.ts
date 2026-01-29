import { test, expect } from '@playwright/test';
import { createIssue } from './helpers/test-utils';

test.describe('Task (Subtask) Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('tasks section is visible when editing an existing issue', async ({ page }) => {
    // Create an issue first with To-Do status so it's on board
    // Create an issue first with To-Do status so it's on board
    await createIssue(page, { title: 'Issue with Tasks', status: 'Todo' });

    // Open the issue for editing
    await page.click('.card:has-text("Issue with Tasks")');
    await expect(page.locator('#issue-modal')).toBeVisible();

    // Tasks section should be visible
    await expect(page.locator('#tasks-section')).toBeVisible();
  });

  test('add a task to an issue', async ({ page }) => {
    // Create an issue
    // Create an issue
    await createIssue(page, { title: 'Task Test Issue', status: 'Todo' });

    // Open the issue
    await page.click('.card:has-text("Task Test Issue")');
    await expect(page.locator('#issue-modal')).toBeVisible();

    // Add a task
    await page.fill('#new-task-title', 'First Task');
    await page.click('#add-task-btn');

    // Verify task appears in the list (task title is in input value, not text)
    await expect(page.locator('#task-list .task-title-input[value="First Task"]')).toBeVisible();
  });

  test('add a task with deadline', async ({ page }) => {
    // Create an issue
    // Create an issue
    await createIssue(page, { title: 'Task Deadline Issue', status: 'Todo' });

    // Open the issue
    await page.click('.card:has-text("Task Deadline Issue")');
    await expect(page.locator('#issue-modal')).toBeVisible();

    // Add a task with deadline
    await page.fill('#new-task-title', 'Deadline Task');

    // Set task deadline
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await page.fill('#new-task-deadline', tomorrow.toISOString().split('T')[0]);

    await page.click('#add-task-btn');

    // Verify task appears (check input value)
    await expect(page.locator('#task-list .task-title-input[value="Deadline Task"]')).toBeVisible();
  });

  test('toggle task completion', async ({ page }) => {
    // Create an issue with a task
    // Create an issue with a task
    await createIssue(page, { title: 'Toggle Task Issue', status: 'Todo' });

    // Open the issue
    await page.click('.card:has-text("Toggle Task Issue")');
    await expect(page.locator('#issue-modal')).toBeVisible();

    // Add a task
    await page.fill('#new-task-title', 'Completable Task');
    await page.click('#add-task-btn');
    await expect(page.locator('#task-list .task-title-input[value="Completable Task"]')).toBeVisible();

    // Find the task checkbox and toggle it
    const taskItem = page.locator('#task-list .task-item').filter({ has: page.locator('.task-title-input[value="Completable Task"]') });
    const checkbox = taskItem.locator('input[type="checkbox"]');

    // Initially unchecked
    await expect(checkbox).not.toBeChecked();

    // Check it
    await checkbox.check();
    await expect(checkbox).toBeChecked();
  });

  test('delete a task', async ({ page }) => {
    // Create an issue with a task
    // Create an issue with a task
    await createIssue(page, { title: 'Delete Task Issue', status: 'Todo' });

    // Open the issue
    await page.click('.card:has-text("Delete Task Issue")');
    await expect(page.locator('#issue-modal')).toBeVisible();

    // Add a task
    await page.fill('#new-task-title', 'Task to Delete');
    await page.click('#add-task-btn');
    await expect(page.locator('#task-list .task-title-input[value="Task to Delete"]')).toBeVisible();

    // Find and click delete button on the task
    const taskItem = page.locator('#task-list .task-item').filter({ has: page.locator('.task-title-input[value="Task to Delete"]') });
    await taskItem.locator('.delete-task-btn').click();

    // Handle confirmation dialog
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await page.click('#confirm-ok-btn');

    // Verify task is removed
    await expect(page.locator('#task-list .task-title-input[value="Task to Delete"]')).toHaveCount(0);
  });
});
