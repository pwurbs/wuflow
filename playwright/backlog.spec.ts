import { test, expect } from '@playwright/test';
import { createIssue, navigateTo, login, selectStatus } from './helpers/test-utils';

test.describe('Backlog View', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
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
    await expect(page.locator('#col-todo .card')).toContainText('Move to Board Issue');
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
    await page.click('#title-save-btn');

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
  test('reorder issues in backlog using move controls', async ({ page }) => {
    // Create 3 issues with distinct names
    await createIssue(page, { title: 'Issue A' });
    await createIssue(page, { title: 'Issue B' });
    await createIssue(page, { title: 'Issue C' });

    // Navigate to Backlog
    await navigateTo(page, 'backlog');

    // Verify initial expected order (newest first or oldest first? 
    // Usually standard creation appends. But let's check exact list content)
    // By default, createIssue adds to end of list (or via API).
    // Let's assume standard appending order A, B, C for now, but verify first.
    // Actually, `createIssue` uses the UI which might append.
    // Let's just create them and check positions.

    // We expect them to appear in the list.

    // Verify items are present
    await expect(page.locator('#backlog-list .card', { hasText: 'Issue A' })).toBeVisible();
    await expect(page.locator('#backlog-list .card', { hasText: 'Issue B' })).toBeVisible();
    await expect(page.locator('#backlog-list .card', { hasText: 'Issue C' })).toBeVisible();


    // Check initial order. If they are created sequentially, they should be in order or reverse order depending on default sort.
    // Assuming default is by position or ID.
    // If they are not in specific order, we will know from test failure, but let's assume A, B, C for step 1.

    // NOTE: If default sort is by ID desc, it might be C, B, A. 
    // Let's force a known state if possible or just adapt.
    // However, for this test, let's just assert the presence and then reorder specific items.

    // Let's assume the DOM order is consistent with visual order.
    // Let's verify we have [Issue A, Issue B, Issue C] (assuming creation order = position order)
    // If this assumption is wrong, we might need to drag or just accept whatever starts.
    // But better to be deterministic.
    // Let's assume they are appended.

    // Strategy: Identify specific card "Issue C" and move it to Top.
    // Regardless of where it starts (unless it's already top), it should become top.

    const issueC = page.locator('#backlog-list .card', { hasText: 'Issue C' });
    const issueA = page.locator('#backlog-list .card', { hasText: 'Issue A' });

    // Ensure C is NOT at the top initially (if possible).
    // If C is at top, we move A to top.
    const firstTitle = await page.locator('#backlog-list .card .card-title').first().textContent();

    let cardToMoveToTop;
    if (firstTitle === 'Issue C') {
      cardToMoveToTop = issueA;
    } else {
      cardToMoveToTop = issueC;
    }
    const cardTitle = await cardToMoveToTop.locator('.card-title').textContent();

    // Hover to reveal controls (if CSS requires hover, but Playwright .click() on hidden elements might fail or force hover)
    // Our CSS displays .card-move-controls on .card:hover
    // So we MUST hover.
    await cardToMoveToTop.hover();

    // Click 'Move Up' (Up Arrow)
    // The class is .move-up
    await cardToMoveToTop.locator('.move-up').click();

    // Verify it is now the first element
    await expect(page.locator('#backlog-list .card').first()).toContainText(cardTitle!);

    // Now move it to bottom
    await cardToMoveToTop.hover(); // re-hover just in case
    await cardToMoveToTop.locator('.move-down').click();

    // Verify it is now the last element
    await expect(page.locator('#backlog-list .card').last()).toContainText(cardTitle!);

    // Reload and verify persistence
    // Reload and verify persistence
    await page.reload();
    await navigateTo(page, 'backlog');
    // Our app is SPA mostly. Let's explicitly navigate just in case, or check where we are.
    // Actually, navigateTo('backlog') ensures we are there.
    await navigateTo(page, 'backlog');

    await expect(page.locator('#backlog-list .card').last()).toContainText(cardTitle!);
  });
});

