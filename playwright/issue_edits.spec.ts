import { test, expect } from './fixtures';
import { createIssue, createRelease, navigateTo, openIssueByTitle, selectPriority, waitForIssueSave, waitForToast } from './helpers/test-utils';

test.describe('Issue Edit Operations', () => {
  test.beforeEach(async ({ page, login }) => {
    await login();
  });

  test('edit issue description', async ({ page }) => {
    // Create an issue
    await createIssue(page, { title: 'Edit Description Issue', status: 'Todo' });

    // Open the issue
    await openIssueByTitle(page, 'Edit Description Issue');

    // Click on description preview to enable inline editing
    await page.click('#description-preview');

    // Fill in new description
    const newDescription = 'This is the updated description';
    await page.fill('#description-editor', newDescription);

    // Click save on inline edit
    await page.click('#desc-save-btn');

    // Close modal
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Reopen and verify the description was saved
    await openIssueByTitle(page, 'Edit Description Issue');
    await expect(page.locator('#description-editor')).toHaveValue(newDescription);
    await expect(page.locator('#description-preview')).toContainText(newDescription);
  });

  test('reopening same issue shows correct markdown description both times', async ({ page }) => {
    // Verifies that the renderMarkdown cache returns correct data on cache hits:
    // first open populates the cache, second open must serve the same rendered HTML.
    const title = `Reopen-Cache-${Date.now()}`;
    const markdown = '**bold** and *italic*';

    await createIssue(page, { title, status: 'Todo', description: markdown });

    // First open — cache miss, DOMPurify runs
    await openIssueByTitle(page, title);
    const preview = page.locator('#description-preview');
    await expect(preview.locator('strong')).toHaveText('bold');
    await expect(preview.locator('em')).toHaveText('italic');
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Second open — cache hit, must render identically
    await openIssueByTitle(page, title);
    await expect(preview.locator('strong')).toHaveText('bold');
    await expect(preview.locator('em')).toHaveText('italic');
    await page.click('#done-btn');
  });

  test('table toolbar button inserts GFM table and renders it in preview', async ({ page }) => {
    const title = `Table-Test-${Date.now()}`;
    await createIssue(page, { title, status: 'Todo' });
    await openIssueByTitle(page, title);

    // Enter inline edit mode for the description
    await page.click('#description-preview');
    await page.waitForSelector('#description-editor:not([disabled])');

    // Click the table toolbar button
    await page.click('button[data-md="table"]');

    // The textarea should now contain the table template
    const editorValue = await page.locator('#description-editor').inputValue();
    expect(editorValue).toContain('| Header 1 | Header 2 | Header 3 |');
    expect(editorValue).toContain('| --- | --- | --- |');
    expect(editorValue).toContain('| Cell | Cell | Cell |');

    // Save the description
    await page.click('#desc-save-btn');

    // Close and reopen so the persisted description is fetched fresh
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();
    await openIssueByTitle(page, title);

    // The preview should render a <table> with the expected header and cell text
    const preview = page.locator('#description-preview');
    await expect(preview.locator('table')).toHaveCount(1);
    await expect(preview.locator('th').first()).toHaveText('Header 1');
    await expect(preview.locator('td').first()).toHaveText('Cell');
  });

  test('change issue priority', async ({ page }) => {
    // Create an issue with normal priority (default)
    await createIssue(page, { title: 'Priority Change Issue', status: 'Todo' });

    // Open the issue
    await openIssueByTitle(page, 'Priority Change Issue');

    // Change priority to High
    await selectPriority(page, 'High');

    // Close modal
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Reopen and verify priority is High
    await openIssueByTitle(page, 'Priority Change Issue');
    await expect(page.locator('#priority-text')).toContainText('High');
  });

  test('add deadline to existing issue', async ({ page }) => {
    // Create an issue without deadline
    await createIssue(page, { title: 'Add Deadline Issue', status: 'Todo' });

    // Open the issue
    await openIssueByTitle(page, 'Add Deadline Issue');
    await expect(page.locator('#issue-id')).toHaveValue(/\d+/);

    // Add deadline
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const deadlineStr = tomorrow.toISOString().split('T')[0];

    // Wait for the save (a field change now only re-renders locally; the app-wide
    // issues refresh is deferred until the modal closes, not fired per-field).
    const savePromise = waitForIssueSave(page);

    await page.fill('#deadline', deadlineStr);

    await savePromise;

    // Close modal
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Verify issue appears in unscheduled section of planning panel (no planned date yet)
    await expect(page.locator('#unscheduled-section')).toContainText('Add Deadline Issue');
  });

  test('change existing deadline', async ({ page }) => {
    // Create an issue with deadline
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const initialDeadline = tomorrow.toISOString().split('T')[0];

    await createIssue(page, {
      title: 'Change Deadline Issue',
      status: 'Todo',
      deadline: initialDeadline
    });

    // Open the issue
    await openIssueByTitle(page, 'Change Deadline Issue');
    await expect(page.locator('#issue-id')).toHaveValue(/\d+/);

    // Change deadline to a different date
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    const newDeadline = nextWeek.toISOString().split('T')[0];

    // Wait for the save (a field change now only re-renders locally; the app-wide
    // issues refresh is deferred until the modal closes, not fired per-field).
    const savePromise = waitForIssueSave(page);

    await page.fill('#deadline', newDeadline);

    await savePromise;

    // Close modal
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Reopen and verify new deadline
    await openIssueByTitle(page, 'Change Deadline Issue');
    await expect(page.locator('#issue-id')).toHaveValue(/\d+/);
    const deadlineValue = await page.locator('#deadline').inputValue();
    expect(deadlineValue).toBe(newDeadline);
  });

  test('remove deadline from issue', async ({ page }) => {
    // Create an issue with deadline
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const deadline = tomorrow.toISOString().split('T')[0];

    await createIssue(page, {
      title: 'Remove Deadline Issue',
      status: 'Todo',
      deadline: deadline
    });

    // Verify it appears in unscheduled section of planning panel
    await expect(page.locator('#unscheduled-section')).toContainText('Remove Deadline Issue');

    // Open the issue
    await openIssueByTitle(page, 'Remove Deadline Issue');
    await expect(page.locator('#issue-id')).toHaveValue(/\d+/);

    // Clear the deadline — wait for the save (a field change now only re-renders
    // locally; the app-wide issues refresh is deferred until the modal closes).
    const savePromise = waitForIssueSave(page);

    await page.fill('#deadline', '');

    await savePromise;

    // Close modal
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Verify it's removed from unscheduled section (the section itself may be hidden when empty)
    await expect(page.locator('#unscheduled-section').filter({ hasText: 'Remove Deadline Issue' })).toHaveCount(0);
  });

  // Note: Label editing tests removed as the UI doesn't support changing labels
  // after issue creation in the current implementation
});

test.describe('Project change resets project-scoped fields', () => {
  test.beforeEach(async ({ page, login }) => {
    await login();
  });

  test('changing project resets label, release and status to defaults', async ({ page }) => {
    // Create a second project
    await navigateTo(page, 'system-settings');
    await page.click('#add-project-btn');
    await expect(page.locator('#project-modal-overlay')).toBeVisible();
    const projectName = `ResetTest_${Date.now().toString().slice(-5)}`;
    await page.fill('#project-name', projectName);
    await page.click('#project-modal-save');
    await expect(page.locator('#project-modal-overlay')).toBeHidden();

    // Create a label in the default project
    await navigateTo(page, 'project-settings');
    await page.click('#project-selector-btn');
    await page.click('#project-selector-options .custom-option:has-text("default")');
    const labelName = `Lbl_${Date.now().toString().slice(-5)}`;
    await page.fill('#ps-new-label-input', labelName);
    await page.press('#ps-new-label-input', 'Enter');
    await expect(page.locator('#ps-labels-list')).toContainText(labelName);

    // Create a release in the default project
    await navigateTo(page, 'releases');
    const relName = `Rel_${Date.now().toString().slice(-5)}`;
    await createRelease(page, { name: relName });
    await waitForToast(page, 'Release created');

    // Create an issue with label, release and a non-Open status
    await navigateTo(page, 'board');
    await createIssue(page, { title: 'ProjectChangeIssue', status: 'Todo', label: labelName });

    // Open the issue and assign the release
    await openIssueByTitle(page, 'ProjectChangeIssue');
    await page.click('#release-trigger');
    await page.click(`#release-options .custom-option:has-text("${relName}")`);
    await waitForToast(page, 'Release updated');

    // Verify label, release and status are set
    await expect(page.locator('#label-text')).toContainText(labelName);
    await expect(page.locator('#release-text')).toContainText(relName);
    await expect(page.locator('#status-text')).toContainText('Todo');

    // Change the project inside the modal — confirm the destructive action
    await page.click('#project-trigger');
    await page.click(`#project-options .custom-option:has-text("${projectName}")`);
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/move') && r.request().method() === 'POST'),
      page.click('#confirm-ok-btn'),
    ]);

    // Toast must inform the user about the reset
    await waitForToast(page, 'Project changed');

    // Label, release and status must be reset immediately in the UI
    await expect(page.locator('#label-text')).toContainText('No Label');
    await expect(page.locator('#release-text')).toContainText('No Release');
    await expect(page.locator('#status-text')).toContainText('Open');

    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Issue now belongs to the new project with Open status (backlog) — switch project and view
    await page.click('#project-selector-btn');
    await page.click(`#project-selector-options .custom-option:has-text("${projectName}")`);
    await navigateTo(page, 'backlog');

    // Reopen the issue and confirm the reset values were persisted
    await openIssueByTitle(page, 'ProjectChangeIssue');
    await expect(page.locator('#label-text')).toContainText('No Label');
    await expect(page.locator('#release-text')).toContainText('No Release');
    await expect(page.locator('#status-text')).toContainText('Open');
    await page.click('#done-btn');
  });

  test.describe('Deadline Warnings', () => {
    test('overdue issue deadline shows red in edit modal', async ({ page }) => {
      const title = `Overdue Modal ${Date.now()}`;
      await createIssue(page, { title, status: 'Todo', deadline: '2020-01-01' });
      await openIssueByTitle(page, title);

      await expect(page.locator('#deadline-display')).toHaveClass(/overdue/);
      await page.click('#done-btn');
    });

    test('warning toast shown when issue deadline is set past release date', async ({ page }) => {
      // Use near-future dates so the issue lands in "this week" in planning, not "10+ days away".
      const today = new Date();
      const relDate = new Date(today); relDate.setDate(today.getDate() + 3);
      const dlDate  = new Date(today); dlDate.setDate(today.getDate() + 6);
      const relDateStr = relDate.toISOString().split('T')[0];
      const dlDateStr  = dlDate.toISOString().split('T')[0];

      const relName = `RI-${Date.now().toString().slice(-8)}`;
      await navigateTo(page, 'releases');
      await createRelease(page, { name: relName, releaseDate: relDateStr });

      await navigateTo(page, 'board');
      const title = `Issue Release Toast ${Date.now()}`;
      await createIssue(page, { title, status: 'Todo' });
      await openIssueByTitle(page, title);

      // Assign the release
      await page.click('#release-trigger');
      await page.locator(`#release-options .custom-option:has-text("${relName}")`).waitFor({ state: 'visible' });
      await page.click(`#release-options .custom-option:has-text("${relName}")`);
      await page.waitForResponse(r => /\/api\/projects\/\d+\/issues\/\d+/.test(r.url()) && r.request().method() === 'PUT');

      // Set a deadline after the release date — should trigger amber warning toast
      await page.fill('#deadline', dlDateStr, { force: true });
      await page.waitForResponse(r => /\/api\/projects\/\d+\/issues\/\d+/.test(r.url()) && r.request().method() === 'PUT');

      const toast = page.locator('#notification-toast');
      await expect(toast).toBeVisible();
      await expect(toast).toHaveClass(/warning/);
      await expect(toast).toContainText('Past release date!');

      await page.click('#done-btn');
    });
  });
});

test.describe('Move issue – permission gate', () => {
  let adminEmail = '';
  let adminPassword = '';
  let userEmail = '';
  let userPassword = '';

  test.beforeAll(async ({ workerServer }) => {
    adminEmail = workerServer.adminEmail;
    adminPassword = workerServer.adminPassword;
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('#login-email', adminEmail);
    await page.fill('#login-password', adminPassword);
    await page.click('#login-btn');
    await expect(page.locator('#nav-system-settings')).toBeVisible();

    await page.click('#nav-system-settings');
    await page.click('#add-user-btn');
    userEmail = `move_perm_${Date.now()}@example.com`;
    userPassword = `${Date.now()}Aa!`;
    await page.fill('#user-email', userEmail);
    await page.fill('#user-first-name', 'Move');
    await page.fill('#user-last-name', 'TestUser');
    await page.fill('#user-password', userPassword);
    // Default role is 'user' — no role change needed
    await page.click('#user-modal-save');
    await expect(page.locator('#user-modal-overlay')).toBeHidden();

    await page.click('#user-menu-btn');
    await page.click('#user-menu-logout');
    await expect(page).toHaveURL(/\/login/);
  });

  test('standard user sees project dropdown disabled on existing issue', async ({ page }) => {
    await page.fill('#login-email', userEmail);
    await page.fill('#login-password', userPassword);
    await page.click('#login-btn');
    await expect(page.locator('.board')).toBeVisible();

    await createIssue(page, { title: 'MovePermIssue', status: 'Todo' });

    const card = page.locator('.column[data-status="Todo"] .card:has-text("MovePermIssue")');
    await card.click();
    await expect(page.locator('#issue-modal')).toBeVisible();

    // RoleUser cannot move — project dropdown must be disabled
    await expect(page.locator('#project-trigger')).toBeDisabled();

    await page.click('#done-btn');
  });
});
