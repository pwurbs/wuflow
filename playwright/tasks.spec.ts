import { test, expect } from '@playwright/test';
import { createIssue, openIssueByTitle, login } from './helpers/test-utils';

test.describe('Task (Subtask) Management', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
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

  test('edit task deadline', async ({ page }) => {
    // Create an issue with a task
    await createIssue(page, { title: 'Edit Task Deadline Issue', status: 'Todo' });

    // Open the issue
    await page.click('.card:has-text("Edit Task Deadline Issue")');
    await expect(page.locator('#issue-modal')).toBeVisible();

    // Add a task with deadline
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await page.fill('#new-task-title', 'Task With Deadline');
    await page.fill('#new-task-deadline', tomorrow.toISOString().split('T')[0]);
    await page.click('#add-task-btn');

    // Find the task and its deadline input
    const taskItem = page.locator('#task-list .task-item').filter({
      has: page.locator('.task-title-input[value="Task With Deadline"]')
    });
    const deadlineInput = taskItem.locator('input[type="date"]');

    // Verify initial deadline
    const initialDeadline = await deadlineInput.inputValue();
    expect(initialDeadline).toBe(tomorrow.toISOString().split('T')[0]);

    // Change the deadline
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    await deadlineInput.fill(nextWeek.toISOString().split('T')[0]);

    // Verify the deadline was updated
    const updatedDeadline = await deadlineInput.inputValue();
    expect(updatedDeadline).toBe(nextWeek.toISOString().split('T')[0]);
  });

  test('remove task deadline', async ({ page }) => {
    // Create an issue with a task
    await createIssue(page, { title: 'Remove Task Deadline Issue', status: 'Todo' });

    // Open the issue
    await page.click('.card:has-text("Remove Task Deadline Issue")');
    await expect(page.locator('#issue-modal')).toBeVisible();

    // Add a task with deadline
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await page.fill('#new-task-title', 'Task To Clear Deadline');
    await page.fill('#new-task-deadline', tomorrow.toISOString().split('T')[0]);
    await page.click('#add-task-btn');

    // Find the task and its deadline input
    const taskItem = page.locator('#task-list .task-item').filter({
      has: page.locator('.task-title-input[value="Task To Clear Deadline"]')
    });
    const deadlineInput = taskItem.locator('input[type="date"]');

    // Clear the deadline
    await deadlineInput.fill('');

    // Verify the deadline was cleared
    const clearedDeadline = await deadlineInput.inputValue();
    expect(clearedDeadline).toBe('');
  });
  test('should handle task edit behavior (autosave on blur/Done)', async ({ page }) => {
    await createIssue(page, { title: 'Task Edit Behavior Issue', status: 'Todo' });
    await openIssueByTitle(page, 'Task Edit Behavior Issue');

    // Add a task
    await page.fill('#new-task-title', 'Original Task');
    await page.click('#add-task-btn');
    await expect(page.locator('.task-item')).toHaveCount(1);

    // Enter edit mode
    await page.click('.task-title-input');
    await expect(page.locator('.task-item')).toHaveClass(/editing/);

    // Modify task title
    await page.fill('.task-title-input', 'Modified Task');

    // Click outside (modal title) → triggers autosave via blur, no popup
    const savePromise = page.waitForResponse(r =>
      r.url().includes('/api/tasks/') && r.request().method() === 'PUT'
    );
    await page.click('#modal-title');
    await savePromise;

    // No confirm popup
    await expect(page.locator('#confirm-modal')).toBeHidden();

    // Close modal
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Reopen and verify the modified task was saved
    await openIssueByTitle(page, 'Task Edit Behavior Issue');
    const taskInput = page.locator('.task-title-input').first();
    await expect(taskInput).toHaveValue('Modified Task');
  });
});

