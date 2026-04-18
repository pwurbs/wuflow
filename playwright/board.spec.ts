import { test, expect } from './fixtures';
import { createIssue, selectAssignee, openIssueByTitle } from './helpers/test-utils';

test.describe('Board Functionality', () => {
  test.beforeEach(async ({ page, login }) => {
    await login();
  });

  test('board displays all four columns', async ({ page }) => {
    const columns = ['Todo', 'Stage1', 'Stage2', 'Done'];

    for (const column of columns) {
      await expect(page.locator(`.column[data-status="${column}"]`)).toBeVisible();
    }
  });

  test('column counts update when issues are added', async ({ page }) => {
    // Get initial count
    const initialCount = await page.locator('.column[data-status="Todo"] .count').textContent();
    const initialCountNum = Number.parseInt(initialCount || '0');

    // Create an issue with To-Do status
    await createIssue(page, { title: 'Count Test Issue', status: 'Todo' });

    // Wait a bit for the UI to update
    await page.waitForTimeout(500);

    // Verify count increased by checking it's greater than initial
    const newCount = await page.locator('.column[data-status="Todo"] .count').textContent();
    expect(Number.parseInt(newCount || '0')).toBeGreaterThan(initialCountNum);
  });

  test('issue appears in correct column based on status', async ({ page }) => {
    // Create issue with Pending status
    await createIssue(page, { title: 'Pending Status Issue', status: 'Pending' });

    // Verify it's in Pending column
    await expect(page.locator('.column[data-status="Stage1"] .board-card:has-text("Pending Status Issue")')).toBeVisible();

    // Verify it's NOT in To-Do column
    await expect(page.locator('.column[data-status="Todo"] .board-card:has-text("Pending Status Issue")')).toHaveCount(0);
  });

  test('planning panel shows issues with deadlines in unscheduled section', async ({ page }) => {
    // Create issue with deadline and board status but no planned date
    // Set deadline to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    await createIssue(page, {
      title: 'Deadline Issue',
      status: 'Todo',
      deadline: tomorrow.toISOString().split('T')[0]
    });

    // Verify issue appears in unscheduled section of planning panel
    await expect(page.locator('#unscheduled-section')).toContainText('Deadline Issue');
  });

  test('planning panel is always visible on board view', async ({ page }) => {
    // Planning panel should be visible by default on board view
    await expect(page.locator('#planning-panel')).toBeVisible();
    await expect(page.locator('.sidebar')).toBeVisible();
  });

  test('drag issue between columns', async ({ page }) => {
    // Create an issue in To-Do
    await createIssue(page, { title: 'Drag Test Issue', status: 'Todo' });

    // Verify it's in To-Do
    const issueCard = page.locator('.column[data-status="Todo"] .board-card:has-text("Drag Test Issue")');
    await expect(issueCard).toBeVisible();

    // Drag to Working column
    const workingColumn = page.locator('.column[data-status="Stage2"]');
    await issueCard.dragTo(workingColumn);

    // Verify it moved to Working
    await expect(page.locator('.column[data-status="Stage2"] .board-card:has-text("Drag Test Issue")')).toBeVisible();
    await expect(page.locator('.column[data-status="Todo"] .board-card:has-text("Drag Test Issue")')).toHaveCount(0);
  });

  test('assignee badge initials on board card', async ({ page }) => {
    const title = `Badge Test ${Date.now()}`;
    await createIssue(page, { title, status: 'Todo' });

    // Open and assign
    await openIssueByTitle(page, title);

    // Wait for the update request that's triggered by selecting assignee
    const updatePromise = page.waitForResponse(response =>
      response.url().includes('/api/issues/') && response.request().method() === 'PUT'
    );
    await selectAssignee(page, 'Assign to me');
    await updatePromise;

    await page.click('#done-btn');

    // Verify badge AU appears on the card
    const badge = page.locator(`.board-card:has-text("${title}") .user-badge`);
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('AU');
  });
});
