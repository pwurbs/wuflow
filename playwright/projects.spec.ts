import { test, expect } from './fixtures';
import {
  navigateTo,
  createIssue,
  createProjectViaAPI,
  createIssueViaAPI,
  createReleaseViaAPI,
  createLabelViaAPI,
} from './helpers/test-utils';

test.describe('Project Management', () => {
  test.beforeEach(async ({ page, login }) => {
    await login();
    await navigateTo(page, 'system-settings');
  });

  test('Project Management section is visible in System Settings', async ({ page }) => {
    await expect(page.locator('#project-management-section')).toBeVisible();
    await expect(page.locator('#project-management-section h2:has-text("Project Management")')).toBeVisible();
    await expect(page.locator('#add-project-btn')).toBeVisible();
  });

  test('Default project is listed with a default badge', async ({ page }) => {
    const defaultRow = page.locator('#projects-list .settings-entry:has-text("default")');
    await expect(defaultRow).toBeVisible();
    await expect(defaultRow.locator('.settings-entry-badge')).toContainText('default');
  });

  test('Create a new project', async ({ page }) => {
    await page.click('#add-project-btn');
    await expect(page.locator('#project-modal-overlay')).toBeVisible();
    await expect(page.locator('#project-modal-title')).toHaveText('New Project');

    const projectName = `proj_${Date.now()}`.slice(0, 15);
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
    const originalName = `edit_${Date.now()}`.slice(0, 15);
    await page.fill('#project-name', originalName);
    await page.fill('#project-description', 'Original description');
    await page.click('#project-modal-save');
    await expect(page.locator('#project-modal-overlay')).toBeHidden();
    await expect(page.locator('#projects-list')).toContainText(originalName);

    // Edit the project
    const projectRow = page.locator(`#projects-list .settings-entry:has-text("${originalName}")`);
    await projectRow.click();
    await expect(page.locator('#project-modal-overlay')).toBeVisible();
    await expect(page.locator('#project-modal-title')).toHaveText('Edit Project');
    await expect(page.locator('#project-name')).toHaveValue(originalName);

    await page.fill('#project-description', 'Updated description');
    await page.click('#project-modal-save');

    await expect(page.locator('#project-modal-overlay')).toBeHidden();
    await expect(page.locator('#projects-list')).toContainText('Updated description');
  });

  test('Delete a project', async ({ page, workerServer }) => {
    // Create a project to delete
    await page.click('#add-project-btn');
    const name = `del_${Date.now()}`.slice(0, 15);
    await page.fill('#project-name', name);
    await page.click('#project-modal-save');
    await expect(page.locator('#project-modal-overlay')).toBeHidden();
    await expect(page.locator('#projects-list')).toContainText(name);

    // Open edit and delete
    const projectRow = page.locator(`#projects-list .settings-entry:has-text("${name}")`);
    await projectRow.click();
    await expect(page.locator('#project-modal-delete')).toBeVisible();
    await page.click('#project-modal-delete');

    // Deletion requires admin password confirmation
    await expect(page.locator('#admin-confirm-modal')).toBeVisible();
    await page.fill('#admin-confirm-password', workerServer.adminPassword);
    await page.click('#admin-confirm-ok-btn');

    await expect(page.locator('#projects-list')).not.toContainText(name);
  });

  test('Deleting a project is rejected with the wrong admin password', async ({ page, workerServer }) => {
    // Create a project to attempt to delete
    await page.click('#add-project-btn');
    const name = `delfail_${Date.now()}`.slice(0, 15);
    await page.fill('#project-name', name);
    await page.click('#project-modal-save');
    await expect(page.locator('#project-modal-overlay')).toBeHidden();
    await expect(page.locator('#projects-list')).toContainText(name);

    const projectRow = page.locator(`#projects-list .settings-entry:has-text("${name}")`);
    await projectRow.click();
    await page.click('#project-modal-delete');

    await expect(page.locator('#admin-confirm-modal')).toBeVisible();
    await page.fill('#admin-confirm-password', 'WrongAdminPass123!');
    await page.click('#admin-confirm-ok-btn');

    // Rejected — the dialog stays open with the error shown inline, ready for retry
    await expect(page.locator('#admin-confirm-modal')).toBeVisible();
    await expect(page.locator('#admin-confirm-error')).toBeVisible();
    await expect(page.locator('#projects-list')).toContainText(name);

    // Retry with the correct password in the same dialog — no need to reopen it
    await page.fill('#admin-confirm-password', workerServer.adminPassword);
    await page.click('#admin-confirm-ok-btn');
    await expect(page.locator('#admin-confirm-modal')).toBeHidden();
    await expect(page.locator('#projects-list')).not.toContainText(name);
  });

  test('Deleting a project with issues shows a blocking error and skips the password dialog', async ({ page }) => {
    const name = `hasissues_${Date.now()}`.slice(0, 15);
    const projectId = await createProjectViaAPI(page.request, name);
    await createIssueViaAPI(page.request, projectId, `Blocker_${Date.now()}`);

    // The project list was fetched on entry to this view, before the API calls above —
    // leave and re-enter system-settings to force a refetch that picks them up.
    await navigateTo(page, 'board');
    await navigateTo(page, 'system-settings');
    const projectRow = page.locator(`#projects-list .settings-entry:has-text("${name}")`);
    await projectRow.click();
    await page.click('#project-modal-delete');

    // The precheck finds the issue and blocks deletion without ever showing the password dialog
    await expect(page.locator('#admin-confirm-modal')).toBeHidden();
    const errorDisplay = page.locator('#project-modal-error');
    await expect(errorDisplay).toBeVisible();
    await expect(errorDisplay).toContainText('still has 1 issue');
    await expect(page.locator('#projects-list')).toContainText(name);

    await page.click('#project-modal-cancel');
  });

  test('Default project cannot be deleted', async ({ page }) => {
    const defaultRow = page.locator('#projects-list .settings-entry:has-text("default")');
    await defaultRow.click();
    await expect(page.locator('#project-modal-overlay')).toBeVisible();

    // Delete button must be hidden for the default project
    await expect(page.locator('#project-modal-delete')).toBeHidden();

    await page.click('#project-modal-cancel');
  });

  test('Duplicate project name shows an error', async ({ page, workerServer }) => {
    // Create first project
    await page.click('#add-project-btn');
    const name = `dup_${Date.now()}`.slice(0, 15);
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
    const projectRow = page.locator(`#projects-list .settings-entry:has-text("${name}")`);
    await projectRow.click();
    await page.click('#project-modal-delete');
    await expect(page.locator('#admin-confirm-modal')).toBeVisible();
    await page.fill('#admin-confirm-password', workerServer.adminPassword);
    await page.click('#admin-confirm-ok-btn');
  });
});

test.describe('Project Selector', () => {
  test.beforeEach(async ({ page, login }) => {
    await login();
  });

  test('Project selector is visible on the board', async ({ page }) => {
    await navigateTo(page, 'board');
    await expect(page.locator('#project-selector-container')).toBeVisible();
  });

  test('Project selector is visible on the backlog', async ({ page }) => {
    await navigateTo(page, 'backlog');
    await expect(page.locator('#project-selector-container')).toBeVisible();
  });

  test('Project selector is hidden in the system settings view', async ({ page }) => {
    await navigateTo(page, 'system-settings');
    await expect(page.locator('#project-selector-container')).toBeHidden();
  });

  test('Project selector shows the current project name', async ({ page }) => {
    await navigateTo(page, 'board');
    const selectorText = page.locator('#project-selector-text');
    await expect(selectorText).not.toBeEmpty();
  });

  test('Newly created project appears in the project selector', async ({ page, workerServer }) => {
    // Create a project
    await navigateTo(page, 'system-settings');
    await page.click('#add-project-btn');
    const name = `sel_${Date.now()}`.slice(0, 15);
    await page.fill('#project-name', name);
    await page.click('#project-modal-save');
    await expect(page.locator('#project-modal-overlay')).toBeHidden();

    // Go to board and open the selector
    await navigateTo(page, 'board');
    await page.click('#project-selector-btn');
    await expect(page.locator('#project-selector-options')).toContainText(name);

    // Cleanup
    await navigateTo(page, 'system-settings');
    const projectRow = page.locator(`#projects-list .settings-entry:has-text("${name}")`);
    await projectRow.click();
    await page.click('#project-modal-delete');
    await expect(page.locator('#admin-confirm-modal')).toBeVisible();
    await page.fill('#admin-confirm-password', workerServer.adminPassword);
    await page.click('#admin-confirm-ok-btn');
  });

  test('Selecting a project updates the selector label', async ({ page, workerServer }) => {
    // Create a second project to switch to
    await navigateTo(page, 'system-settings');
    await page.click('#add-project-btn');
    const name = `switch_${Date.now()}`.slice(0, 12);
    await page.fill('#project-name', name);
    await page.click('#project-modal-save');
    await expect(page.locator('#project-modal-overlay')).toBeHidden();

    // Switch to it from the board
    await navigateTo(page, 'board');
    await page.click('#project-selector-btn');
    await page.locator(`#project-selector-options .custom-option:has-text("${name}")`).click();
    await expect(page.locator('#project-selector-text')).toHaveText(name);

    // Cleanup
    await navigateTo(page, 'system-settings');
    const projectRow = page.locator(`#projects-list .settings-entry:has-text("${name}")`);
    await projectRow.click();
    await page.click('#project-modal-delete');
    await expect(page.locator('#admin-confirm-modal')).toBeVisible();
    await page.fill('#admin-confirm-password', workerServer.adminPassword);
    await page.click('#admin-confirm-ok-btn');
  });
});

test.describe('Issues with Projects', () => {
  test.beforeEach(async ({ page, login }) => {
    await login();
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

  test('Issues from another project are not shown when a different project is selected', async ({ page, workerServer }) => {
    // Create a second project
    await navigateTo(page, 'system-settings');
    await page.click('#add-project-btn');
    const projectName = `isol_${Date.now()}`.slice(0, 15);
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
    await navigateTo(page, 'system-settings');
    const projectRow = page.locator(`#projects-list .settings-entry:has-text("${projectName}")`);
    await projectRow.click();
    await page.click('#project-modal-delete');
    await expect(page.locator('#admin-confirm-modal')).toBeVisible();
    await page.fill('#admin-confirm-password', workerServer.adminPassword);
    await page.click('#admin-confirm-ok-btn');
  });
});

// ---------------------------------------------------------------------------
// API-level cross-project isolation
//
// The UI tests above prove users don't *see* leakage. These tests prove the
// back door is also closed: an authenticated admin who hand-crafts a request
// against the wrong project URL must be rejected. The defence lives in the
// SQL WHERE clauses of GetIssueByIDInProject / GetReleaseByIDInProject /
// DeleteLabel — these tests exercise it end-to-end.
// ---------------------------------------------------------------------------

test.describe('Project-scoped API isolation', () => {
  // Shared fixture: an admin session with a "default" project (id=1) and a
  // separate `pOther` project. One resource of each kind is created in
  // project 1; every test attempts to access it via the pOther URL.
  let pOther: number;
  let issueId: number;
  let releaseId: number;
  let labelId: number;

  test.beforeEach(async ({ page, login }) => {
    await login();
    const ctx = page.request;
    pOther = await createProjectViaAPI(ctx, `iso_${Date.now().toString().slice(-6)}`);
    issueId = await createIssueViaAPI(ctx, 1, `IsoIssue_${Date.now()}`);
    releaseId = await createReleaseViaAPI(ctx, 1, `IsoRel_${Date.now().toString().slice(-6)}`);
    labelId = await createLabelViaAPI(ctx, 1, `IsoLbl${Date.now().toString().slice(-4)}`);
  });

  // --- Issue boundary ------------------------------------------------------

  test('GET issue via wrong project URL returns 404', async ({ page }) => {
    const res = await page.request.get(`/api/projects/${pOther}/issues/${issueId}`);
    expect(res.status()).toBe(404);
  });

  test('PUT issue via wrong project URL returns 404', async ({ page }) => {
    const res = await page.request.put(`/api/projects/${pOther}/issues/${issueId}`, {
      data: { title: 'hacked', status: 'Open', priority: 'Normal' },
    });
    expect(res.status()).toBe(404);
  });

  test('DELETE issue via wrong project URL returns 404', async ({ page }) => {
    const res = await page.request.delete(`/api/projects/${pOther}/issues/${issueId}`);
    expect(res.status()).toBe(404);
  });

  test('POST issue archive via wrong project URL returns 404', async ({ page }) => {
    const res = await page.request.post(`/api/projects/${pOther}/issues/${issueId}/archive`, {
      headers: { 'Content-Type': 'application/json' },
      data: {},
    });
    expect(res.status()).toBe(404);
  });

  test('POST issue unarchive via wrong project URL returns 404', async ({ page }) => {
    // Archive in the correct project first so unarchive is a valid operation.
    const arch = await page.request.post(`/api/projects/1/issues/${issueId}/archive`, {
      headers: { 'Content-Type': 'application/json' }, data: {},
    });
    expect(arch.status()).toBe(200);

    const res = await page.request.post(`/api/projects/${pOther}/issues/${issueId}/unarchive`, {
      headers: { 'Content-Type': 'application/json' }, data: {},
    });
    expect(res.status()).toBe(404);
  });

  // --- Release boundary ----------------------------------------------------

  test('GET release via wrong project URL returns 404', async ({ page }) => {
    const res = await page.request.get(`/api/projects/${pOther}/releases/${releaseId}`);
    expect(res.status()).toBe(404);
  });

  test('PUT release via wrong project URL returns 404', async ({ page }) => {
    const res = await page.request.put(`/api/projects/${pOther}/releases/${releaseId}`, {
      data: { name: 'hacked', description: '' },
    });
    expect(res.status()).toBe(404);
  });

  test('DELETE release via wrong project URL returns 404', async ({ page }) => {
    const res = await page.request.delete(`/api/projects/${pOther}/releases/${releaseId}`);
    expect(res.status()).toBe(404);
  });

  test('POST release (trigger) via wrong project URL returns 404', async ({ page }) => {
    const res = await page.request.post(`/api/projects/${pOther}/releases/${releaseId}/release`, {
      headers: { 'Content-Type': 'application/json' },
      data: { archive_done: false },
    });
    expect(res.status()).toBe(404);
  });

  test('POST release reopen via wrong project URL returns 404', async ({ page }) => {
    // Close the release in the correct project so reopen is a valid operation.
    const close = await page.request.post(`/api/projects/1/releases/${releaseId}/release`, {
      headers: { 'Content-Type': 'application/json' },
      data: { archive_done: false },
    });
    expect(close.status()).toBe(200);

    const res = await page.request.post(`/api/projects/${pOther}/releases/${releaseId}/reopen`, {
      headers: { 'Content-Type': 'application/json' }, data: {},
    });
    expect(res.status()).toBe(404);
  });

  // --- Label boundary ------------------------------------------------------

  test('DELETE label via wrong project URL returns 404', async ({ page, workerServer }) => {
    const res = await page.request.delete(`/api/projects/${pOther}/labels/${labelId}`, {
      data: { admin_password: workerServer.adminPassword },
    });
    expect(res.status()).toBe(404);
  });

  // --- URL-pins-project invariant -----------------------------------------

  test('POST create issue: URL project_id wins over body project_id', async ({ page }) => {
    const res = await page.request.post(`/api/projects/1/issues`, {
      data: { title: `BodyOverride_${Date.now()}`, status: 'Open', priority: 'Normal', project_id: pOther },
    });
    expect(res.status()).toBe(201);
    const issue = await res.json();
    expect(issue.project_id).toBe(1);
  });

  test('PUT update issue: URL project_id wins over body project_id', async ({ page }) => {
    const res = await page.request.put(`/api/projects/1/issues/${issueId}`, {
      data: { title: 'still-in-1', status: 'Open', priority: 'Normal', project_id: pOther },
    });
    expect(res.status()).toBe(200);

    // Re-fetch via the original (correct) project URL — must still be there.
    const check = await page.request.get(`/api/projects/1/issues/${issueId}`);
    expect(check.status()).toBe(200);
    const issue = await check.json();
    expect(issue.project_id).toBe(1);
  });
});
