import { test, expect } from './fixtures';
import { createIssue, createRelease, selectAssignee, openIssueByTitle, navigateTo } from './helpers/test-utils';

test.describe('Board Functionality', () => {
  test.beforeEach(async ({ login }) => {
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

  test('position-only drag does not update last-changed timestamp', async ({ page }) => {
    const titleA = `Shift Target ${Date.now()}`;
    const titleB = `Drag Card ${Date.now() + 1}`;

    await createIssue(page, { title: titleA, status: 'Todo' });
    await createIssue(page, { title: titleB, status: 'Todo' });

    // Record titleA's updated_at via the API before any drag
    await openIssueByTitle(page, titleA);
    await expect(page.locator('#issue-id')).toHaveValue(/\d+/);
    const issueId = await page.inputValue('#issue-id');
    await page.click('#done-btn');

    const before = await page.request.get(`/api/projects/1/issues/${issueId}`);
    const { updated_at: updatedAtBefore } = await before.json();

    // Drag titleB onto titleA, shifting titleA's position within the same column
    const cardA = page.locator(`.column[data-status="Todo"] .board-card:has-text("${titleA}")`);
    const cardB = page.locator(`.column[data-status="Todo"] .board-card:has-text("${titleB}")`);
    const putPromises: Promise<void>[] = [];
    page.on('response', r => {
      if (r.url().includes('/issues/') && r.request().method() === 'PUT') {
        putPromises.push(r.finished().then(() => {}));
      }
    });
    await cardB.dragTo(cardA);
    await Promise.all(putPromises);

    // updated_at must be unchanged since only position shifted
    const after = await page.request.get(`/api/projects/1/issues/${issueId}`);
    const { updated_at: updatedAtAfter } = await after.json();
    expect(updatedAtAfter).toBe(updatedAtBefore);
  });

  test('assignee badge initials on board card', async ({ page }) => {
    const title = `Badge Test ${Date.now()}`;
    await createIssue(page, { title, status: 'Todo' });

    // Open and assign
    await openIssueByTitle(page, title);

    // Wait for the update request that's triggered by selecting assignee
    const updatePromise = page.waitForResponse(response =>
      response.url().includes('/issues/') && response.request().method() === 'PUT'
    );
    await selectAssignee(page, 'Assign to me');
    await updatePromise;

    await page.click('#done-btn');

    // Verify badge AU appears on the card
    const badge = page.locator(`.board-card:has-text("${title}") .user-badge`);
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('AU');
  });

  test.describe('Card Context Menu', () => {
    test('right-click shows context menu with all expected items', async ({ page }) => {
      const title = `Context Menu ${Date.now()}`;
      await createIssue(page, { title, status: 'Todo' });

      await page.locator(`.column[data-status="Todo"] .board-card:has-text("${title}")`).click({ button: 'right' });

      const menu = page.locator('.card-context-menu');
      await expect(menu).toBeVisible();
      await expect(menu.locator('.card-context-menu-item:has-text("Move to top")')).toBeVisible();
      await expect(menu.locator('.card-context-menu-item:has-text("Move to bottom")')).toBeVisible();
      await expect(menu.locator('.card-context-menu-item:has-text("priority")')).toBeVisible();
      await expect(menu.locator('.card-context-menu-item:has-text("Copy issue ID")')).toBeVisible();
      await expect(menu.locator('.card-context-menu-item:has-text("Assign to me")')).toBeVisible();
    });

    test('context menu closes on Escape', async ({ page }) => {
      const title = `Escape Test ${Date.now()}`;
      await createIssue(page, { title, status: 'Todo' });

      await page.locator(`.column[data-status="Todo"] .board-card:has-text("${title}")`).click({ button: 'right' });
      await expect(page.locator('.card-context-menu')).toBeVisible();

      await page.keyboard.press('Escape');
      await expect(page.locator('.card-context-menu')).toBeHidden();
    });

    test('context menu closes on click outside', async ({ page }) => {
      const title = `Click Outside ${Date.now()}`;
      await createIssue(page, { title, status: 'Todo' });

      await page.locator(`.column[data-status="Todo"] .board-card:has-text("${title}")`).click({ button: 'right' });
      await expect(page.locator('.card-context-menu')).toBeVisible();

      await page.locator('.board-columns').click({ position: { x: 5, y: 5 } });
      await expect(page.locator('.card-context-menu')).toBeHidden();
    });

    test('Move to top disabled for first card, Move to bottom disabled for last card', async ({ page }) => {
      await createIssue(page, { title: `Boundary A ${Date.now()}`, status: 'Todo' });
      await createIssue(page, { title: `Boundary B ${Date.now()}`, status: 'Todo' });

      const cards = page.locator('.column[data-status="Todo"] .column-content .board-card');

      await cards.first().click({ button: 'right' });
      await expect(page.locator('.card-context-menu-item:has-text("Move to top")')).toBeDisabled();
      await page.keyboard.press('Escape');

      await cards.last().click({ button: 'right' });
      await expect(page.locator('.card-context-menu-item:has-text("Move to bottom")')).toBeDisabled();
      await page.keyboard.press('Escape');
    });

    test('Move to top moves card to first position', async ({ page }) => {
      const titleA = `Move A ${Date.now()}`;
      const titleB = `Move B ${Date.now()}`;
      await createIssue(page, { title: titleA, status: 'Todo' });
      await createIssue(page, { title: titleB, status: 'Todo' }); // B is after A

      const cardB = page.locator(`.column[data-status="Todo"] .board-card:has-text("${titleB}")`);
      const updateDone = page.waitForResponse(r =>
        r.url().includes('/issues/') && r.request().method() === 'PUT'
      );
      await cardB.click({ button: 'right' });
      await page.locator('.card-context-menu-item:has-text("Move to top")').click();
      await updateDone;

      const firstCard = page.locator('.column[data-status="Todo"] .column-content .board-card').first();
      await expect(firstCard).toContainText(titleB);
    });

    test('Set high priority applies styling and flips menu label', async ({ page }) => {
      const title = `Priority ${Date.now()}`;
      await createIssue(page, { title, status: 'Todo' });

      const card = page.locator(`.column[data-status="Todo"] .board-card:has-text("${title}")`);

      const updateDone = page.waitForResponse(r =>
        r.url().includes('/issues/') && r.request().method() === 'PUT'
      );
      await card.click({ button: 'right' });
      await page.locator('.card-context-menu-item:has-text("Set high priority")').click();
      await updateDone;

      await expect(card).toHaveClass(/high-priority/);

      await card.click({ button: 'right' });
      await expect(page.locator('.card-context-menu-item:has-text("Remove high priority")')).toBeVisible();
      await page.keyboard.press('Escape');
    });

    test('Assign to me becomes disabled after self-assignment', async ({ page }) => {
      const title = `Self Assign ${Date.now()}`;
      await createIssue(page, { title, status: 'Todo' });

      const card = page.locator(`.column[data-status="Todo"] .board-card:has-text("${title}")`);

      const updateDone = page.waitForResponse(r =>
        r.url().includes('/issues/') && r.request().method() === 'PUT'
      );
      await card.click({ button: 'right' });
      await page.locator('.card-context-menu-item:has-text("Assign to me")').click();
      await updateDone;

      await card.click({ button: 'right' });
      await expect(page.locator('.card-context-menu-item:has-text("Assign to me")')).toBeDisabled();
      await page.keyboard.press('Escape');
    });

    test('Copy issue ID shows success toast', async ({ page }) => {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      const title = `Copy ID ${Date.now()}`;
      await createIssue(page, { title, status: 'Todo' });

      await page.locator(`.column[data-status="Todo"] .board-card:has-text("${title}")`).click({ button: 'right' });
      await page.locator('.card-context-menu-item:has-text("Copy issue ID")').click();

      await expect(page.locator('#notification-toast')).toContainText('Copied #');
    });

    test('no context menu on archive-view card', async ({ page }) => {
      const title = `Archive Card ${Date.now()}`;
      await createIssue(page, { title, status: 'Done' });

      await navigateTo(page, 'archive');
      await page.locator(`#archive-done-list .card:has-text("${title}")`).click({ button: 'right' });

      await expect(page.locator('.card-context-menu')).toBeHidden();
    });
  });

  test.describe('Deadline Styling', () => {
    test('overdue deadline shows red on board card', async ({ page }) => {
      const title = `Overdue Board ${Date.now()}`;
      await createIssue(page, { title, status: 'Todo', deadline: '2020-01-01' });

      const deadline = page.locator(`.board-card:has-text("${title}") .board-card-deadline`);
      await expect(deadline).toBeVisible();
      await expect(deadline).toHaveClass(/overdue/);
    });

    test('deadline past release date shows red on board card', async ({ page }) => {
      // Use near-future dates so the issue lands in the planning panel's "this week"
      // bucket, not "10+ days away", avoiding count interference with planning.spec.ts.
      const today = new Date();
      const relDate = new Date(today); relDate.setDate(today.getDate() + 3);
      const dlDate  = new Date(today); dlDate.setDate(today.getDate() + 6);
      const relDateStr = relDate.toISOString().split('T')[0];
      const dlDateStr  = dlDate.toISOString().split('T')[0];

      const relName = `RB-${Date.now().toString().slice(-8)}`;
      await navigateTo(page, 'releases');
      await createRelease(page, { name: relName, releaseDate: relDateStr });

      await navigateTo(page, 'board');
      const title = `Release Conflict ${Date.now()}`;
      // Create issue without deadline first, then assign release and deadline via modal
      await createIssue(page, { title, status: 'Todo' });
      await openIssueByTitle(page, title);

      // Assign the release
      await page.click('#release-trigger');
      await page.locator(`#release-options .custom-option:has-text("${relName}")`).waitFor({ state: 'visible' });
      await page.click(`#release-options .custom-option:has-text("${relName}")`);
      await page.waitForResponse(r => r.url().includes('/issues/') && r.request().method() === 'PUT');

      // Set deadline after the release date (but < 10 days away to stay out of planning's "10+" bucket)
      await page.fill('#deadline', dlDateStr, { force: true });
      await page.waitForResponse(r => r.url().includes('/issues/') && r.request().method() === 'PUT');

      await page.click('#done-btn');
      await expect(page.locator('#issue-modal')).toBeHidden();

      const deadline = page.locator(`.board-card:has-text("${title}") .board-card-deadline`);
      await expect(deadline).toBeVisible();
      await expect(deadline).toHaveClass(/overdue/);
    });
  });
});
