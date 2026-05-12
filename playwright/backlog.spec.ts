import { test, expect } from './fixtures';
import { createIssue, createRelease, navigateTo, selectStatus } from './helpers/test-utils';

test.describe('Backlog View', () => {
  test.beforeEach(async ({ page, login }) => {
    await login();
  });

  test('navigate to Backlog view', async ({ page }) => {
    await navigateTo(page, 'backlog');

    // Backlog view should be visible
    await expect(page.locator('#backlog-view')).toBeVisible();

    // Board should be hidden
    await expect(page.locator('.board')).toBeHidden();

    // Backlog sections should be visible
    await expect(page.locator('#backlog-todo-section')).toBeVisible();
    await expect(page.locator('#backlog-open-section')).toBeVisible();

    // Check headers
    await expect(page.locator('#backlog-todo-section h2')).toContainText('Board (Todo)');
    await expect(page.locator('#backlog-open-section h2')).toContainText('Open');
  });

  test('create issue with Open status appears in Backlog', async ({ page }) => {
    // Create issue with Open status (this is the default)
    // Note: createIssue defaults to Open if no status is provided
    await createIssue(page, { title: 'Backlog Issue' });

    // Navigate to Backlog
    await navigateTo(page, 'backlog');

    // Verify issue appears in Backlog (Open) section
    await expect(page.locator('#backlog-list')).toContainText('Backlog Issue');
  });

  test('move issue from Open to To-Do', async ({ page }) => {
    // Create issue with Open status (default)
    await createIssue(page, { title: 'Move to Board Issue' });

    // Navigate to Backlog
    await navigateTo(page, 'backlog');

    // Verify issue is in backlog
    await expect(page.locator('#backlog-list')).toContainText('Move to Board Issue');

    // Open the issue
    await page.click('#backlog-list .card:has-text("Move to Board Issue")');
    await expect(page.locator('#issue-modal')).toBeVisible();

    // Change status to To-Do
    await selectStatus(page, 'Todo');

    // Close modal
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Navigate to Board
    await navigateTo(page, 'board');

    // Verify issue is now in To-Do column on Board
    await expect(page.locator('.column[data-status="Todo"] .card')).toContainText('Move to Board Issue');
  });

  test('backlog counts are displayed', async ({ page }) => {
    await navigateTo(page, 'backlog');

    // Verify count elements exist
    await expect(page.locator('#backlog-count')).toBeVisible();
    await expect(page.locator('#todo-count')).toBeVisible();
  });

  test('return to Board view from Backlog', async ({ page }) => {
    // Go to Backlog
    await navigateTo(page, 'backlog');
    await expect(page.locator('#backlog-view')).toBeVisible();


    // Return to Board
    await navigateTo(page, 'board');

    // Board should be visible again
    await expect(page.locator('.board')).toBeVisible();
    await expect(page.locator('#backlog-view')).toBeHidden();
  });

  test('delete issue from backlog', async ({ page }) => {
    // Create issue with Open status (in backlog)
    await createIssue(page, { title: 'Backlog Delete Issue' });

    // Navigate to Backlog
    await navigateTo(page, 'backlog');

    // Verify issue is in backlog
    await expect(page.locator('#backlog-list')).toContainText('Backlog Delete Issue');

    // Open the issue
    await page.click('#backlog-list .card:has-text("Backlog Delete Issue")');
    await expect(page.locator('#issue-modal')).toBeVisible();

    // Delete the issue
    await page.click('#delete-issue-btn');
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await page.click('#confirm-ok-btn');

    // Wait for modals to close
    await expect(page.locator('#confirm-modal')).toBeHidden();
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Verify issue is removed from backlog
    await expect(page.locator('#backlog-list')).not.toContainText('Backlog Delete Issue');
  });

  test('edit issue in backlog view', async ({ page }) => {
    // Create issue in backlog
    await createIssue(page, { title: 'Backlog Edit Issue' });

    // Navigate to Backlog
    await navigateTo(page, 'backlog');

    // Open the issue
    await page.click('#backlog-list .card:has-text("Backlog Edit Issue")');
    await expect(page.locator('#issue-modal')).toBeVisible();

    // Edit the title
    await page.click('#title');
    await page.fill('#title', 'Edited Backlog Issue');

    // Blur to trigger autosave
    const savePromise = page.waitForResponse(r =>
      r.url().includes('/api/issues/') && r.request().method() === 'PUT'
    );
    await page.click('#modal-title');
    await savePromise;

    // Close modal
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Verify the updated title appears in backlog
    await expect(page.locator('#backlog-list')).toContainText('Edited Backlog Issue');
    await expect(page.locator('#backlog-list')).not.toContainText('Backlog Edit Issue');
  });

  test('filter and search in backlog view', async ({ page }) => {
    // Create multiple issues in backlog with different properties
    await createIssue(page, { title: 'Alpha Backlog Issue', priority: 'High' });
    await createIssue(page, { title: 'Beta Backlog Issue', priority: 'Normal' });
    await createIssue(page, { title: 'Gamma Backlog Issue', priority: 'High' });

    // Navigate to Backlog
    await navigateTo(page, 'backlog');

    // Verify all issues are visible
    await expect(page.locator('#backlog-list .card:has-text("Alpha Backlog Issue")')).toBeVisible();
    await expect(page.locator('#backlog-list .card:has-text("Beta Backlog Issue")')).toBeVisible();
    await expect(page.locator('#backlog-list .card:has-text("Gamma Backlog Issue")')).toBeVisible();

    // Test search filter
    await page.fill('#search-input', 'Alpha');

    // Only Alpha should be visible
    await expect(page.locator('#backlog-list .card:has-text("Alpha Backlog Issue")')).toBeVisible();
    await expect(page.locator('#backlog-list .card:has-text("Beta Backlog Issue")')).toBeHidden();
    await expect(page.locator('#backlog-list .card:has-text("Gamma Backlog Issue")')).toBeHidden();

    // Clear search
    await page.fill('#search-input', '');

    // All should be visible again
    await expect(page.locator('#backlog-list .card:has-text("Alpha Backlog Issue")')).toBeVisible();
    await expect(page.locator('#backlog-list .card:has-text("Beta Backlog Issue")')).toBeVisible();
    await expect(page.locator('#backlog-list .card:has-text("Gamma Backlog Issue")')).toBeVisible();

    // Test priority filter
    await page.click('#priority-filter-btn');
    await page.click('#priority-filter-options .custom-option:has-text("High")');

    // Only High priority issues should be visible
    await expect(page.locator('#backlog-list .card:has-text("Alpha Backlog Issue")')).toBeVisible();
    await expect(page.locator('#backlog-list .card:has-text("Beta Backlog Issue")')).toBeHidden();
    await expect(page.locator('#backlog-list .card:has-text("Gamma Backlog Issue")')).toBeVisible();
  });
});

test.describe('Backlog Release Lanes', () => {
  test.beforeEach(async ({ page, login }) => {
    await login();
  });

  test('release lane cards are shown for open releases', async ({ page }) => {
    const relName = `RL_${Date.now().toString().slice(-7)}`;

    await navigateTo(page, 'releases');
    await createRelease(page, { name: relName });

    await navigateTo(page, 'backlog');

    await expect(page.locator('#backlog-release-lanes')).toBeVisible();
    await expect(
      page.locator('#backlog-release-lanes .release-lane-card').filter({ hasText: relName })
    ).toBeVisible();
  });

  test('dragging an issue onto a release lane card assigns the release', async ({ page }) => {
    const relName = `RL_${Date.now().toString().slice(-7)}`;
    const issueTitle = `DragRel_${Date.now().toString().slice(-7)}`;

    await navigateTo(page, 'releases');
    await createRelease(page, { name: relName });

    await createIssue(page, { title: issueTitle }); // Open status → appears in backlog list

    await navigateTo(page, 'backlog');

    const laneCard = page.locator('#backlog-release-lanes .release-lane-card').filter({ hasText: relName });
    await expect(laneCard.locator('.release-lane-count')).toHaveText('0');

    const issueCard = page.locator('#backlog-list .card').filter({ hasText: issueTitle });

    const putResponse = page.waitForResponse(r =>
      r.url().includes('/api/issues/') && r.request().method() === 'PUT'
    );
    await issueCard.dragTo(laneCard);
    await putResponse;

    await expect(laneCard.locator('.release-lane-count')).toHaveText('1');
  });

  test('release lane count reflects the number of assigned backlog issues', async ({ page }) => {
    const relName = `RL_${Date.now().toString().slice(-7)}`;
    const issue1Title = `RLC1_${Date.now().toString().slice(-7)}`;
    const issue2Title = `RLC2_${Date.now().toString().slice(-7)}`;

    await navigateTo(page, 'releases');
    await createRelease(page, { name: relName });

    await createIssue(page, { title: issue1Title });
    await createIssue(page, { title: issue2Title });

    await navigateTo(page, 'backlog');

    // Assign release to issue1 via the issue modal (auto-saves on change)
    await page.locator('#backlog-list .card').filter({ hasText: issue1Title }).click();
    await expect(page.locator('#issue-modal')).toBeVisible();
    const put1 = page.waitForResponse(r =>
      r.url().includes('/api/issues/') && r.request().method() === 'PUT'
    );
    await page.click('#release-trigger');
    await page.click(`#release-options .custom-option:has-text("${relName}")`);
    await put1;
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Assign release to issue2
    await page.locator('#backlog-list .card').filter({ hasText: issue2Title }).click();
    await expect(page.locator('#issue-modal')).toBeVisible();
    const put2 = page.waitForResponse(r =>
      r.url().includes('/api/issues/') && r.request().method() === 'PUT'
    );
    await page.click('#release-trigger');
    await page.click(`#release-options .custom-option:has-text("${relName}")`);
    await put2;
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    const laneCard = page.locator('#backlog-release-lanes .release-lane-card').filter({ hasText: relName });
    await expect(laneCard.locator('.release-lane-count')).toHaveText('2');
  });

  test('clicking a release lane card filters the backlog to that release', async ({ page }) => {
    const relName = `RL_${Date.now().toString().slice(-7)}`;
    const assignedTitle = `WithRel_${Date.now().toString().slice(-7)}`;
    const unassignedTitle = `NoRel_${Date.now().toString().slice(-7)}`;

    await navigateTo(page, 'releases');
    await createRelease(page, { name: relName });

    await createIssue(page, { title: assignedTitle });
    await createIssue(page, { title: unassignedTitle });

    await navigateTo(page, 'backlog');

    // Assign release to one issue via the modal
    await page.locator('#backlog-list .card').filter({ hasText: assignedTitle }).click();
    await expect(page.locator('#issue-modal')).toBeVisible();
    const putAssign = page.waitForResponse(r =>
      r.url().includes('/api/issues/') && r.request().method() === 'PUT'
    );
    await page.click('#release-trigger');
    await page.click(`#release-options .custom-option:has-text("${relName}")`);
    await putAssign;
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Both issues visible before filtering
    await expect(page.locator('#backlog-list .card').filter({ hasText: assignedTitle })).toBeVisible();
    await expect(page.locator('#backlog-list .card').filter({ hasText: unassignedTitle })).toBeVisible();

    // Click the release lane card to activate the filter
    const laneCard = page.locator('#backlog-release-lanes .release-lane-card').filter({ hasText: relName });
    await laneCard.click();

    await expect(laneCard).toHaveClass(/active/);
    await expect(page.locator('#backlog-list .card').filter({ hasText: assignedTitle })).toBeVisible();
    await expect(page.locator('#backlog-list .card').filter({ hasText: unassignedTitle })).toBeHidden();

    // Click again to deactivate — both issues return
    await laneCard.click();

    await expect(laneCard).not.toHaveClass(/active/);
    await expect(page.locator('#backlog-list .card').filter({ hasText: assignedTitle })).toBeVisible();
    await expect(page.locator('#backlog-list .card').filter({ hasText: unassignedTitle })).toBeVisible();
  });
});

