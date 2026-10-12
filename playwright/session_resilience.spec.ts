// Session & connection resilience: an expired session or a lost connection must never
// discard the user's input or make an unsaved change look saved.
// - Expired session: an in-place re-login dialog opens and the failed request is replayed.
// - Network error: the change is not saved, text being edited stays in its field, other
//   controls (cards, dropdowns) return to their saved state, and a connection banner shows.

import { test, expect } from './fixtures';
import type { BrowserContext, Locator, Page } from './fixtures';
import { createIssue, navigateTo, openIssueByTitle, selectPriority, waitForToast } from './helpers/test-utils';

const NETWORK_ERROR = 'Connection to the server failed';

function boardCard(page: Page, status: string, title: string) {
  return page.locator(`.column[data-status="${status}"] .board-card:has-text("${title}")`);
}

// Returns the given titles in the order the items show them (other items are ignored).
// A title that is not shown is left out, so a missing card fails the order check.
async function orderOf(items: Locator, titles: string[]): Promise<string[]> {
  const texts = await items.allInnerTexts();
  return titles
    .map(title => ({ title, index: texts.findIndex(text => text.includes(title)) }))
    .filter(({ index }) => index >= 0)
    .sort((a, b) => a.index - b.index)
    .map(({ title }) => title);
}

// Same for the task list, whose titles are input values rather than text.
async function taskOrder(page: Page): Promise<string[]> {
  return page.locator('#task-list .task-title-input').evaluateAll(inputs => inputs.map(i => (i as HTMLInputElement).value));
}

// Drops `source` just above `target`, so it lands before it in the list.
async function dragAbove(source: Locator, target: Locator) {
  await source.dragTo(target, { targetPosition: { x: 10, y: 2 } });
}

// Expires the session and simulates the user returning to the tab: the re-login dialog opens.
async function expireSessionAndReturn(page: Page, context: BrowserContext) {
  await context.clearCookies();
  await page.evaluate(() => globalThis.dispatchEvent(new Event('focus')));
  await expect(page.locator('#reauth-modal')).toBeVisible();
}

test.beforeEach(async ({ page, login }) => {
  await login();
  // Wait until app init is done: the version label is filled only after the session
  // handling is installed. Clearing cookies earlier hits the page-load auth check,
  // which (by design) redirects to /login instead of opening the re-login dialog.
  await expect(page.locator('#app-version')).not.toHaveText('v...');
});

test.describe('Expired session: re-login dialog', () => {
  test('save during an expired session: sign in in place and the edit is persisted', async ({ page, context, workerServer }) => {
    const title = `Reauth-${Date.now()}`;
    await createIssue(page, { title, status: 'Todo' });
    await openIssueByTitle(page, title);

    await page.click('#title');
    await page.fill('#title', `${title} edited`);
    await context.clearCookies(); // session gone (e.g. 24 h idle expiry)
    await page.press('#title', 'Enter');

    const dialog = page.locator('#reauth-modal');
    await expect(dialog).toBeVisible();
    await expect(page.locator('#reauth-email')).toHaveValue(workerServer.adminEmail);
    await expect(page.locator('#title')).toHaveValue(`${title} edited`); // input kept

    await page.fill('#reauth-password', workerServer.adminPassword);
    await page.click('#reauth-submit-btn');
    await expect(dialog).toBeHidden();
    await waitForToast(page, 'Title updated');

    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();
    await expect(page.locator(`.card:has-text("${title} edited")`)).toBeVisible();
  });

  test('card move during an expired session is saved after signing in', async ({ page, context, workerServer }) => {
    const title = `Reauth-Drag-${Date.now()}`;
    await createIssue(page, { title, status: 'Todo' });

    await context.clearCookies();
    await boardCard(page, 'Todo', title).dragTo(page.locator('.column[data-status="Stage2"]'));

    await expect(page.locator('#reauth-modal')).toBeVisible();
    await page.fill('#reauth-password', workerServer.adminPassword);
    await page.click('#reauth-submit-btn');
    await expect(page.locator('#reauth-modal')).toBeHidden();
    await expect(boardCard(page, 'Stage2', title)).toBeVisible();

    await page.reload();
    await expect(boardCard(page, 'Stage2', title)).toBeVisible(); // persisted on the server
  });

  test('wrong password shows an error and keeps the dialog open', async ({ page, context }) => {
    await expireSessionAndReturn(page, context);
    await page.fill('#reauth-password', 'definitely-wrong-password');
    await page.click('#reauth-submit-btn');

    await expect(page.locator('#reauth-error')).toBeVisible();
    await expect(page.locator('#reauth-modal')).toBeVisible();
  });

  test('returning to the tab with an expired session opens the dialog before any edit', async ({ page, context }) => {
    await expireSessionAndReturn(page, context);
  });

  test('dialog closes by itself after signing in in another tab', async ({ page, context, workerServer }) => {
    await expireSessionAndReturn(page, context);

    // Login from "another tab": context.request shares the browser context's cookies
    const res = await context.request.post('/api/auth/login', {
      data: { email: workerServer.adminEmail, password: workerServer.adminPassword },
    });
    expect(res.ok()).toBe(true);

    await page.evaluate(() => globalThis.dispatchEvent(new Event('focus')));
    await expect(page.locator('#reauth-modal')).toBeHidden();
  });

  test('Log Out in the dialog leads to the login page', async ({ page, context }) => {
    await expireSessionAndReturn(page, context);

    await page.click('#reauth-logout-btn');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Network error: change not saved, nothing lost or faked', () => {
  test('description save while offline keeps the modal and the text; saved once back online', async ({ page, context }) => {
    const title = `Offline-${Date.now()}`;
    const text = 'Written while the connection was lost';
    await createIssue(page, { title, status: 'Todo' });
    await openIssueByTitle(page, title);

    await page.click('#description-preview');
    await page.fill('#description-editor', text);

    await context.setOffline(true);
    await expect(page.locator('#connection-banner')).toBeVisible();

    await page.click('#done-btn');
    await page.click('#confirm-ok-btn'); // "Save Description?" → Save
    await waitForToast(page, NETWORK_ERROR);
    await expect(page.locator('#issue-modal')).toBeVisible();
    await expect(page.locator('#description-editor')).toHaveValue(text);

    await context.setOffline(false);
    await page.click('#done-btn');
    await page.click('#confirm-ok-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();
    await expect(page.locator('#connection-banner')).toBeHidden();

    await openIssueByTitle(page, title);
    await expect(page.locator('#description-editor')).toHaveValue(text);
  });

  test('task title edit while offline: Done keeps the modal open and the typed text', async ({ page, context }) => {
    const title = `Offline-Task-${Date.now()}`;
    await createIssue(page, { title, status: 'Todo' });
    await openIssueByTitle(page, title);
    await page.fill('#new-task-title', 'Original Task');
    await page.click('#add-task-btn');
    const taskInput = page.locator('#task-list .task-title-input').first();
    await expect(taskInput).toHaveValue('Original Task');

    await taskInput.click(); // enter edit mode
    await taskInput.fill('Renamed while offline');
    await context.setOffline(true);
    await page.click('#done-btn');

    await waitForToast(page, NETWORK_ERROR);
    await expect(page.locator('#issue-modal')).toBeVisible();
    await expect(taskInput).toHaveValue('Renamed while offline');

    await context.setOffline(false);
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    await openIssueByTitle(page, title);
    await expect(page.locator('#task-list .task-title-input').first()).toHaveValue('Renamed while offline');
  });

  test('sidebar change while offline returns to the saved value', async ({ page, context }) => {
    const title = `Offline-Priority-${Date.now()}`;
    await createIssue(page, { title, status: 'Todo' });
    await openIssueByTitle(page, title);
    await expect(page.locator('#priority-text')).toContainText('Normal');

    await context.setOffline(true);
    await selectPriority(page, 'High');

    await waitForToast(page, NETWORK_ERROR);
    await expect(page.locator('#priority-text')).toContainText('Normal');
  });

  test('comment post while offline keeps the typed comment', async ({ page, context }) => {
    const title = `Offline-Comment-${Date.now()}`;
    await createIssue(page, { title, status: 'Todo' });
    await openIssueByTitle(page, title);

    await page.fill('#new-comment-body', 'Comment written offline');
    await context.setOffline(true);
    await page.click('#add-comment-btn');

    await waitForToast(page, NETWORK_ERROR);
    await expect(page.locator('#new-comment-body')).toHaveValue('Comment written offline');

    await context.setOffline(false);
    await page.click('#add-comment-btn');
    await expect(page.locator('.comment-item').filter({ hasText: 'Comment written offline' })).toBeVisible();
  });
});

test.describe('Network error: card move', () => {
  test('card moved while offline returns to its old column and stays there online', async ({ page, context }) => {
    const title = `Offline-Drag-${Date.now()}`;
    await createIssue(page, { title, status: 'Todo' });
    await expect(boardCard(page, 'Todo', title)).toBeVisible();

    await context.setOffline(true);
    await boardCard(page, 'Todo', title).dragTo(page.locator('.column[data-status="Stage2"]'));

    await waitForToast(page, NETWORK_ERROR);
    await expect(boardCard(page, 'Todo', title)).toBeVisible();
    await expect(boardCard(page, 'Stage2', title)).toHaveCount(0);

    await context.setOffline(false);
    await page.reload();
    await expect(boardCard(page, 'Todo', title)).toBeVisible();
    await expect(boardCard(page, 'Stage2', title)).toHaveCount(0);
  });

  test('cards reordered in a board column while offline return to their old order', async ({ page, context }) => {
    const a = `Offline-Order-A-${Date.now()}`;
    const b = `Offline-Order-B-${Date.now()}`;
    await createIssue(page, { title: a, status: 'Todo' });
    await createIssue(page, { title: b, status: 'Todo' });
    const cards = page.locator('.column[data-status="Todo"] .board-card');
    await expect.poll(() => orderOf(cards, [a, b])).toEqual([a, b]);

    await context.setOffline(true);
    await dragAbove(boardCard(page, 'Todo', b), boardCard(page, 'Todo', a));

    await waitForToast(page, NETWORK_ERROR);
    await expect.poll(() => orderOf(cards, [a, b])).toEqual([a, b]);

    await context.setOffline(false);
    await page.reload();
    await expect.poll(() => orderOf(cards, [a, b])).toEqual([a, b]);
  });

  test('backlog cards reordered while offline return to their old order', async ({ page, context }) => {
    const a = `Offline-Backlog-A-${Date.now()}`;
    const b = `Offline-Backlog-B-${Date.now()}`;
    await createIssue(page, { title: a }); // Open status → backlog list
    await createIssue(page, { title: b });
    await navigateTo(page, 'backlog');
    const cards = page.locator('#backlog-list .card');
    const card = (title: string) => cards.filter({ hasText: title });
    // The backlog loads its Open issues lazily; wait for them before going offline.
    await expect(card(a)).toBeVisible();
    await expect(card(b)).toBeVisible();
    await expect.poll(() => orderOf(cards, [a, b])).toEqual([a, b]);

    await context.setOffline(true);
    await dragAbove(card(b), card(a));

    await waitForToast(page, NETWORK_ERROR);
    await expect.poll(() => orderOf(cards, [a, b])).toEqual([a, b]);

    await context.setOffline(false);
    await page.reload();
    await navigateTo(page, 'backlog');
    await expect.poll(() => orderOf(cards, [a, b])).toEqual([a, b]);
  });

  test('card archived by drag while offline returns to Done and stays there online', async ({ page, context }) => {
    const title = `Offline-Archive-${Date.now()}`;
    await createIssue(page, { title, status: 'Done' });
    await navigateTo(page, 'archive');
    const doneCard = page.locator('#archive-done-list .card', { hasText: title });
    const archivedCard = page.locator('#archive-list .card', { hasText: title });
    await expect(doneCard).toBeVisible();

    await context.setOffline(true);
    // The section heading is where archiving by drag is handled (section drop).
    await doneCard.dragTo(page.locator('#archive-archive-section h2'));

    await waitForToast(page, NETWORK_ERROR);
    await expect(doneCard).toBeVisible();
    await expect(archivedCard).toHaveCount(0);

    await context.setOffline(false);
    await page.reload();
    await navigateTo(page, 'archive');
    await expect(doneCard).toBeVisible();
    await expect(archivedCard).toHaveCount(0);
  });

  test('tasks reordered while offline return to their old order', async ({ page, context }) => {
    const title = `Offline-Tasks-${Date.now()}`;
    await createIssue(page, { title, status: 'Todo' });
    await openIssueByTitle(page, title);
    for (const task of ['Task A', 'Task B']) {
      await page.fill('#new-task-title', task);
      await page.click('#add-task-btn');
      await expect(page.locator(`#task-list .task-title-input[value="${task}"]`)).toBeVisible();
    }
    expect(await taskOrder(page)).toEqual(['Task A', 'Task B']);

    await context.setOffline(true);
    const items = page.locator('#task-list .task-item');
    await dragAbove(items.nth(1), items.nth(0));

    await waitForToast(page, NETWORK_ERROR);
    await expect.poll(() => taskOrder(page)).toEqual(['Task A', 'Task B']);

    await context.setOffline(false);
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();
    await openIssueByTitle(page, title);
    await expect.poll(() => taskOrder(page)).toEqual(['Task A', 'Task B']);
  });
});
