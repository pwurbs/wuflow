import { test, expect } from '@playwright/test';
import { navigateTo, login, createIssue } from './helpers/test-utils';

test.describe('Project Management', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await navigateTo(page, 'setup');
  });

  test('Project Management section is visible in Setup', async ({ page }) => {
    await expect(page.locator('#project-management-section')).toBeVisible();
    await expect(page.locator('#project-management-section h2:has-text("Project Management")')).toBeVisible();
    await expect(page.locator('#add-project-btn')).toBeVisible();
  });

  test('Default project is listed with a default badge', async ({ page }) => {
    const defaultRow = page.locator('#projects-list .user-row:has-text("default")');
    await expect(defaultRow).toBeVisible();
    await expect(defaultRow.locator('.user-role-badge')).toContainText('default');
  });

  test('Create a new project', async ({ page }) => {
    await page.click('#add-project-btn');
    await expect(page.locator('#project-modal-overlay')).toBeVisible();
    await expect(page.locator('#project-modal-title')).toHaveText('New Project');

    const projectName = `Proj_${Date.now()}`.slice(0, 15);
    await page.fill('#project-name', projectName);
    await page.fill('#project-description', 'A test project description');
    await page.click('#project-modal-save');

    await expect(page.locator('#project-modal-overlay')).toBeHidden();
    await expect(page.locator('#projects-list')).toContainText(projectName);
  });

  test('Project name has a max length of 15 characters', async ({ page }) => {
    await page.click('#add-project-btn');
    await expect(page.locator('#project-modal-overlay')).toBeVisible();

    const maxLength = await page.locator('#project-name').getAttribute('maxlength');
    expect(maxLength).toBe('15');

    await page.fill('#project-name', 'ThisNameIsTooLong');
    const value = await page.locator('#project-name').inputValue();
    expect(value.length).toBeLessThanOrEqual(15);

    await page.click('#project-modal-cancel');
  });

  test('Edit a project name and description', async ({ page }) => {
    // First create a project to edit
    await page.click('#add-project-btn');
    const originalName = `Edit_${Date.now()}`.slice(0, 15);
    await page.fill('#project-name', originalName);
    await page.fill('#project-description', 'Original description');
    await page.click('#project-modal-save');
    await expect(page.locator('#project-modal-overlay')).toBeHidden();
    await expect(page.locator('#projects-list')).toContainText(originalName);

    // Edit the project
    const projectRow = page.locator(`#projects-list .user-row:has-text("${originalName}")`);
    await projectRow.locator('.project-edit-btn').click();
    await expect(page.locator('#project-modal-overlay')).toBeVisible();
    await expect(page.locator('#project-modal-title')).toHaveText('Edit Project');
    await expect(page.locator('#project-name')).toHaveValue(originalName);

    await page.fill('#project-description', 'Updated description');
    await page.click('#project-modal-save');

    await expect(page.locator('#project-modal-overlay')).toBeHidden();
    await expect(page.locator('#projects-list')).toContainText('Updated description');
  });

  test('Delete a project', async ({ page }) => {
    // Create a project to delete
    await page.click('#add-project-btn');
    const name = `Del_${Date.now()}`.slice(0, 15);
    await page.fill('#project-name', name);
    await page.click('#project-modal-save');
    await expect(page.locator('#project-modal-overlay')).toBeHidden();
    await expect(page.locator('#projects-list')).toContainText(name);

    // Open edit and delete
    const projectRow = page.locator(`#projects-list .user-row:has-text("${name}")`);
    await projectRow.locator('.project-edit-btn').click();
    await expect(page.locator('#project-modal-delete')).toBeVisible();
    await page.click('#project-modal-delete');

    // Confirm deletion
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await page.click('#confirm-ok-btn');

    await expect(page.locator('#projects-list')).not.toContainText(name);
  });

  test('Default project cannot be deleted', async ({ page }) => {
    const defaultRow = page.locator('#projects-list .user-row:has-text("default")');
    await defaultRow.locator('.project-edit-btn').click();
    await expect(page.locator('#project-modal-overlay')).toBeVisible();

    // Delete button must be hidden for the default project
    await expect(page.locator('#project-modal-delete')).toBeHidden();

    await page.click('#project-modal-cancel');
  });

  test('Duplicate project name shows an error', async ({ page }) => {
    // Create first project
    await page.click('#add-project-btn');
    const name = `Dup_${Date.now()}`.slice(0, 15);
    await page.fill('#project-name', name);
    await page.click('#project-modal-save');
    await expect(page.locator('#project-modal-overlay')).toBeHidden();

    // Try to create another with the same name
    await page.click('#add-project-btn');
    await page.fill('#project-name', name);
    await page.click('#project-modal-save');

    await expect(page.locator('#project-modal-error')).toBeVisible();
    await expect(page.locator('#project-modal-error')).not.toBeEmpty();

    await page.click('#project-modal-cancel');

    // Cleanup
    const projectRow = page.locator(`#projects-list .user-row:has-text("${name}")`);
    await projectRow.locator('.project-edit-btn').click();
    await page.click('#project-modal-delete');
    await page.click('#confirm-ok-btn');
  });
});

test.describe('Project Selector', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Project selector is visible on the board', async ({ page }) => {
    await navigateTo(page, 'board');
    await expect(page.locator('#project-selector-container')).toBeVisible();
  });

  test('Project selector is visible on the backlog', async ({ page }) => {
    await navigateTo(page, 'backlog');
    await expect(page.locator('#project-selector-container')).toBeVisible();
  });

  test('Project selector is hidden in the setup view', async ({ page }) => {
    await navigateTo(page, 'setup');
    await expect(page.locator('#project-selector-container')).toBeHidden();
  });

  test('Project selector shows the current project name', async ({ page }) => {
    await navigateTo(page, 'board');
    const selectorText = page.locator('#project-selector-text');
    await expect(selectorText).not.toBeEmpty();
  });

  test('Newly created project appears in the project selector', async ({ page }) => {
    // Create a project
    await navigateTo(page, 'setup');
    await page.click('#add-project-btn');
    const name = `Sel_${Date.now()}`.slice(0, 15);
    await page.fill('#project-name', name);
    await page.click('#project-modal-save');
    await expect(page.locator('#project-modal-overlay')).toBeHidden();

    // Go to board and open the selector
    await navigateTo(page, 'board');
    await page.click('#project-selector-btn');
    await expect(page.locator('#project-selector-options')).toContainText(name);

    // Cleanup
    await navigateTo(page, 'setup');
    const projectRow = page.locator(`#projects-list .user-row:has-text("${name}")`);
    await projectRow.locator('.project-edit-btn').click();
    await page.click('#project-modal-delete');
    await page.click('#confirm-ok-btn');
  });

  test('Selecting a project updates the selector label', async ({ page }) => {
    // Create a second project to switch to
    await navigateTo(page, 'setup');
    await page.click('#add-project-btn');
    const name = `Switch_${Date.now()}`.slice(0, 12);
    await page.fill('#project-name', name);
    await page.click('#project-modal-save');
    await expect(page.locator('#project-modal-overlay')).toBeHidden();

    // Switch to it from the board
    await navigateTo(page, 'board');
    await page.click('#project-selector-btn');
    await page.locator(`#project-selector-options .custom-option:has-text("${name}")`).click();
    await expect(page.locator('#project-selector-text')).toHaveText(name);

    // Cleanup
    await navigateTo(page, 'setup');
    const projectRow = page.locator(`#projects-list .user-row:has-text("${name}")`);
    await projectRow.locator('.project-edit-btn').click();
    await page.click('#project-modal-delete');
    await page.click('#confirm-ok-btn');
  });
});

test.describe('Issues with Projects', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('New issue modal has a project dropdown', async ({ page }) => {
    await navigateTo(page, 'board');
    await page.click('#add-issue-btn');
    await expect(page.locator('#issue-modal')).toBeVisible();
    await expect(page.locator('#project-dropdown')).toBeVisible();
    await page.click('#cancel-btn');
  });

  test('Issue is created under the currently selected project', async ({ page }) => {
    await navigateTo(page, 'board');

    // Note: The selector auto-selects the first available project.
    const selectedProject = await page.locator('#project-selector-text').textContent();

    const issueTitle = `ProjectIssue_${Date.now()}`;
    await createIssue(page, { title: issueTitle, status: 'Todo' });

    // Open the issue and verify the project matches
    await page.click(`.card:has-text("${issueTitle}")`);
    await expect(page.locator('#issue-modal')).toBeVisible();
    await expect(page.locator('#project-text')).toHaveText((selectedProject ?? '').trim());
    await page.click('#done-btn');
  });

  test('Issues from another project are not shown when a different project is selected', async ({ page }) => {
    // Create a second project
    await navigateTo(page, 'setup');
    await page.click('#add-project-btn');
    const projectName = `Isol_${Date.now()}`.slice(0, 15);
    await page.fill('#project-name', projectName);
    await page.click('#project-modal-save');
    await expect(page.locator('#project-modal-overlay')).toBeHidden();

    // Select the default project and create an issue there
    await navigateTo(page, 'board');
    await page.click('#project-selector-btn');
    await page.locator('#project-selector-options .custom-option:has-text("default")').click();
    const defaultIssueTitle = `DefaultIssue_${Date.now()}`;
    await createIssue(page, { title: defaultIssueTitle, status: 'Todo' });

    // Switch to the new project — the default issue should not be visible
    await page.click('#project-selector-btn');
    await page.locator(`#project-selector-options .custom-option:has-text("${projectName}")`).click();
    await expect(page.locator('.board')).toBeVisible();
    await expect(page.locator(`.card:has-text("${defaultIssueTitle}")`)).toHaveCount(0);

    // Cleanup — delete the new project (switch back to default first)
    await navigateTo(page, 'setup');
    const projectRow = page.locator(`#projects-list .user-row:has-text("${projectName}")`);
    await projectRow.locator('.project-edit-btn').click();
    await page.click('#project-modal-delete');
    await page.click('#confirm-ok-btn');
  });
});
