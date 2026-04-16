import { test, expect } from './fixtures';
import { createIssue, navigateTo, selectAssignee, selectStatus, openIssueByTitle } from './helpers/test-utils';

test.describe('Filtering and Search', () => {
  test.beforeEach(async ({ page, login }) => {
    await login();
  });

  test('search filters issues by text', async ({ page }) => {
    // Create some issues with different titles (in To-Do so they appear on board)
    await createIssue(page, { title: 'Alpha Issue', status: 'Todo' });
    await createIssue(page, { title: 'Beta Issue', status: 'Todo' });
    await createIssue(page, { title: 'Gamma Issue', status: 'Todo' });

    // Verify all three are visible (use .board-card to target board cards specifically)
    await expect(page.locator('.board-card:has-text("Alpha Issue")')).toBeVisible();
    await expect(page.locator('.board-card:has-text("Beta Issue")')).toBeVisible();
    await expect(page.locator('.board-card:has-text("Gamma Issue")')).toBeVisible();

    // Type in search box
    await page.fill('#search-input', 'Alpha');

    // Only Alpha should be visible
    await expect(page.locator('.board-card:has-text("Alpha Issue")')).toBeVisible();
    await expect(page.locator('.board-card:has-text("Beta Issue")')).toBeHidden();
    await expect(page.locator('.board-card:has-text("Gamma Issue")')).toBeHidden();

    // Clear search
    await page.fill('#search-input', '');

    // All should be visible again
    await expect(page.locator('.board-card:has-text("Alpha Issue")')).toBeVisible();
    await expect(page.locator('.board-card:has-text("Beta Issue")')).toBeVisible();
    await expect(page.locator('.board-card:has-text("Gamma Issue")')).toBeVisible();
  });

  test('filter issues by priority', async ({ page }) => {
    // Create issues with different priorities
    await createIssue(page, { title: 'High Priority Issue', status: 'Todo', priority: 'High' });
    await createIssue(page, { title: 'Normal Priority Issue', status: 'Todo' });

    // Both should be visible initially
    await expect(page.locator('.board-card:has-text("High Priority Issue")')).toBeVisible();
    await expect(page.locator('.board-card:has-text("Normal Priority Issue")')).toBeVisible();

    // Open priority filter dropdown
    await page.click('#priority-filter-btn');

    // Select High priority filter
    await page.click('#priority-filter-options .custom-option:has-text("High")');

    // Only High priority issue should be visible
    await expect(page.locator('.board-card:has-text("High Priority Issue")')).toBeVisible();
    await expect(page.locator('.board-card:has-text("Normal Priority Issue")')).toBeHidden();
  });

  test('filter issues by label', async ({ page }) => {
    // First create a label
    await navigateTo(page, 'setup');
    await page.fill('#new-label-input', 'Bug');
    await page.click('#add-label-btn');
    await expect(page.locator('#labels-list')).toContainText('Bug');

    // Go back to board
    await navigateTo(page, 'board');

    // Create issue with label
    await createIssue(page, { title: 'Bug Issue', status: 'Todo', label: 'Bug' });

    // Create issue without label
    await createIssue(page, { title: 'Feature Issue', status: 'Todo' });

    // Both should be visible
    await expect(page.locator('.board-card:has-text("Bug Issue")')).toBeVisible();
    await expect(page.locator('.board-card:has-text("Feature Issue")')).toBeVisible();

    // Open label filter
    await page.click('#label-filter-btn');

    // Select Bug label filter
    await page.click('#label-filter-options .custom-option:has-text("Bug")');

    // Only Bug issue should be visible
    await expect(page.locator('.board-card:has-text("Bug Issue")')).toBeVisible();
    await expect(page.locator('.board-card:has-text("Feature Issue")')).toBeHidden();
  });

  test('combining search with filters', async ({ page }) => {
    // Create issues with High priority
    await createIssue(page, { title: 'Important Task Alpha', status: 'Todo', priority: 'High' });
    await createIssue(page, { title: 'Important Task Beta', status: 'Todo', priority: 'High' });

    // Apply priority filter
    await page.click('#priority-filter-btn');
    await page.click('#priority-filter-options .custom-option:has-text("High")');

    // Both High priority issues should be visible
    await expect(page.locator('.board-card:has-text("Important Task Alpha")')).toBeVisible();
    await expect(page.locator('.board-card:has-text("Important Task Beta")')).toBeVisible();

    // Add search filter
    await page.fill('#search-input', 'Alpha');

    // Only Alpha should remain visible
    await expect(page.locator('.board-card:has-text("Important Task Alpha")')).toBeVisible();
    await expect(page.locator('.board-card:has-text("Important Task Beta")')).toBeHidden();
  });

  test('badges show filtered/total counts when filter is active', async ({ page }) => {
    // Create 3 issues in To-do: 2 matching "Test", 1 not matching
    await createIssue(page, { title: 'Test Issue 1', status: 'Todo' });
    await createIssue(page, { title: 'Test Issue 2', status: 'Todo' });
    await createIssue(page, { title: 'Other Issue', status: 'Todo' });

    // Verify initial count (no filter) -> matches simple number
    await expect(page.locator('.column[data-status="Todo"] .count')).toHaveText(/^\d+$/);

    // Apply search filter "Test"
    await page.fill('#search-input', 'Test');

    // Verify badge shows "x/y" format
    await expect(page.locator('.column[data-status="Todo"] .count')).toHaveText(/^\d+\/\d+$/);

    // Clear filter
    await page.fill('#search-input', '');

    // Verify badge reverts to simple number
    await expect(page.locator('.column[data-status="Todo"] .count')).toHaveText(/^\d+$/);
  });

  test('filter issues by user (assignee)', async ({ page }) => {
    // Create issues for different users
    const title1 = 'Admin Task ' + Date.now();
    const title2 = 'Unassigned Task ' + Date.now();

    await createIssue(page, { title: title1, status: 'Todo' });
    await createIssue(page, { title: title2, status: 'Todo' });

    // Assign title1 to Admin User
    await openIssueByTitle(page, title1);
    await selectAssignee(page, 'Assign to me');
    await page.click('#done-btn');

    // Both should be visible initially
    await expect(page.locator('.board-card:has-text("' + title1 + '")')).toBeVisible();
    await expect(page.locator('.board-card:has-text("' + title2 + '")')).toBeVisible();

    // Open user filter
    await page.click('#user-filter-btn');

    // Select Admin User filter
    await page.click('#user-filter-options .custom-option:has-text("Admin User")');

    // Only Admin Task should be visible
    await expect(page.locator('.board-card:has-text("' + title1 + '")')).toBeVisible();
    await expect(page.locator('.board-card:has-text("' + title2 + '")')).toBeHidden();

    // Clear filter
    await page.click('#user-filter-btn .toolbar-icon-clear');

    await expect(page.locator('.board-card:has-text("' + title1 + '")')).toBeVisible();
    await expect(page.locator('.board-card:has-text("' + title2 + '")')).toBeVisible();
  });

  test('filter issues by "My Issues" on board, backlog and archive', async ({ page }) => {
    const myIssue = 'My Issue ' + Date.now();
    const otherIssue = 'Other Issue ' + Date.now();

    // Create two issues in the board column and assign one to the current user
    await createIssue(page, { title: myIssue, status: 'Todo' });
    await createIssue(page, { title: otherIssue, status: 'Todo' });

    await openIssueByTitle(page, myIssue);
    await selectAssignee(page, 'Assign to me');
    await page.click('#done-btn');

    // ── Board view ──────────────────────────────────────────────────────────
    await expect(page.locator(`.board-card:has-text("${myIssue}")`)).toBeVisible();
    await expect(page.locator(`.board-card:has-text("${otherIssue}")`)).toBeVisible();

    await page.click('#user-filter-btn');
    await page.click('#user-filter-options .custom-option:has-text("My Issues")');

    await expect(page.locator('#user-filter-btn')).toContainText('My Issues');
    await expect(page.locator(`.board-card:has-text("${myIssue}")`)).toBeVisible();
    await expect(page.locator(`.board-card:has-text("${otherIssue}")`)).toBeHidden();

    await page.click('#user-filter-btn .toolbar-icon-clear');

    // ── Backlog view ────────────────────────────────────────────────────────
    // Move both issues to Open status so they appear in the backlog
    await openIssueByTitle(page, myIssue);
    await selectStatus(page, 'Open');
    await page.click('#done-btn');

    await openIssueByTitle(page, otherIssue);
    await selectStatus(page, 'Open');
    await page.click('#done-btn');

    await navigateTo(page, 'backlog');

    await expect(page.locator(`#backlog-list .card:has-text("${myIssue}")`)).toBeVisible();
    await expect(page.locator(`#backlog-list .card:has-text("${otherIssue}")`)).toBeVisible();

    await page.click('#user-filter-btn');
    await page.click('#user-filter-options .custom-option:has-text("My Issues")');

    await expect(page.locator(`#backlog-list .card:has-text("${myIssue}")`)).toBeVisible();
    await expect(page.locator(`#backlog-list .card:has-text("${otherIssue}")`)).toBeHidden();

    await page.click('#user-filter-btn .toolbar-icon-clear');

    // ── Archive view ────────────────────────────────────────────────────────
    // Archive both issues directly from the backlog
    await page.click(`#backlog-list .card:has-text("${myIssue}")`);
    await expect(page.locator('#issue-modal')).toBeVisible();
    await page.click('#archive-issue-btn');
    await page.click('#confirm-ok-btn');

    await page.click(`#backlog-list .card:has-text("${otherIssue}")`);
    await expect(page.locator('#issue-modal')).toBeVisible();
    await page.click('#archive-issue-btn');
    await page.click('#confirm-ok-btn');

    await navigateTo(page, 'archive');

    await expect(page.locator(`#archive-list .card:has-text("${myIssue}")`)).toBeVisible();
    await expect(page.locator(`#archive-list .card:has-text("${otherIssue}")`)).toBeVisible();

    await page.click('#user-filter-btn');
    await page.click('#user-filter-options .custom-option:has-text("My Issues")');

    await expect(page.locator(`#archive-list .card:has-text("${myIssue}")`)).toBeVisible();
    await expect(page.locator(`#archive-list .card:has-text("${otherIssue}")`)).toBeHidden();

    await page.click('#user-filter-btn .toolbar-icon-clear');
  });
});

test.describe('Planning Panel Filtering', () => {
  const formatDate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  test.beforeEach(async ({ page, login }) => {
    await login();
    // Make sure planning panel is visible
    await expect(page.locator('#planning-panel')).toBeVisible();
  });

  test('filters planned issues by text', async ({ page }) => {
    const today = new Date();
    const dateStr = formatDate(today);

    await createIssue(page, { title: 'Plan Key', status: 'Todo', plannedDate: dateStr });
    await createIssue(page, { title: 'Plan Hidden', status: 'Todo', plannedDate: dateStr });

    const dayContainer = page.locator(`#day-${dateStr}`);
    await expect(dayContainer.locator('.planning-item', { hasText: 'Plan Key' })).toBeVisible();
    await expect(dayContainer.locator('.planning-item', { hasText: 'Plan Hidden' })).toBeVisible();

    await page.fill('#search-input', 'Key');

    await expect(dayContainer.locator('.planning-item', { hasText: 'Plan Key' })).toBeVisible();
    await expect(dayContainer.locator('.planning-item', { hasText: 'Plan Hidden' })).toBeHidden();
  });

  test('filters planned issues by priority', async ({ page }) => {
    const today = new Date();
    const dateStr = formatDate(today);

    await createIssue(page, { title: 'Plan High', status: 'Todo', priority: 'High', plannedDate: dateStr });
    await createIssue(page, { title: 'Plan Normal', status: 'Todo', priority: 'Normal', plannedDate: dateStr });

    const dayContainer = page.locator(`#day-${dateStr}`);

    // Open priority filter
    await page.click('#priority-filter-btn');
    await page.click('#priority-filter-options .custom-option:has-text("High")');

    await expect(dayContainer.locator('.planning-item', { hasText: 'Plan High' })).toBeVisible();
    await expect(dayContainer.locator('.planning-item', { hasText: 'Plan Normal' })).toBeHidden();
  });

  test('filters planned issues by label', async ({ page }) => {
    const today = new Date();
    const dateStr = formatDate(today);

    // Create label
    await navigateTo(page, 'setup');
    await page.fill('#new-label-input', 'PlanLabel');
    await page.click('#add-label-btn');
    await navigateTo(page, 'board');

    await createIssue(page, { title: 'Plan Labeled', status: 'Todo', label: 'PlanLabel', plannedDate: dateStr });
    await createIssue(page, { title: 'Plan Unlabeled', status: 'Todo', plannedDate: dateStr });

    const dayContainer = page.locator(`#day-${dateStr}`);

    // Open label filter
    await page.click('#label-filter-btn');
    await page.click('#label-filter-options .custom-option:has-text("PlanLabel")');

    await expect(dayContainer.locator('.planning-item', { hasText: 'Plan Labeled' })).toBeVisible();
    await expect(dayContainer.locator('.planning-item', { hasText: 'Plan Unlabeled' })).toBeHidden();
  });
});
