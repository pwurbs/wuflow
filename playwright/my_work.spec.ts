import crypto from 'node:crypto';
import { test, expect } from './fixtures';
import type { Page } from './fixtures';
import {
  navigateTo,
  selectPriority,
  selectLabel,
  waitForIssueSave,
  createProjectViaAPI,
  createIssueViaAPI,
  createReleaseViaAPI,
  createLabelViaAPI,
} from './helpers/test-utils';

const DEFAULT_PROJECT_ID = 1;

// My Work card of the given title, in the given category column.
const card = (page: Page, category: 'notStarted' | 'inProgress' | 'done', title: string) =>
  page.locator(`#my-work-grid .my-work-cell[data-category="${category}"] .card`, { hasText: title });

test.describe('My Work', () => {
  test.beforeEach(async ({ login }) => {
    await login();
  });

  test('shows my active issues of all projects in lanes and lets me edit an issue of another project', async ({ page }) => {
    const request = page.request;
    const suffix = Date.now().toString().slice(-8);
    const me = await (await request.get('/api/auth/me')).json();

    const otherResp = await request.post('/api/users', {
      data: { email: `mw_other_${suffix}@example.com`, first_name: 'Other', last_name: 'User', password: `${crypto.randomBytes(16).toString('hex')}U1!`, role: 'user', active: true },
    });
    expect(otherResp.status()).toBe(201);
    const other = await otherResp.json();

    // Project B with its own column names, a label and a release.
    const projectB = `mw_${suffix}`;
    const projectBId = await createProjectViaAPI(request, projectB);
    const cfgResp = await request.put(`/api/projects/${projectBId}/statusconfig`, {
      data: { stage1_name: 'Testing', stage2_name: 'Review', stage3_name: '', stage4_name: '' },
    });
    expect(cfgResp.status()).toBe(200);
    const labelB = `MWL-${suffix}`; // label names: max 15 characters
    const labelBId = await createLabelViaAPI(request, projectBId, labelB);
    const releaseB = `MW-Rel-${suffix}`;
    const releaseBId = await createReleaseViaAPI(request, projectBId, releaseB);

    const t = (name: string) => `${name} ${suffix}`;
    await createIssueViaAPI(request, DEFAULT_PROJECT_ID, t('A todo'), { status: 'Todo', assignee_id: me.id });
    await createIssueViaAPI(request, DEFAULT_PROJECT_ID, t('A working'), { status: 'Stage2', assignee_id: me.id, priority: 'High' });
    await createIssueViaAPI(request, DEFAULT_PROJECT_ID, t('A other'), { status: 'Todo', assignee_id: other.id });
    await createIssueViaAPI(request, DEFAULT_PROJECT_ID, t('A open'), { status: 'Open', assignee_id: me.id });
    const bTestingId = await createIssueViaAPI(request, projectBId, t('B testing'), {
      status: 'Stage1', assignee_id: me.id, label: { id: labelBId }, release_id: releaseBId,
    });
    await createIssueViaAPI(request, projectBId, t('B todo'), { status: 'Todo', assignee_id: me.id });
    // Project C comes first by name, but has fewer open cards than B (1 against 2).
    const projectC = `aa_${suffix}`;
    const projectCId = await createProjectViaAPI(request, projectC);
    await createIssueViaAPI(request, projectCId, t('C todo'), { status: 'Todo', assignee_id: me.id });
    const descriptionWord = `zebra${suffix}`; // in a description only, not in any title
    await createIssueViaAPI(request, projectBId, t('B done'), { status: 'Done', assignee_id: me.id, description: `Contains ${descriptionWord}.` });

    // The board shows the default project; project B is not selected.
    await page.reload();
    await expect(page.locator('#project-selector-text')).not.toHaveText(projectB);

    await navigateTo(page, 'my-work');
    // Toolbar: only the priority filter and the issue search, no project selector and no project filters.
    await expect(page.locator('#project-selector-container')).toBeHidden();
    await expect(page.locator('#priority-filter-wrapper')).toBeVisible();
    await expect(page.locator('#search-filter-wrapper')).toBeVisible();
    for (const id of ['#label-filter-wrapper', '#user-filter-wrapper', '#release-filter-wrapper', '#release-search-wrapper']) {
      await expect(page.locator(id)).toBeHidden();
    }

    // Lanes: one per project with my issues, each named by a pill in its Not Started cell, the most
    // open cards first: B (2 open) before C (1 open), although C comes first by name.
    const laneNames = page.locator('.my-work-lane-name');
    await expect(laneNames.filter({ hasText: projectB })).toHaveCount(1);
    const names = await laneNames.allTextContents();
    expect(names.indexOf(projectB)).toBeGreaterThan(-1);
    expect(names.indexOf(projectB)).toBeLessThan(names.indexOf(projectC));
    await expect(page.locator('.my-work-cell[data-category="notStarted"] .my-work-lane-pill', { hasText: projectB })).toBeVisible();

    // Columns, and the column name chip only in In Progress.
    await expect(card(page, 'notStarted', t('A todo'))).toBeVisible();
    await expect(card(page, 'inProgress', t('A working')).locator('.stage-chip')).toHaveText('Working');
    await expect(card(page, 'inProgress', t('B testing')).locator('.stage-chip')).toHaveText('Testing');
    await expect(card(page, 'done', t('B done'))).toBeVisible();
    await expect(card(page, 'done', t('B done')).locator('.stage-chip')).toHaveCount(0);
    await expect(card(page, 'inProgress', t('B testing'))).not.toContainText(releaseB);
    await expect(card(page, 'inProgress', t('B testing')).locator('.user-badge')).toHaveCount(0);
    await expect(page.locator('#my-work-grid')).not.toContainText(t('A other'));
    await expect(page.locator('#my-work-grid')).not.toContainText(t('A open'));

    // The search also finds words that are only in the description, and the counts show "shown/total".
    await page.fill('#search-input', descriptionWord);
    await expect(page.locator('#my-work-grid .card')).toHaveCount(1);
    await expect(card(page, 'done', t('B done'))).toBeVisible();
    await expect(page.locator('#my-work-grid .column-header[data-category="done"] .count')).toHaveText(/^1\/\d+$/);
    await page.fill('#search-input', '');
    await expect(card(page, 'notStarted', t('A todo'))).toBeVisible();

    // The priority filter, combined with the search for this test's issues: only my High issue,
    // the lane of project B disappears.
    await page.fill('#search-input', suffix);
    await page.click('#priority-filter-btn');
    await page.click('#priority-filter-options .custom-option:has-text("High")');
    await expect(page.locator('#my-work-grid .card')).toHaveCount(1);
    await expect(card(page, 'inProgress', t('A working'))).toBeVisible();
    await expect(laneNames.filter({ hasText: projectB })).toHaveCount(0);
    await page.click('#priority-filter-btn .toolbar-icon-clear');
    await page.fill('#search-input', '');
    await expect(card(page, 'notStarted', t('A todo'))).toBeVisible();

    // Open the issue of project B: the dialog offers B's columns, labels and releases.
    await card(page, 'inProgress', t('B testing')).click();
    await expect(page.locator('#issue-modal')).toBeVisible();
    await expect(page.locator('#status-text')).toHaveText('Testing');
    await expect(page.locator('#label-text')).toHaveText(labelB);
    await expect(page.locator('#release-text')).toHaveText(releaseB);
    await page.click('#status-trigger');
    await expect(page.locator('#status-options .custom-option')).toHaveText(['Open', 'Todo', 'Testing', 'Review', 'Done', 'Archived']);
    await page.click('#status-trigger');

    // Edit and save: requests go to project B with the issue's ETag.
    const prioritySave = waitForIssueSave(page);
    await selectPriority(page, 'High');
    const priorityResp = await prioritySave;
    expect(priorityResp.status()).toBe(200);
    expect(priorityResp.url()).toContain(`/api/projects/${projectBId}/issues/${bTestingId}`);
    expect(priorityResp.request().headers()['if-match']).toBeTruthy();

    const labelSave = waitForIssueSave(page);
    await selectLabel(page, 'No Label');
    expect((await labelSave).status()).toBe(200);

    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // My Work shows the change; the server has it in project B.
    await expect(card(page, 'inProgress', t('B testing'))).toHaveClass(/high-priority/);
    await expect(card(page, 'inProgress', t('B testing'))).not.toContainText(labelB);
    const saved = await (await request.get(`/api/projects/${projectBId}/issues/${bTestingId}`)).json();
    expect(saved.priority).toBe('High');
    expect(saved.label).toBeNull();
    expect(saved.release_id).toBe(releaseBId);

    // The board's state was left alone: it still shows the selected project's columns, not B's.
    await navigateTo(page, 'board');
    await expect(page.locator('.board .column-header h2', { hasText: 'Working' })).toHaveCount(1);
    await expect(page.locator('.board .column-header h2', { hasText: 'Testing' })).toHaveCount(0);
  });

  test('shows my issues of all projects in the read-only planning with their project name', async ({ page }) => {
    const request = page.request;
    const suffix = Date.now().toString().slice(-8);
    const me = await (await request.get('/api/auth/me')).json();
    const projectB = `mwp_${suffix}`;
    const projectBId = await createProjectViaAPI(request, projectB);
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const title = `Planned B ${suffix}`;
    await createIssueViaAPI(request, projectBId, title, { status: 'Todo', assignee_id: me.id, planned_dates: [todayStr] });

    await page.reload();
    await navigateTo(page, 'my-work');

    const item = page.locator('#my-work-planning-list .planning-day[data-date="' + todayStr + '"] .planning-item', { hasText: title });
    await expect(item).toBeVisible();
    await expect(item.locator('.planning-item-project')).toHaveText(projectB);
    await expect(item.locator('.planning-item-remove')).toHaveCount(0);
    await expect(item).toHaveAttribute('draggable', 'false');

    await item.click();
    await expect(page.locator('#issue-modal')).toBeVisible();
    await expect(page.locator('#title')).toHaveValue(title);
  });
});
