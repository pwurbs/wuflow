import { test, expect } from './fixtures';
import { createIssue } from './helpers/test-utils';

// Helper: navigate to project settings and ensure the correct project is selected.
// Waits for the GET /statusconfig response that renderStatusConfigSection triggers after
// selecting the project, guaranteeing the form is fully re-rendered before returning.
async function goToProjectSettings(page: Parameters<typeof createIssue>[0], projectName = 'default') {
  await page.click('#nav-project-settings');
  await expect(page.locator('#project-settings-view')).toBeVisible();
  await page.click('#project-selector-btn');
  const configLoaded = page.waitForResponse(r =>
    r.url().includes('/statusconfig') && r.request().method() === 'GET'
  );
  await page.click(`#project-selector-options .custom-option:has-text("${projectName}")`);
  await configLoaded;
  await expect(page.locator('.sc-name-input[name="stage1_name"]')).toBeVisible();
}

// Helper: navigate to the board and wait for the app to fully reload
async function goToBoard(page: Parameters<typeof createIssue>[0]) {
  const issuesLoaded = page.waitForResponse(r =>
    r.url().includes('/issues/active') && r.request().method() === 'GET'
  );
  await page.click('#nav-board');
  await issuesLoaded;
}

// Helper: save the status config, wait for the PUT to complete, then toast
async function saveStatusConfig(page: Parameters<typeof createIssue>[0]) {
  const saved = page.waitForResponse(r =>
    r.url().includes('/statusconfig') && r.request().method() === 'PUT'
  );
  await page.click('#ps-save-status-config-btn');
  await saved;
  await expect(page.locator('#notification-toast')).toContainText('saved');
}

// Helper: set a column name input and clear it if name is empty string
async function setColumnName(page: Parameters<typeof createIssue>[0], field: string, name: string) {
  const input = page.locator(`.sc-name-input[name="${field}"]`);
  await input.fill(name);
}

test.describe('Board Columns Configuration', () => {
  test.beforeEach(async ({ login }) => {
    await login();
  });

  test('rename Stage1 updates board column header and data-status', async ({ page }) => {
    await goToProjectSettings(page);
    await setColumnName(page, 'stage1_name', 'Review');
    await saveStatusConfig(page);

    // Board should now show "Review" column with Stage1 status key
    await goToBoard(page);
    const col = page.locator('.column[data-status="Stage1"]');
    await expect(col).toBeVisible();
    await expect(col.locator('.column-header h2')).toHaveText('Review');

    // Old display name "Pending" column should be gone
    await expect(page.locator('.column-header h2:has-text("Pending")')).toHaveCount(0);

    // Restore
    await goToProjectSettings(page);
    await setColumnName(page, 'stage1_name', 'Pending');
    await saveStatusConfig(page);
  });

  test('activating Stage3 adds a fifth column to the board', async ({ page }) => {
    await goToProjectSettings(page);
    await setColumnName(page, 'stage3_name', 'Review');
    await saveStatusConfig(page);

    // Board should now have 5 columns: To-do, Pending, Working, Review, Done
    await goToBoard(page);
    await expect(page.locator('.column[data-status="Stage3"]')).toBeVisible();
    await expect(page.locator('.column[data-status="Stage3"] .column-header h2')).toHaveText('Review');
    await expect(page.locator('.column')).toHaveCount(5);

    // Deactivate Stage3 again
    await goToProjectSettings(page);
    await setColumnName(page, 'stage3_name', '');
    await saveStatusConfig(page);

    await goToBoard(page);
    await expect(page.locator('.column[data-status="Stage3"]')).toHaveCount(0);
    await expect(page.locator('.column')).toHaveCount(4);
  });

  test('deactivating Stage1 hides the column but issues are not deleted', async ({ page }) => {
    // Create an issue in Stage1 (Pending)
    await createIssue(page, { title: 'HiddenIssue', status: 'Pending' });
    await expect(page.locator('.column[data-status="Stage1"] .board-card:has-text("HiddenIssue")')).toBeVisible();

    // Deactivate Stage1
    await goToProjectSettings(page);
    await setColumnName(page, 'stage1_name', '');

    // Confirm the deactivation warning (issues exist)
    await page.click('#ps-save-status-config-btn');
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await page.click('#confirm-ok-btn');
    await expect(page.locator('#notification-toast')).toContainText('saved');

    // Column no longer visible on board
    await goToBoard(page);
    await expect(page.locator('.column[data-status="Stage1"]')).toHaveCount(0);

    // Re-activate Stage1 — issue reappears
    await goToProjectSettings(page);
    await setColumnName(page, 'stage1_name', 'Pending');
    await saveStatusConfig(page);

    await goToBoard(page);
    await expect(page.locator('.column[data-status="Stage1"] .board-card:has-text("HiddenIssue")')).toBeVisible();
  });

  test('issue modal status dropdown reflects configured column names', async ({ page }) => {
    // Rename Stage1 to "Review"
    await goToProjectSettings(page);
    await setColumnName(page, 'stage1_name', 'Review');
    await saveStatusConfig(page);

    // Open a new issue modal and check the status dropdown
    await goToBoard(page);
    await page.click('#add-issue-btn');
    await expect(page.locator('#issue-modal')).toBeVisible();

    await page.click('#status-trigger');
    const options = page.locator('#status-options .custom-option');
    const texts = await options.allTextContents();

    expect(texts).toContain('Review');
    expect(texts).not.toContain('Pending');

    await page.click('#cancel-btn');

    // Restore
    await goToProjectSettings(page);
    await setColumnName(page, 'stage1_name', 'Pending');
    await saveStatusConfig(page);
  });

  test('column config changes in one project do not affect other projects', async ({ page }) => {
    // Create a second project
    await page.click('#nav-system-settings');
    await page.click('#add-project-btn');
    await expect(page.locator('#project-modal-overlay')).toBeVisible();
    const projectB = `projB_${Date.now()}`.slice(0, 15);
    await page.fill('#project-name', projectB);
    await page.click('#project-modal-save');
    await expect(page.locator('#project-modal-overlay')).toBeHidden();

    // Rename Stage1 to "Review" in the default project
    await goToProjectSettings(page, 'default');
    await setColumnName(page, 'stage1_name', 'Review');
    await saveStatusConfig(page);

    // Switch to project B — Stage1 should still be "Pending" (default)
    await page.click('#project-selector-btn');
    await page.click(`#project-selector-options .custom-option:has-text("${projectB}")`);
    await expect(page.locator('#ps-status-config-content')).toBeVisible();
    const stage1InputB = page.locator('.sc-name-input[name="stage1_name"]');
    await expect(stage1InputB).toHaveValue('Pending');

    // Switch to board for project B — column shows "Pending", not "Review"
    await goToBoard(page);
    await expect(page.locator('.column[data-status="Stage1"] .column-header h2')).toHaveText('Pending');

    // Switch to default project board — column shows "Review"
    await page.click('#project-selector-btn');
    await page.click('#project-selector-options .custom-option:has-text("default")');
    await expect(page.locator('.column[data-status="Stage1"] .column-header h2')).toHaveText('Review');

    // Restore default project
    await goToProjectSettings(page, 'default');
    await setColumnName(page, 'stage1_name', 'Pending');
    await saveStatusConfig(page);
  });
});
