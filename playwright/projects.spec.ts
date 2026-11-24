import { test, expect, type Page } from './fixtures';
import {
  navigateTo,
  createIssue,
  createProjectViaAPI,
  deleteProjectViaAPI,
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

    await deleteProjectViaAPI(page.request, name, workerServer.adminPassword);
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

    await deleteProjectViaAPI(page.request, name, workerServer.adminPassword);
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

    await deleteProjectViaAPI(page.request, name, workerServer.adminPassword);
  });
});

// A refresh that is still running when the project is switched must neither show nor save
// the previous project's labels, releases and columns. A is the previous project, B the new one.
test.describe('Project switch while data is loading', () => {
  let a: { id: number; name: string };
  let b: { id: number; name: string };
  let releaseA: number;

  const CONFIG_A = { stage1_name: 'A-One', stage2_name: '', stage3_name: 'A-Three', stage4_name: '' };
  const CONFIG_B = { stage1_name: 'B-One', stage2_name: 'B-Two', stage3_name: '', stage4_name: '' };
  const COLUMNS_B = ['Todo', 'B-One', 'B-Two', 'Done'];

  test.beforeEach(async ({ page, login }) => {
    await login();
    const stamp = `${Date.now()}`.slice(-8);
    const create = async (prefix: string, config: typeof CONFIG_A) => {
      const name = `${prefix}${stamp}`;
      const id = await createProjectViaAPI(page.request, name);
      await createLabelViaAPI(page.request, id, `label-${prefix}`);
      const release = await createReleaseViaAPI(page.request, id, `release-${prefix}`);
      expect((await page.request.put(`/api/projects/${id}/statusconfig`, { data: config })).status()).toBe(200);
      return { project: { id, name }, release };
    };
    const createdA = await create('a', CONFIG_A);
    a = createdA.project;
    releaseA = createdA.release;
    b = (await create('b', CONFIG_B)).project;

    await page.evaluate(id => localStorage.setItem('wuflow_selectedProjectId', String(id)), a.id);
    await page.reload();
    await expect(page.locator('#project-selector-text')).toHaveText(a.name);
    await expect(page.locator('.board-columns .column-header h2')).toHaveText(['Todo', 'A-One', 'A-Three', 'Done']);
  });

  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  // Holds the answers to the GET requests matching url until answer() is called. It resolves
  // once the page has processed them: an answer that must be ignored changes
  // nothing on the page that a test could wait for.
  async function holdAnswers(page: Page, url: RegExp, options: { times?: number } = {}) {
    let released = false;
    let open = () => {};
    const opened = new Promise<void>(resolve => { open = resolve; });
    const answers: Promise<unknown>[] = [];
    await page.route(url, async route => {
      if (released || route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      answers.push(route.request().response().then(r => r?.finished()));
      await opened;
      await route.fulfill({ response });
    }, options);
    const answer = async () => {
      released = true;
      open();
      await Promise.all(answers);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };
    return { answer, held: () => answers.length };
  }

  async function hold(page: Page, projectId: number) {
    return (await holdAnswers(page, new RegExp(`/api/projects/${projectId}/(labels|releases|statusconfig)$`))).answer;
  }

  async function switchTo(page: Page, project: { name: string }) {
    await page.click('#project-selector-btn');
    await page.locator('#project-selector-options .custom-option', { hasText: project.name }).click();
  }

  async function expectBoardOfB(page: Page) {
    await expect(page.locator('.board-columns .column-header h2')).toHaveText(COLUMNS_B);
    await expect(page.locator('#label-filter-options .custom-option')).toHaveText(['No Label', 'label-b']);
    await expect(page.locator('#release-filter-options .custom-option')).toHaveText(['No Release', 'release-b']);
  }

  async function expectDialogOfB(page: Page) {
    await expect(page.locator('#label-trigger')).toBeEnabled();
    await expect(page.locator('#label-options .custom-option')).toHaveText(['No Label', 'label-b']);
    await expect(page.locator('#release-options .custom-option')).toHaveText(['No Release', 'release-b']);
    await expect(page.locator('#status-options .custom-option')).toHaveText(['Open', 'Todo', 'B-One', 'B-Two', 'Done', 'Archived']);
  }

  const columnNames = (page: Page) => page.locator('#ps-status-config-content .sc-name-input');

  test('a refresh of the previous project that finishes last is ignored', async ({ page }) => {
    const answerA = await hold(page, a.id);
    await navigateTo(page, 'board');
    await switchTo(page, b);
    await expectBoardOfB(page);

    await answerA();
    await expectBoardOfB(page);
    await page.click('#add-issue-btn');
    await expectDialogOfB(page);
    await page.click('#cancel-btn');

    await navigateTo(page, 'releases');
    await expect(page.locator('#releases-view .release-row')).toHaveCount(1);
    await expect(page.locator('#releases-view .release-row')).toContainText('release-b');
  });

  test('Project Settings keep the selected project\'s columns when the previous refresh finishes last', async ({ page }) => {
    const answerA = await hold(page, a.id);
    await navigateTo(page, 'board');
    await switchTo(page, b);
    await expectBoardOfB(page);
    await navigateTo(page, 'project-settings');
    await expect(columnNames(page).first()).toHaveValue('B-One');

    await answerA();
    await expect(columnNames(page).first()).toHaveValue('B-One');
    await expect(page.locator('#ps-labels-list .label-name')).toHaveText(['label-b']);
  });

  test('the issue dialog waits for the selected project\'s options when the previous refresh finishes first', async ({ page }) => {
    const answerA = await hold(page, a.id);
    const answerB = await hold(page, b.id);
    await navigateTo(page, 'board');
    await switchTo(page, b);
    await answerA();

    await page.click('#add-issue-btn');
    await expect(page.locator('#label-trigger')).toBeDisabled();
    await expect(page.locator('#status-trigger')).toBeDisabled();

    await answerB();
    await expectDialogOfB(page);
    await page.click('#cancel-btn');
    await expectBoardOfB(page);
  });

  test('Project Settings show no column form until the selected project\'s names have arrived', async ({ page }) => {
    const answerB = await hold(page, b.id);
    await switchTo(page, b);
    await navigateTo(page, 'project-settings');
    await expect(page.locator('#ps-status-config-content')).toHaveText('Column names are not loaded.');
    await expect(page.locator('#ps-save-status-config-btn')).toHaveCount(0);

    await answerB();
    await expect(columnNames(page).first()).toHaveValue('B-One');
    await expect(page.locator('#ps-save-status-config-btn')).toBeVisible();
  });

  test('Project Settings show no column form when the names cannot be loaded', async ({ page }) => {
    await page.route(new RegExp(`/api/projects/${b.id}/statusconfig$`), route => route.fulfill({ status: 500, body: 'Internal server error' }));
    await switchTo(page, b);
    await expect(page.locator('#label-filter-options .custom-option')).toHaveText(['No Label', 'label-b']);
    await navigateTo(page, 'project-settings');
    await expect(page.locator('#ps-labels-list .label-name')).toHaveText(['label-b']);
    await expect(page.locator('#ps-status-config-content')).toHaveText('Column names are not loaded.');
    await expect(page.locator('#ps-save-status-config-btn')).toHaveCount(0);
  });

  test('a column form drawn for the previous project cannot be saved', async ({ page }) => {
    await navigateTo(page, 'project-settings');
    await expect(columnNames(page).first()).toHaveValue('A-One');
    const answerB = await hold(page, b.id);
    await switchTo(page, b);

    await columnNames(page).first().fill('Changed');
    await page.click('#ps-save-status-config-btn');
    await expect(page.locator('#ps-status-config-content')).toHaveText('Column names are not loaded.');

    await answerB();
    await expect(columnNames(page).first()).toHaveValue('B-One');
    for (const [project, config] of [[a, CONFIG_A], [b, CONFIG_B]] as const) {
      const stored = await (await page.request.get(`/api/projects/${project.id}/statusconfig`)).json();
      expect(stored).toEqual({ project_id: project.id, ...config });
    }
  });

  test('an older refresh of the same project does not undo a newer one', async ({ page }) => {
    const older = await holdAnswers(page, new RegExp(`/api/projects/${a.id}/labels$`), { times: 1 });
    await navigateTo(page, 'board');
    await expect.poll(older.held).toBe(1);
    await createLabelViaAPI(page.request, a.id, 'label-new');
    await navigateTo(page, 'board');
    const labels = page.locator('#label-filter-options .custom-option');
    await expect(labels).toHaveText(['No Label', 'label-a', 'label-new']);

    await older.answer();
    await expect(labels).toHaveText(['No Label', 'label-a', 'label-new']);
  });

  test('a new issue saved while the options load does not get the release of the issue opened before', async ({ page }) => {
    await createIssueViaAPI(page.request, a.id, 'With release', { status: 'Todo', release_id: releaseA });
    await navigateTo(page, 'board');
    await page.locator('.card', { hasText: 'With release' }).click();
    await expect(page.locator('#release-select')).toHaveValue(String(releaseA));
    await page.click('#done-btn');
    await switchTo(page, b);
    await expectBoardOfB(page);

    const answerA = await hold(page, a.id);
    await switchTo(page, a);
    await page.click('#add-issue-btn');
    await expect(page.locator('#release-trigger')).toBeDisabled();
    await page.fill('#title', 'Without release');
    const created = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`/projects/${a.id}/issues`));
    await page.click('#save-issue-btn');
    expect((await (await created).json()).release_id).toBeNull();
    await answerA();
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

    await deleteProjectViaAPI(page.request, projectName, workerServer.adminPassword);
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
