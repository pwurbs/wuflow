import { test, expect } from './fixtures';
import { createIssue, selectAssignee, openIssueByTitle } from './helpers/test-utils';

test.describe('Issue CRUD Operations', () => {
  test.beforeEach(async ({ page, login }) => {
    await login();
  });

  test('create a new issue', async ({ page }) => {
    const title = `Test Issue ${Date.now()} `;
    // Create a new issue using helper
    await createIssue(page, { title, status: 'Todo' });

    // Verify the issue appears in the To-Do column (use .board-card to be specific)
    await expect(page.locator(`.column[data-status="Todo"] .board-card:has-text("${title}")`)).toBeVisible();
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
    await expect(page.locator(`.column[data-status="Stage2"] .board-card:has-text("${title}")`)).toBeVisible();
  });

  test('delete an issue', async ({ page, workerServer }) => {
    const title = `Issue to Delete ${Date.now()} `;
    // Create an issue to delete
    await createIssue(page, { title, status: 'Todo' });

    // Open the issue
    await page.click(`.board-card:has-text("${title}")`);
    await expect(page.locator('#issue-modal')).toBeVisible();

    // Click delete button
    await page.click('#delete-issue-btn');

    // Deletion requires admin password confirmation
    await expect(page.locator('#admin-confirm-modal')).toBeVisible();
    await page.fill('#admin-confirm-password', workerServer.adminPassword);
    await page.click('#admin-confirm-ok-btn');

    // Wait for modals to close
    await expect(page.locator('#admin-confirm-modal')).toBeHidden();
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Verify issue is gone
    await expect(page.locator(`.board-card:has-text("${title}")`)).toHaveCount(0);
  });

  test('assignee field in modal', async ({ page }) => {
    const title = `User Binding Test ${Date.now()}`;
    await createIssue(page, { title, status: 'Todo' });

    // Open the issue
    await openIssueByTitle(page, title);

    // Verify assignee selection (using the new "Me" option)
    const updatePromise = page.waitForResponse(response =>
      response.url().includes('/issues/') && response.request().method() === 'PUT'
    );
    await selectAssignee(page, 'Assign to me');
    await updatePromise;

    // Close and reopen to verify persistence
    await page.click('#done-btn');
    await openIssueByTitle(page, title);

    const assigneeText = page.locator('#assignee-text');
    await expect(assigneeText).toContainText('Admin User');

    // Verify "Unassigned" option
    await selectAssignee(page, 'Unassigned');
    await expect(assigneeText).toContainText('Unassigned');

    await page.click('#done-btn');
  });
});
