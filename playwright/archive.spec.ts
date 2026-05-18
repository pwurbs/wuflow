import { test, expect } from './fixtures';
import { createIssue, navigateTo, selectStatus } from './helpers/test-utils';

test.describe('Archive View', () => {
  test.beforeEach(async ({ page, login }) => {
    await login();
  });

  test('navigate to Archive view', async ({ page }) => {
    await navigateTo(page, 'archive');

    // Archive view container should be visible
    await expect(page.locator('#archive-view')).toBeVisible();

    // Check sections
    await expect(page.locator('#archive-done-section')).toBeVisible();
    await expect(page.locator('#archive-archive-section')).toBeVisible();

    // Check headers
    await expect(page.locator('#archive-done-section h2')).toContainText('Board (Done)');
    await expect(page.locator('#archive-archive-section h2')).toContainText('Archive');
  });

  test('move Done issue to Archive using drag and drop', async ({ page }) => {
    // 1. Create an issue and move it to Done
    await createIssue(page, { title: 'Issue to Archive via Drag' });
    await navigateTo(page, 'backlog');
    await page.click('.card:has-text("Issue to Archive via Drag")');
    await selectStatus(page, 'Done');
    await page.click('#done-btn');

    // 2. Navigate to Archive
    await navigateTo(page, 'archive');

    // 3. Verify it is in Done section
    const doneSection = page.locator('#archive-done-list');
    const archiveSection = page.locator('#archive-list');
    const card = doneSection.locator('.card', { hasText: 'Issue to Archive via Drag' });
    await expect(card).toBeVisible();

    // 4. Drag to the Archive section heading — targeting the heading ensures the drop
    // lands on the section background (not on #archive-list), so the correct
    // setupSectionDrop handler fires and POST /api/projects/{pId}/issues/{id}/archive is called.
    const archiveSectionHeading = page.locator('#archive-archive-section h2');
    await expect(archiveSectionHeading).toBeVisible();
    await card.dragTo(archiveSectionHeading);

    // 5. Verify it is now in Archive section
    await expect(archiveSection.locator('.card', { hasText: 'Issue to Archive via Drag' })).toBeVisible();
    await expect(doneSection.locator('.card', { hasText: 'Issue to Archive via Drag' })).toBeHidden();
  });

  test('archived issue should not be draggable', async ({ page }) => {
    await createIssue(page, { title: 'Non-draggable Issue' });

    // Set to Archive via modal
    await navigateTo(page, 'backlog');
    await page.click('.card:has-text("Non-draggable Issue")');
    await page.click('#archive-issue-btn');
    await page.click('#confirm-ok-btn');

    await navigateTo(page, 'archive');

    const card = page.locator('#archive-list .card', { hasText: 'Non-draggable Issue' });
    await expect(card).toBeVisible();

    // 1. Verify draggable attribute is false
    await expect(card).toHaveAttribute('draggable', 'false');

    // 2. Try to drag (Playwright's dragTo might still try, but it should stay put)
    const doneSection = page.locator('#archive-done-section');
    await card.dragTo(doneSection);

    // Verify it stayed in Archive
    await expect(card).toBeVisible();
    await expect(page.locator('#archive-done-list .card', { hasText: 'Non-draggable Issue' })).toBeHidden();
  });

  test('unarchive issue via modal', async ({ page }) => {
    // 1. Create and archive an issue
    await createIssue(page, { title: 'Unarchive Me' });
    await navigateTo(page, 'backlog');
    await page.click('.card:has-text("Unarchive Me")');
    await page.click('#archive-issue-btn');
    await page.click('#confirm-ok-btn');

    await navigateTo(page, 'archive');

    // 2. Open modal from Archive view
    await page.click('.card:has-text("Unarchive Me")');

    // 3. Verify Archive button hidden, Unarchive visible
    await expect(page.locator('#archive-issue-btn')).toBeHidden();
    await expect(page.locator('#unarchive-issue-btn')).toBeVisible();

    // 4. Click Unarchive
    await page.click('#unarchive-issue-btn');
    await page.click('#confirm-ok-btn');

    // 5. Verify it moved to Done section in Archive view (or board Done col, but archive view shows Done too)
    await expect(page.locator('#archive-done-list .card', { hasText: 'Unarchive Me' })).toBeVisible();
    await expect(page.locator('#archive-list .card', { hasText: 'Unarchive Me' })).toBeHidden();
  });

  test('archive issue via modal', async ({ page }) => {
    await createIssue(page, { title: 'Modal Archive Issue' });

    await navigateTo(page, 'backlog');

    await navigateTo(page, 'backlog');
    // Open Modal
    await page.click('.card:has-text("Modal Archive Issue")');

    // Select Archive
    // Select Archive
    await page.click('#archive-issue-btn');
    await page.click('#confirm-ok-btn');

    // Go to Archive view
    await navigateTo(page, 'archive');

    // Verify
    await expect(page.locator('#archive-list .card', { hasText: 'Modal Archive Issue' })).toBeVisible();

    // Verify it's NOT in Done section
    await expect(page.locator('#archive-done-list .card', { hasText: 'Modal Archive Issue' })).toBeHidden();
  });

  test('archived issue should not be visible on board', async ({ page }) => {
    await createIssue(page, { title: 'Hidden on Board' });

    // Archive it
    await navigateTo(page, 'backlog');
    await page.click('.card:has-text("Hidden on Board")');
    await page.click('#archive-issue-btn');
    await page.click('#confirm-ok-btn');

    // Go to Board
    await navigateTo(page, 'board');

    // Verify hidden
    await expect(page.locator('.card', { hasText: 'Hidden on Board' })).toBeHidden();
  });


  test('prevent archive with open tasks', async ({ page }) => {
    await createIssue(page, { title: 'Issue with Task' });
    await navigateTo(page, 'backlog');
    await page.click('.card:has-text("Issue with Task")');

    // Add task
    await page.fill('#new-task-title', 'Open Task');
    await page.click('#add-task-btn');

    // Try to archive
    await page.click('#archive-issue-btn');

    // Expect modal alert
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await expect(page.locator('#confirm-title')).toHaveText('Cannot Archive');
    await expect(page.locator('#confirm-message')).toHaveText('Issue has open tasks');

    // Click OK
    await page.click('#confirm-ok-btn');
    await expect(page.locator('#confirm-modal')).toBeHidden();

    // Verify main issue modal is STILL visible
    await expect(page.locator('#issue-modal')).toBeVisible();

    // Close modal
    await page.click('#done-btn');
  });

  test('prevent archive with planned dates via drag', async ({ page }) => {
    // Create as To-do so it appears on the board (not backlog)
    await createIssue(page, { title: 'Planned Issue', status: 'Todo' });

    // Plan it (drag to planning - simulates adding date)
    // "Planned Dates" are usually set via Planning View (which is on Board).
    // Let's go to Planning (Board) view and drag it there.
    await navigateTo(page, 'board');

    // Find the CARD on the board (it's not a planning item yet)
    // Target specific column to avoid duplicates (e.g. if backlog is also visible or other elements match)
    const cardToPlan = page.locator('.column[data-status="Todo"] .card', { hasText: 'Planned Issue' });
    await expect(cardToPlan).toBeVisible();

    const todayCol = page.locator('.planning-day').filter({ hasNotText: 'Unscheduled' }).first();
    await cardToPlan.dragTo(todayCol);

    // Verify it appears in planning (confirms planned_dates is set on server)
    await expect(page.locator('.planning-item', { hasText: 'Planned Issue' })).toBeVisible();

    // Now go to Board and move to Done (we need it in Done to see it in Archive's Done list)
    await navigateTo(page, 'board');
    const cardToMove = page.locator('.column[data-status="Todo"] .card', { hasText: 'Planned Issue' });
    await expect(cardToMove).toBeVisible();

    // Use modal to be more reliable than drag-and-drop on board
    await cardToMove.click();
    await expect(page.locator('#issue-modal')).toBeVisible();
    await page.click('#status-trigger');
    await page.click('#status-options .custom-option:has-text("Done")');
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Now go to Archive
    await navigateTo(page, 'archive');

    // Drag from Done list to Archive list
    const archiveList = page.locator('#archive-list');
    const doneCard = page.locator('#archive-done-list .card', { hasText: 'Planned Issue' });
    await expect(doneCard).toBeVisible();

    // Manual drag for better reliability
    const box = await archiveList.boundingBox();
    if (box) {
      await doneCard.hover();
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
      await page.mouse.up();
    }

    // Expect modal alert
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await expect(page.locator('#confirm-title')).toHaveText('Cannot Archive');
    await expect(page.locator('#confirm-message')).toHaveText('Issue has planned dates');

    // Click OK
    await page.click('#confirm-ok-btn');
    await expect(page.locator('#confirm-modal')).toBeHidden();

    // Verify Issue Modal opens automatically
    await expect(page.locator('#issue-modal')).toBeVisible();
    await expect(page.locator('#title')).toHaveValue('Planned Issue');

    // Close modal
    await page.click('#done-btn');

    // Verify still in Done list (not archived)
    await expect(page.locator('#archive-done-list .card', { hasText: 'Planned Issue' })).toBeVisible();
  });

  test('archived issue should be read-only in modal', async ({ page }) => {
    await createIssue(page, { title: 'Read Only Issue' });

    // Archive via modal
    await navigateTo(page, 'backlog');
    await page.click('.card:has-text("Read Only Issue")');
    await page.click('#archive-issue-btn');
    await page.click('#confirm-ok-btn');

    await navigateTo(page, 'archive');

    // Open archived issue
    await page.click('.card:has-text("Read Only Issue")');

    // Verify Modal Title
    await expect(page.locator('#modal-title')).toContainText('Archived Issue');

    // Verify Read-Only State

    // 1. Task form hidden
    await expect(page.locator('#task-form-container')).toBeHidden();

    // 2. Title not inline-editable (click doesn't change class to inline-editing)
    await page.click('#title');
    await expect(page.locator('#title')).not.toHaveClass(/inline-editing/);
    await expect(page.locator('#title-edit-actions')).toBeHidden();

    // 3. Description not inline-editable
    await page.click('#description-preview');
    await expect(page.locator('.editor-container')).not.toHaveClass(/inline-editing/);

    // 4. Dropdowns disabled
    await expect(page.locator('#status-trigger')).toHaveCSS('pointer-events', 'none');

    // 6. Buttons visibility
    await expect(page.locator('#save-issue-btn')).toBeHidden();
    await expect(page.locator('#archive-issue-btn')).toBeHidden();
    await expect(page.locator('#unarchive-issue-btn')).toBeVisible();

    // 7. Deletion controls hidden
    await expect(page.locator('#delete-issue-btn')).toBeHidden();
    // Assuming there's at least one task if we want to check task deletion buttons
    // But since the task form is hidden, we can just check if any existing task delete buttons are hidden
    // Even if no tasks, the test passes. If we want to be thorough, we should ensure a task exists.
  });

  test('archived issue should not be deletable', async ({ page }) => {
    await createIssue(page, { title: 'Non-deletable Issue' });
    await navigateTo(page, 'backlog');
    await page.click('.card:has-text("Non-deletable Issue")');

    // Archive it
    await page.click('#archive-issue-btn');
    await page.click('#confirm-ok-btn');

    await navigateTo(page, 'archive');
    await page.click('.card:has-text("Non-deletable Issue")');

    // 1. Verify delete button is hidden
    await expect(page.locator('#delete-issue-btn')).toBeHidden();

    // 2. Verify deletion via API is blocked (403)
    const issueId = await page.inputValue('#issue-id');
    const deleteResponse = await page.evaluate(async (id) => {
      const resp = await fetch(`/api/projects/1/issues/${id}`, { method: 'DELETE' });
      return resp.status;
    }, issueId);

    expect(deleteResponse).toBe(403);
  });
});
