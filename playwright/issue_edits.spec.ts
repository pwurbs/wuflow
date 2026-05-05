import { test, expect } from './fixtures';
import { createIssue, openIssueByTitle, selectPriority } from './helpers/test-utils';

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

    // Wait for the PUT request (save) and GET request (refresh)
    const savePromise = Promise.all([
      page.waitForResponse(resp => resp.url().includes('/api/issues/') && resp.request().method() === 'PUT'),
      page.waitForResponse(resp => resp.url().includes('/issues/active') && resp.request().method() === 'GET')
    ]);

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

    // Wait for save and refresh
    const savePromise = Promise.all([
      page.waitForResponse(resp => resp.url().includes('/api/issues/') && resp.request().method() === 'PUT'),
      page.waitForResponse(resp => resp.url().includes('/issues/active') && resp.request().method() === 'GET')
    ]);

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

    // Clear the deadline
    const savePromise = Promise.all([
      page.waitForResponse(resp => resp.url().includes('/api/issues/') && resp.request().method() === 'PUT'),
      page.waitForResponse(resp => resp.url().includes('/issues/active') && resp.request().method() === 'GET')
    ]);

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
