// A failed load is shown once and never looks like data: lists, selected project and typed
// text stay as they were, and a save that worked is never reported as failed.

import { test, expect } from './fixtures';
import type { Page, Route } from './fixtures';
import { createIssueViaAPI, createLabelViaAPI, createProjectViaAPI, createRelease, createReleaseViaAPI, deleteProjectViaAPI, navigateTo, selectPriority, setStatusConfigViaAPI, switchProject, waitForRender, waitForToast } from './helpers/test-utils';

const FAILURES = [
  { name: 'server error', reason: 'Internal server error', mode: '500' },
  { name: 'lost connection', reason: 'Connection to the server failed.', mode: 'abort' },
] as const;
type Mode = typeof FAILURES[number]['mode'];

const ACTIVE_LIST = /\/issues\/active$/;
const ISSUE = /\/api\/projects\/\d+\/issues\/\d+$/;

let a: { id: number; name: string };
let b: { id: number; name: string };
let pageErrors: string[];

function failRoute(route: Route, mode: Mode) {
  return mode === '500' ? route.fulfill({ status: 500, body: 'Internal server error' }) : route.abort('failed');
}

async function failGet(page: Page, url: RegExp, mode: Mode) {
  await page.route(url, route => {
    if (route.request().method() !== 'GET') return route.fallback();
    return failRoute(route, mode);
  });
}

// Ends all failures.
const recover = (page: Page) => page.unrouteAll({ behavior: 'ignoreErrors' });

const cards = (page: Page) => page.locator('.board-columns .card');
const columns = (page: Page) => page.locator('.board-columns .column-header h2');
const toast = (page: Page) => page.locator('#notification-toast');
const selectedProject = (page: Page) => page.locator('#project-selector-text');
const storedProject = (page: Page) => page.evaluate(() => localStorage.getItem('wuflow_selectedProjectId'));

// A re-render from the loaded data, without requests.
async function rerender(page: Page) {
  await page.fill('#search-input', 'Issue');
  await expect(page.locator('.board-columns .column-header .count').first()).toContainText('/'); // filtered/total
}

async function expectBoardOfA(page: Page) {
  await expect(selectedProject(page)).toHaveText(a.name);
  expect(await storedProject(page)).toBe(String(a.id));
  await expect(columns(page)).toHaveText(['Todo', 'A-One', 'A-Three', 'Done']);
  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page).filter({ hasText: 'Issue in A' })).toBeVisible();
  await expect(cards(page).filter({ hasText: 'Issue in column 3' })).toBeVisible();
}

test.beforeEach(async ({ page, login }) => {
  pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  await login();
  const stamp = `${Date.now()}`.slice(-8);
  a = { id: await createProjectViaAPI(page.request, `a${stamp}`), name: `a${stamp}` };
  b = { id: await createProjectViaAPI(page.request, `b${stamp}`), name: `b${stamp}` };
  await setStatusConfigViaAPI(page.request, a.id, { stage1_name: 'A-One', stage2_name: '', stage3_name: 'A-Three', stage4_name: '' });
  await setStatusConfigViaAPI(page.request, b.id, { stage1_name: 'B-One', stage2_name: '', stage3_name: '', stage4_name: '' });
  await createIssueViaAPI(page.request, a.id, 'Issue in A', { status: 'Todo' });
  await createIssueViaAPI(page.request, a.id, 'Issue in column 3', { status: 'Stage3' });
  await createIssueViaAPI(page.request, a.id, 'Issue open', { status: 'Open' });
  await createIssueViaAPI(page.request, b.id, 'Issue in B', { status: 'Todo' });
  await page.evaluate(id => localStorage.setItem('wuflow_selectedProjectId', String(id)), a.id);
  await page.reload();
  await expectBoardOfA(page);
});

test.afterEach(async ({ page }) => {
  await recover(page);
  expect(pageErrors).toEqual([]);
});

for (const { name, reason, mode } of FAILURES) {
  test.describe(`Failed refresh (${name})`, () => {
    for (const [what, url] of [['projects', /\/api\/projects$/], ['active issues', ACTIVE_LIST], ['labels', /\/labels$/]] as const) {
      test(`${what}: project and board stay, also on a re-render`, async ({ page }) => {
        await failGet(page, url, mode);
        await navigateTo(page, 'board');
        await waitForToast(page, `Project data could not be loaded: ${reason}`);
        await expectBoardOfA(page);
        await rerender(page);
        await expectBoardOfA(page);

        await recover(page);
        await createIssueViaAPI(page.request, a.id, 'Issue new', { status: 'Todo' });
        await navigateTo(page, 'board');
        await expect(cards(page).filter({ hasText: 'Issue new' })).toBeVisible();
      });
    }

    test('a failed project switch returns to the project shown', async ({ page }) => {
      await failGet(page, new RegExp(`/projects/${b.id}/labels$`), mode);
      await switchProject(page, b);
      await waitForToast(page, `Project data could not be loaded: ${reason}`);
      await expectBoardOfA(page);
      await rerender(page);
      await expectBoardOfA(page);

      await recover(page);
      await switchProject(page, b);
      await expect(columns(page)).toHaveText(['Todo', 'B-One', 'Done']);
      await expect(cards(page)).toHaveText([/Issue in B/]);
    });

    test('My Work: shows the issues although the project data could not be loaded', async ({ page }) => {
      const me = await (await page.request.get('/api/auth/me')).json();
      await createIssueViaAPI(page.request, a.id, 'Issue mine', { status: 'Todo', assignee_id: me.id });
      let answer = () => {};
      const held = new Promise<void>(resolve => { answer = resolve; });
      await page.route(/\/api\/me\/issues$/, async route => {
        await held;
        await route.fallback();
      });
      await failGet(page, /\/labels$/, mode);
      await navigateTo(page, 'my-work');
      await waitForToast(page, `Project data could not be loaded: ${reason}`);
      await expect(page.locator('.my-work-empty')).toHaveText('Your issues are not loaded.');
      answer();
      await expect(page.locator('#my-work-grid .card', { hasText: 'Issue mine' }).first()).toBeVisible();
    });

    test('My Work: says that the issues are not loaded instead of that there are none', async ({ page }) => {
      await failGet(page, /\/api\/me\/issues$/, mode);
      await navigateTo(page, 'my-work');
      await waitForToast(page, `My Work could not be loaded: ${reason}`);
      await expect(page.locator('.my-work-empty')).toHaveText('Your issues are not loaded.');
    });

    test('column names: the columns of the project stay, and Project Settings keep the form', async ({ page }) => {
      await failGet(page, /\/statusconfig$/, mode);
      await navigateTo(page, 'board');
      await waitForToast(page, `Column names could not be loaded: ${reason}`);
      await expectBoardOfA(page);
      await navigateTo(page, 'project-settings');
      await expect(page.locator('#ps-status-config-content .sc-name-input').first()).toHaveValue('A-One');
    });

    test('lists of a view say that they could not be loaded, and load on the next visit', async ({ page }) => {
      await createReleaseViaAPI(page.request, a.id, 'Rel');
      await navigateTo(page, 'board');
      await expect(page.locator('#release-filter-options .custom-option', { hasText: 'Rel' })).toHaveCount(1);
      await failGet(page, /\/issues\/(open|archived)$/, mode);
      await navigateTo(page, 'backlog');
      await expect(page.locator('#backlog-list')).toHaveText(`Open issues could not be loaded: ${reason}`);
      await navigateTo(page, 'archive');
      await expect(page.locator('#archive-list')).toHaveText(`Archived issues could not be loaded: ${reason}`);
      await navigateTo(page, 'releases');
      await expect(page.locator('#releases-view')).toHaveText(`Releases could not be loaded: ${reason}`);

      await recover(page);
      await navigateTo(page, 'backlog');
      await expect(page.locator('#backlog-list .card')).toHaveText([/Issue open/]);
      await navigateTo(page, 'releases');
      await expect(page.locator('.release-row')).toHaveCount(1);
    });

    test('a list shown before stays, and a failed list does not show another project\'s', async ({ page }) => {
      await navigateTo(page, 'backlog');
      await expect(page.locator('#backlog-list .card')).toHaveText([/Issue open/]);
      await failGet(page, /\/issues\/open$/, mode);
      await navigateTo(page, 'backlog');
      await waitForToast(page, `Project data could not be loaded: ${reason}`);
      await expect(page.locator('#backlog-list .card')).toHaveText([/Issue open/]);

      await recover(page);
      await navigateTo(page, 'board');
      await switchProject(page, b);
      await expect(cards(page)).toHaveText([/Issue in B/]);
      await failGet(page, /\/issues\/open$/, mode);
      await navigateTo(page, 'backlog');
      await expect(page.locator('#backlog-list')).toHaveText(`Open issues could not be loaded: ${reason}`);
    });
  });

  test.describe(`Issue dialog (${name})`, () => {
    test('text typed while the check fails stays and is saved afterwards', async ({ page }) => {
      let answer = () => {};
      const held = new Promise<void>(resolve => { answer = resolve; });
      await page.route(ISSUE, async route => {
        if (route.request().method() !== 'GET') return route.fallback();
        await held;
        return failRoute(route, mode);
      });
      await cards(page).filter({ hasText: 'Issue in A' }).click();
      await page.click('#description-preview');
      await page.fill('#description-editor', 'Typed text');
      answer();
      await waitForToast(page, `The latest version of this issue could not be loaded: ${reason}`);
      await expect(page.locator('#issue-modal')).toBeVisible();
      await expect(page.locator('#description-editor')).toHaveValue('Typed text');

      await page.click('#done-btn');
      await page.click('#confirm-ok-btn'); // "Save description?" → Save
      await waitForToast(page, `The change was not saved: ${reason}`);
      await expect(page.locator('#description-editor')).toHaveValue('Typed text');

      await recover(page);
      const saved = page.waitForRequest(req => req.method() === 'PUT' && ISSUE.test(req.url()));
      await page.click('#done-btn');
      await page.click('#confirm-ok-btn');
      expect((await saved).headers()['if-match']).toBeTruthy();
      await expect(page.locator('#issue-modal')).toBeHidden();
    });

    test('a failed reload after a conflict is shown', async ({ page }) => {
      const checked = page.waitForResponse(ISSUE);
      await cards(page).filter({ hasText: 'Issue in A' }).click();
      await checked;
      await page.route(ISSUE, route => {
        if (route.request().method() === 'PUT') return route.fulfill({ status: 409, body: 'conflict' });
        return failRoute(route, mode);
      });
      await selectPriority(page, 'High');
      await page.click('#confirm-ok-btn'); // Reload
      await waitForToast(page, reason);
      await expect(page.locator('#issue-modal')).toBeVisible();
    });
  });

  test.describe(`Saved, but the reload fails (${name})`, () => {
    test('release', async ({ page }) => {
      await navigateTo(page, 'releases');
      await failGet(page, /\/releases$/, mode);
      await createRelease(page, { name: 'New release' });
      await waitForToast(page, `Release created, but the releases could not be loaded: ${reason}`);
    });

    test('label created and deleted', async ({ page, workerServer }) => {
      await createLabelViaAPI(page.request, a.id, 'old');
      await navigateTo(page, 'project-settings');
      await expect(page.locator('.label-name')).toHaveText(['old']);
      let failing = false;
      await page.route(/\/labels(\/\d+)?$/, route => {
        if (route.request().method() !== 'GET') { failing = true; return route.fallback(); }
        if (!failing) return route.fallback();
        return failRoute(route, mode);
      });
      await page.fill('#ps-new-label-input', 'new');
      await page.press('#ps-new-label-input', 'Enter');
      await waitForToast(page, 'Label created');
      await expect(page.locator('#ps-labels-list')).toHaveText(`Labels could not be loaded: ${reason}`);

      failing = false;
      await navigateTo(page, 'project-settings');
      await expect(page.locator('.label-name')).toHaveCount(2);
      await page.locator('.delete-label-btn').first().click();
      await page.fill('#admin-confirm-password', workerServer.adminPassword);
      await page.click('#admin-confirm-ok-btn');
      await waitForToast(page, 'Label deleted');
      await expect(page.locator('#ps-labels-list')).toHaveText(`Labels could not be loaded: ${reason}`);
    });

    test('comment and history', async ({ page }) => {
      await cards(page).filter({ hasText: 'Issue in A' }).click();
      await expect(page.locator('#comment-form-container')).toBeVisible();
      await failGet(page, /\/(comments|history)$/, mode);
      await page.fill('#new-comment-body', 'A comment');
      await page.click('#add-comment-btn');
      await waitForToast(page, `Comment added, but the comments could not be loaded: ${reason}`);

      await selectPriority(page, 'High');
      await waitForToast(page, `History could not be loaded: ${reason}`);
      await expect(page.locator('#priority-text')).toHaveText('High');
    });
  });

  test.describe(`Page load (${name})`, () => {
    for (const [what, url] of [['current user', /\/api\/auth\/me$/], ['users', /\/api\/users$/]] as const) {
      test(`${what}: asks to try again instead of showing an empty page or the login`, async ({ page }) => {
        await failGet(page, url, mode);
        await page.reload();
        await expect(page.locator('#confirm-title')).toHaveText('wuFlow could not be loaded');
        await expect(page.locator('#confirm-message')).toHaveText(mode === '500' && what === 'users' ? 'Failed to fetch users' : reason);
        await recover(page);
        await page.click('#confirm-ok-btn');
        await expectBoardOfA(page);
      });
    }
  });
}

test('a refresh that was superseded does not report its failure', async ({ page }) => {
  let fail = () => {};
  const held = new Promise<void>(resolve => { fail = resolve; });
  const failed = page.waitForResponse(res => res.url().endsWith(`/projects/${a.id}/labels`) && res.status() === 500);
  await page.route(new RegExp(`/projects/${a.id}/labels$`), async route => {
    await held;
    await route.fulfill({ status: 500, body: 'Internal server error' });
  });
  await navigateTo(page, 'board');
  await switchProject(page, b);
  await expect(columns(page)).toHaveText(['Todo', 'B-One', 'Done']);
  fail();
  await failed;
  await waitForRender(page);
  await expect(toast(page)).toBeHidden();
  await expect(selectedProject(page)).toHaveText(b.name);
});

// A response that is held until it is released.
async function holdGet(page: Page, url: RegExp, answer: (route: Route) => Promise<void>) {
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(url, async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    await held;
    await answer(route);
  });
  return () => release();
}

test('releases that arrive after a project switch do not replace those of the new project', async ({ page }) => {
  await createReleaseViaAPI(page.request, b.id, 'Rel of B');
  await navigateTo(page, 'releases');
  const url = new RegExp(`/projects/${a.id}/releases$`);
  const release = await holdGet(page, url, route => route.fallback());
  const requested = page.waitForRequest(req => req.method() === 'GET' && url.test(req.url()));
  await createRelease(page, { name: 'Rel of A' });
  await requested;
  await switchProject(page, b);
  await expect(page.locator('.release-row')).toHaveText([/Rel of B/]);

  release();
  await waitForToast(page, 'Release created');
  await waitForRender(page);
  await expect(page.locator('.release-row')).toHaveText([/Rel of B/]);
});

test('release deleted during a failing project switch: the issues of the project shown stay', async ({ page, workerServer }) => {
  await createReleaseViaAPI(page.request, a.id, 'Rel of A');
  await navigateTo(page, 'board'); // loads the release
  await expect(page.locator('#release-filter-options .custom-option', { hasText: 'Rel of A' })).toHaveCount(1);
  await navigateTo(page, 'releases');
  const fail = await holdGet(page, new RegExp(`/projects/${b.id}/labels$`), route => failRoute(route, '500'));
  await switchProject(page, b);
  await page.locator('.release-row', { hasText: 'Rel of A' }).locator('.release-card-left').click();
  await page.click('#release-modal-delete');
  await page.fill('#admin-confirm-password', workerServer.adminPassword);
  await page.click('#admin-confirm-ok-btn');
  await waitForToast(page, 'Release deleted');

  fail();
  await waitForToast(page, 'Project data could not be loaded');
  await expect(selectedProject(page)).toHaveText(a.name);
  // Without opening the board, which would load it again.
  await expect(cards(page).filter({ hasText: 'Issue in A' })).toHaveCount(1);
  await expect(cards(page).filter({ hasText: 'Issue in B' })).toHaveCount(0);
});

test('full outage: a failed save stays on screen when the refresh after it fails too', async ({ page }) => {
  await createIssueViaAPI(page.request, a.id, 'Issue second', { status: 'Todo' });
  await navigateTo(page, 'board');
  await expect(cards(page)).toHaveCount(3);
  await page.route(/\/api\//, route => route.abort('failed'));
  const refresh = page.waitForEvent('requestfailed', req => req.url().endsWith('/api/projects'));
  await cards(page).first().click({ button: 'right' });
  await page.getByText('Move to bottom').click();
  await refresh;
  await waitForToast(page, 'Connection to the server failed. The change was not saved.');
  await expect(page.locator('#connection-banner')).toBeVisible();
  await rerender(page);
  await expect(cards(page)).toHaveCount(3);
});

test('selected project deleted elsewhere: the app selects another project', async ({ page, workerServer }) => {
  const name = `c${Date.now()}`.slice(-9);
  const id = await createProjectViaAPI(page.request, name);
  await page.evaluate(projectId => localStorage.setItem('wuflow_selectedProjectId', String(projectId)), id);
  await page.reload();
  await expect(selectedProject(page)).toHaveText(name);
  await deleteProjectViaAPI(page.request, name, workerServer.adminPassword);

  await navigateTo(page, 'board');
  await expect(selectedProject(page)).toHaveText('default');
  expect(await storedProject(page)).toBe('1');

  // The same at page load, from the stored project.
  await page.evaluate(projectId => localStorage.setItem('wuflow_selectedProjectId', String(projectId)), id);
  await page.reload();
  await expect(selectedProject(page)).toHaveText('default');
  await expect(columns(page).first()).toHaveText('Todo');
  await expect(toast(page)).toBeHidden();
});

for (const where of ['here', 'elsewhere'] as const) {
  test(`selected project deleted ${where} and the next one cannot be loaded: asks once to try again`, async ({ page, workerServer }) => {
    const name = `d${Date.now()}`.slice(-9);
    const id = await createProjectViaAPI(page.request, name);
    await page.evaluate(projectId => localStorage.setItem('wuflow_selectedProjectId', String(projectId)), id);
    await page.reload();
    await expect(selectedProject(page)).toHaveText(name);

    let requests = 0;
    await page.route(/\/projects\/1\/labels$/, route => {
      requests++;
      return failRoute(route, '500');
    });
    if (where === 'here') {
      await navigateTo(page, 'system-settings');
      await page.locator('#projects-list .settings-entry', { hasText: name }).click();
      await page.click('#project-modal-delete');
      await page.fill('#admin-confirm-password', workerServer.adminPassword);
      await page.click('#admin-confirm-ok-btn');
    } else {
      await deleteProjectViaAPI(page.request, name, workerServer.adminPassword);
      await navigateTo(page, 'board');
    }
    await expect(page.locator('#confirm-title')).toHaveText('wuFlow could not be loaded');
    await expect(page.locator('#confirm-ok-btn')).toBeVisible();
    await waitForRender(page);
    expect(requests).toBe(1);

    await recover(page);
    await page.click('#confirm-ok-btn');
    await expect(selectedProject(page)).toHaveText('default');
    await expect(page.locator('#confirm-ok-btn')).toBeHidden();
  });
}

test('project delete: an unknown number of issues is reported before the password dialog', async ({ page }) => {
  await navigateTo(page, 'system-settings');
  await page.locator('#projects-list .settings-entry', { hasText: a.name }).click();
  await failGet(page, /\/issues\/(active|open|archived)$/, '500');
  await page.click('#project-modal-delete');
  await expect(page.locator('#project-modal-error')).toHaveText('The project\'s issues could not be loaded: Internal server error');
  await expect(page.locator('#admin-confirm-modal')).toBeHidden();
});
