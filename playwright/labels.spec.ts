import { test, expect } from './fixtures';
import { createIssue, navigateTo, waitForToast } from './helpers/test-utils';

test.describe('Label Management', () => {
  test.beforeEach(async ({ page, login }) => {
    await login();
  });

  test('navigate to Project Settings view', async ({ page }) => {
    await navigateTo(page, 'project-settings');

    // Project Settings view should be visible
    await expect(page.locator('#project-settings-view')).toBeVisible();

    // Board should be hidden
    await expect(page.locator('.board')).toBeHidden();

    // Label management section should be attached to the DOM. An empty list
    // has zero dimensions and would fail toBeVisible() — toBeAttached() is the
    // right assertion for "the labels grid container exists and is rendered".
    await expect(page.locator('#ps-labels-list')).toBeAttached();
  });

  test('create a new label', async ({ page }) => {
    await navigateTo(page, 'project-settings');

    // Enter label name
    await page.fill('#ps-new-label-input', 'TestLabel');
    await page.press('#ps-new-label-input', 'Enter');

    // Verify label appears in the list
    await expect(page.locator('#ps-labels-list')).toContainText('TestLabel');
  });

  test('label input has max length of 15 characters', async ({ page }) => {
    await navigateTo(page, 'project-settings');

    // Try to enter more than 15 characters
    const longText = 'ThisIsAVeryLongLabelName';
    await page.fill('#ps-new-label-input', longText);

    // Verify only 15 characters are entered
    const inputValue = await page.locator('#ps-new-label-input').inputValue();
    expect(inputValue.length).toBeLessThanOrEqual(15);
  });

  test('assign label to an issue', async ({ page }) => {
    // First create a label
    await navigateTo(page, 'project-settings');
    await page.fill('#ps-new-label-input', 'Priority');
    await page.press('#ps-new-label-input', 'Enter');
    await expect(page.locator('#ps-labels-list')).toContainText('Priority');

    // Go back to board
    await navigateTo(page, 'board');

    // Create an issue and assign the label
    await createIssue(page, { title: 'Labeled Issue', status: 'Todo', label: 'Priority' });

    // Open the issue and verify label is set
    await page.click('.card:has-text("Labeled Issue")');
    await expect(page.locator('#label-text')).toContainText('Priority');
  });

  test('delete a label', async ({ page }) => {
    // Create a label first
    await navigateTo(page, 'project-settings');
    await page.fill('#ps-new-label-input', 'ToDelete');
    await page.press('#ps-new-label-input', 'Enter');
    await expect(page.locator('#ps-labels-list')).toContainText('ToDelete');

    // Find and click the delete button for this label
    const labelItem = page.locator('#ps-labels-list .label-item:has-text("ToDelete")');
    await labelItem.locator('.delete-label-btn').click();

    // Confirm deletion if there's a confirmation
    const confirmModal = page.locator('#confirm-modal');
    if (await confirmModal.isVisible()) {
      await page.click('#confirm-ok-btn');
    }

    // Verify label is removed
    await expect(page.locator('#ps-labels-list')).not.toContainText('ToDelete');
  });
});

test.describe('Project-scoped Labels', () => {
  test.beforeEach(async ({ page, login }) => {
    await login();
  });

  test('label created in one project does not appear in another project', async ({ page }) => {
    // Create a second project via setup
    await navigateTo(page, 'system-settings');
    await page.click('#add-project-btn');
    await expect(page.locator('#project-modal-overlay')).toBeVisible();
    const projectName = `proj_${Date.now()}`.slice(0, 15);
    await page.fill('#project-name', projectName);
    await page.click('#project-modal-save');
    await expect(page.locator('#project-modal-overlay')).toBeHidden();

    // Switch to default project (project 1) via project selector and create a label
    await navigateTo(page, 'project-settings');
    await page.click('#project-selector-btn');
    await page.click('#project-selector-options .custom-option:has-text("default")');
    const labelName = `ScopedLabel${Date.now().toString().slice(-4)}`;
    await page.fill('#ps-new-label-input', labelName);
    await page.press('#ps-new-label-input', 'Enter');
    await expect(page.locator('#ps-labels-list')).toContainText(labelName);

    // Switch to the new project — the label must NOT appear there
    await page.click('#project-selector-btn');
    await page.click(`#project-selector-options .custom-option:has-text("${projectName}")`);
    await expect(page.locator('#ps-labels-list')).not.toContainText(labelName);
  });

  test('issue modal label dropdown refreshes when project is changed', async ({ page }) => {
    // Create a second project
    await navigateTo(page, 'system-settings');
    await page.click('#add-project-btn');
    await expect(page.locator('#project-modal-overlay')).toBeVisible();
    const projectName = `projB_${Date.now()}`.slice(0, 15);
    await page.fill('#project-name', projectName);
    await page.click('#project-modal-save');
    await expect(page.locator('#project-modal-overlay')).toBeHidden();

    // Create a label in the default project
    await navigateTo(page, 'project-settings');
    await page.click('#project-selector-btn');
    await page.click('#project-selector-options .custom-option:has-text("default")');
    const labelName = `LblRefresh${Date.now().toString().slice(-4)}`;
    await page.fill('#ps-new-label-input', labelName);
    await page.press('#ps-new-label-input', 'Enter');
    await expect(page.locator('#ps-labels-list')).toContainText(labelName);

    // Open a new-issue modal
    await navigateTo(page, 'board');
    await page.click('#add-issue-btn');
    await expect(page.locator('#issue-modal')).toBeVisible();

    // The label should be visible in the label dropdown for the default project
    await page.click('#label-trigger');
    await expect(page.locator('#label-options')).toContainText(labelName);
    // Close label dropdown by clicking the trigger again
    await page.click('#label-trigger');
    await expect(page.locator('#label-options')).toBeHidden();

    // Change to the other project
    await page.click('#project-trigger');
    await page.click(`#project-options .custom-option:has-text("${projectName}")`);

    // After project change the label from the default project must not appear
    await page.click('#label-trigger');
    await expect(page.locator('#label-options')).not.toContainText(labelName);

    await page.click('#cancel-btn');
  });

  test('project settings label list refreshes when project selector changes', async ({ page }) => {
    // Create a second project
    await navigateTo(page, 'system-settings');
    await page.click('#add-project-btn');
    await expect(page.locator('#project-modal-overlay')).toBeVisible();
    const projectName = `projC_${Date.now()}`.slice(0, 15);
    await page.fill('#project-name', projectName);
    await page.click('#project-modal-save');
    await expect(page.locator('#project-modal-overlay')).toBeHidden();

    // Create a label in default project
    await navigateTo(page, 'project-settings');
    await page.click('#project-selector-btn');
    await page.click('#project-selector-options .custom-option:has-text("default")');
    const labelName = `LblRefresh2${Date.now().toString().slice(-3)}`;
    await page.fill('#ps-new-label-input', labelName);
    await page.press('#ps-new-label-input', 'Enter');
    await waitForToast(page, 'Label created');

    // Switch to new project — label should not be shown
    await page.click('#project-selector-btn');
    await page.click(`#project-selector-options .custom-option:has-text("${projectName}")`);
    await expect(page.locator('#ps-labels-list')).not.toContainText(labelName);

    // Switch back to default — label reappears
    await page.click('#project-selector-btn');
    await page.click('#project-selector-options .custom-option:has-text("default")');
    await expect(page.locator('#ps-labels-list')).toContainText(labelName);
  });

  test('user role cannot see Project Settings nav button', async ({ page }) => {
    // Already logged in as admin via beforeEach — navigate to setup to create a regular user
    await navigateTo(page, 'system-settings');
    await page.click('#add-user-btn');
    const userEmail = `user_navtest_${Date.now()}@example.com`;
    const userPassword = `NavTest1!${Date.now()}`; // ≥12 chars, meets policy
    await page.fill('#user-email', userEmail);
    await page.fill('#user-first-name', 'Nav');
    await page.fill('#user-last-name', 'Test');
    await page.fill('#user-password', userPassword);
    await page.click('#user-modal-save');
    await expect(page.locator('#user-modal-overlay')).toBeHidden();

    // Logout and log back in as the regular user
    await page.click('#user-menu-btn');
    await page.click('#user-menu-logout');
    await expect(page).toHaveURL(/\/login/);
    await page.fill('#login-email', userEmail);
    await page.fill('#login-password', userPassword);
    await page.click('#login-btn');
    await expect(page.locator('#nav-board')).toBeVisible();

    // Regular user must not see the Project Settings nav button
    await expect(page.locator('#nav-project-settings')).toBeHidden();
  });
});
