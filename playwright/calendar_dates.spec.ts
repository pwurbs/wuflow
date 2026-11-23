import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { createIssue, createRelease, navigateTo, openIssueByTitle, createIssueViaAPI, deleteIssueViaAPI } from './helpers/test-utils';

// Deadlines, planned dates and release dates are calendar days: every time zone shows the day
// that was picked. West of UTC they used to show the day before, east of UTC+12 the date input
// of a deadline did.
const DEADLINE = '2030-05-10';
const TASK_DEADLINE = '2030-05-09';

// Today in the browser's time zone, as YYYY-MM-DD.
function todayIn(timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
}

// How the browser formats a calendar day, so the expectation follows its locale.
function formatInBrowser(page: Page, iso: string, options?: Intl.DateTimeFormatOptions) {
  return page.evaluate(([d, opts]) => {
    const [y, m, day] = d.split('-').map(Number);
    return new Date(y, m - 1, day).toLocaleDateString(navigator.language, opts);
  }, [iso, options] as const);
}

for (const timezoneId of ['America/New_York', 'Pacific/Auckland']) {
  test.describe(`Calendar dates in ${timezoneId}`, () => {
    test.use({ timezoneId });

    test.beforeEach(async ({ login }) => {
      await login();
    });

    test('deadline, task deadline and planned date keep their day', async ({ page }) => {
      const title = `Calendar ${timezoneId} ${Date.now()}`;
      const today = todayIn(timezoneId);
      await createIssue(page, { title, status: 'Todo', deadline: DEADLINE, plannedDate: today });

      const card = page.locator('.board-card', { hasText: title });
      await expect(card.locator('.board-card-deadline'))
        .toHaveText(await formatInBrowser(page, DEADLINE, { month: 'numeric', day: 'numeric', year: 'numeric' }));
      await expect(page.locator(`#day-${today} .planning-item`, { hasText: title })).toBeVisible();

      await openIssueByTitle(page, title);
      await expect(page.locator('#issue-id')).toHaveValue(/\d+/);
      await expect(page.locator('#deadline')).toHaveValue(DEADLINE);
      await expect(page.locator('#planned-dates-container .date-chip span').first())
        .toHaveText(await formatInBrowser(page, today, { month: 'numeric', day: 'numeric' }));

      await page.fill('#new-task-title', 'Dated task');
      await page.fill('#new-task-deadline', TASK_DEADLINE);
      await page.click('#add-task-btn');
      const task = page.locator('.task-item').filter({ has: page.locator('input[value="Dated task"]') });
      await expect(task.locator('.task-deadline-display'))
        .toHaveText(await formatInBrowser(page, TASK_DEADLINE, { month: 'short', day: 'numeric' }));
      await expect(task.locator('.task-deadline-input')).toHaveValue(TASK_DEADLINE);
    });

    test('a deadline an older client sent as a timestamp shows its date as written', async ({ page, workerServer }) => {
      const title = `Legacy deadline ${timezoneId} ${Date.now()}`;
      const id = await createIssueViaAPI(page.request, 1, title, { status: 'Todo', deadline: `${DEADLINE}T00:00:00Z` });
      await page.reload();

      await expect(page.locator('.board-card', { hasText: title }).locator('.board-card-deadline'))
        .toHaveText(await formatInBrowser(page, DEADLINE, { month: 'numeric', day: 'numeric', year: 'numeric' }));
      // Unplanned with a distant deadline: left behind, it would show up in the planning panel of later tests.
      await deleteIssueViaAPI(page.request, 1, id, workerServer.adminPassword);
    });

    test('a release is not overdue on its release date', async ({ page }) => {
      const name = `Due_${Date.now().toString().slice(-6)}`;
      const today = todayIn(timezoneId);
      await navigateTo(page, 'releases');
      await createRelease(page, { name, startDate: today, releaseDate: today });

      const row = page.locator('.release-row', { hasText: name });
      const day = await formatInBrowser(page, today);
      await expect(row.locator('.release-dates')).toHaveText(`${day} → ${day}`);
      await expect(row.locator('.release-dates--overdue')).toHaveCount(0);
    });
  });
}
