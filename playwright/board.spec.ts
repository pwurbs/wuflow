import { test, expect } from '@playwright/test';
import { openIssueModal, selectStatus, navigateTo } from './helpers/test-utils';

test.describe('Board Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('board displays all four columns', async ({ page }) => {
    const columns = ['Todo', 'Pending', 'Working', 'Done'];

    for (const column of columns) {
      await expect(page.locator(`.column[data-status="${column}"]`)).toBeVisible();
    }
  });

  test('column counts update when issues are added', async ({ page }) => {
    // Get initial count
    const initialCount = await page.locator('.column[data-status="Todo"] .count').textContent();
    const initialCountNum = parseInt(initialCount || '0');

    // Create an issue with To-Do status
    await openIssueModal(page);
    await page.fill('#title', 'Count Test Issue');
    await selectStatus(page, 'Todo');
    await page.click('#save-issue-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Wait a bit for the UI to update
    await page.waitForTimeout(500);

    // Verify count increased by checking it's greater than initial
    const newCount = await page.locator('.column[data-status="Todo"] .count').textContent();
    expect(parseInt(newCount || '0')).toBeGreaterThan(initialCountNum);
  });

  test('issue appears in correct column based on status', async ({ page }) => {
    // Create issue with Pending status
    await openIssueModal(page);
    await page.fill('#title', 'Pending Status Issue');
    await selectStatus(page, 'Pending');
    await page.click('#save-issue-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Verify it's in Pending column
    await expect(page.locator('#col-pending .board-card:has-text("Pending Status Issue")')).toBeVisible();

    // Verify it's NOT in To-Do column
    await expect(page.locator('#col-todo .board-card:has-text("Pending Status Issue")')).toHaveCount(0);
  });

  test('deadlines panel shows issues with deadlines', async ({ page }) => {
    // Create issue with deadline and board status
    await openIssueModal(page);
    await page.fill('#title', 'Deadline Issue');
    await selectStatus(page, 'Todo');

    // Set deadline to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await page.fill('#deadline', tomorrow.toISOString().split('T')[0]);

    await page.click('#save-issue-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Verify issue appears in deadline panel
    await expect(page.locator('#deadline-list')).toContainText('Deadline Issue');
  });

  test('toggle between Deadlines and Planning panels', async ({ page }) => {
    // Deadlines panel should be visible by default
    await expect(page.locator('#deadlines-panel')).toBeVisible();
    await expect(page.locator('#planning-panel')).toBeHidden();

    // Click Planning button
    await page.click('#btn-planning');

    // Now Planning panel should be visible
    await expect(page.locator('#planning-panel')).toBeVisible();
    await expect(page.locator('#deadlines-panel')).toBeHidden();

    // Click back to Deadlines
    await page.click('#btn-deadlines');
    await expect(page.locator('#deadlines-panel')).toBeVisible();
    await expect(page.locator('#planning-panel')).toBeHidden();
  });

  test('drag issue between columns', async ({ page }) => {
    // Create an issue in To-Do
    await openIssueModal(page);
    await page.fill('#title', 'Drag Test Issue');
    await selectStatus(page, 'Todo');
    await page.click('#save-issue-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Verify it's in To-Do
    const issueCard = page.locator('#col-todo .board-card:has-text("Drag Test Issue")');
    await expect(issueCard).toBeVisible();

    // Drag to Working column
    const workingColumn = page.locator('#col-working');
    await issueCard.dragTo(workingColumn);

    // Verify it moved to Working
    await expect(page.locator('#col-working .board-card:has-text("Drag Test Issue")')).toBeVisible();
    await expect(page.locator('#col-todo .board-card:has-text("Drag Test Issue")')).toHaveCount(0);
  });
});
