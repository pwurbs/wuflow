import { test, expect } from './fixtures';
import { createIssue, openIssueByTitle } from './helpers/test-utils';

test.describe('Issue Edit Modal Behavior', () => {
  test.beforeEach(async ({ page, login }) => {
    await login();
  });

  test('should autosave title on blur (clicking outside modified title)', async ({ page }) => {
    await createIssue(page, { title: 'Test Autosave Issue', status: 'Todo' });
    await openIssueByTitle(page, 'Test Autosave Issue');

    // Click title to edit
    await page.click('#title');
    await expect(page.locator('#title')).toHaveClass(/inline-editing/);

    // Modify title
    await page.fill('#title', 'Modified Title');

    // Blur by clicking outside — triggers autosave, no popup
    const savePromise = page.waitForResponse(r =>
      r.url().includes('/issues/') && r.request().method() === 'PUT'
    );
    await page.click('#modal-title');
    await savePromise;

    // No confirm popup
    await expect(page.locator('#confirm-modal')).toBeHidden();

    // Title field should now show the saved value in read-only mode
    await expect(page.locator('#title')).toHaveValue('Modified Title');

    // Close modal
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Reopen and verify the saved title persists
    await openIssueByTitle(page, 'Modified Title');
    await expect(page.locator('#title')).toHaveValue('Modified Title');
  });

  test('title and description show the read and edit look of inline editing', async ({ page }) => {
    await createIssue(page, { title: 'Inline Look Issue', status: 'Todo' });
    await openIssueByTitle(page, 'Inline Look Issue');
    const title = page.locator('#title');
    const description = page.locator('.editor-container');

    // A read-only title focused without a click (e.g. by Tab) keeps the read look,
    // although the generic input :focus style would apply. The colours change with
    // a CSS transition, so wait for it before checking, or the old colour passes.
    await title.focus();
    await title.evaluate(el => Promise.allSettled(el.getAnimations().map(a => a.finished)));
    await expect(title).toHaveClass(/inline-editable/);
    await expect(title).toHaveCSS('background-color', 'rgb(22, 29, 41)');
    await expect(title).toHaveCSS('border-color', 'rgb(53, 67, 87)');

    await title.click();
    await expect(title).toHaveClass(/inline-editing/);
    await expect(title).toHaveCSS('background-color', 'rgb(19, 25, 36)');
    await expect(title).toHaveCSS('border-color', 'rgb(126, 164, 224)');
    await page.keyboard.press('Escape');
    await expect(title).toHaveClass(/inline-editable/);

    await expect(description).toHaveCSS('background-color', 'rgb(22, 29, 41)');
    await page.click('#description-preview');
    await expect(description).toHaveClass(/inline-editing/);
    await expect(description).toHaveCSS('background-color', 'rgb(19, 25, 36)');
    await expect(description).toHaveCSS('border-color', 'rgb(126, 164, 224)');

    // Buttons with white text use the darker fill blue, not the light text blue
    await expect(page.locator('#done-btn')).toHaveCSS('background-color', 'rgb(47, 99, 176)');
  });

  test('should autosave title on Done click', async ({ page }) => {
    await createIssue(page, { title: 'Save Test Issue', status: 'Todo' });
    await openIssueByTitle(page, 'Save Test Issue');

    await page.click('#title');
    await page.fill('#title', 'Saved Title');

    // Done autosaves the title (no confirm popup) and closes the modal
    const savePromise = page.waitForResponse(r =>
      r.url().includes('/issues/') && r.request().method() === 'PUT'
    );
    await page.click('#done-btn');
    await savePromise;

    // No confirm popup, modal closes
    await expect(page.locator('#confirm-modal')).toBeHidden();
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Reopen and verify the new title was saved
    await openIssueByTitle(page, 'Saved Title');
    await expect(page.locator('#title')).toHaveValue('Saved Title');
  });

  test('should trigger browser navigation warning when unsaved changes exist', async ({ page }) => {
    await createIssue(page, { title: 'Nav Guard Issue', status: 'Todo' });
    await openIssueByTitle(page, 'Nav Guard Issue');

    await page.click('#title');
    await page.fill('#title', 'Unsaved Nav Title');

    // Try to reload page
    // Playwright handles dialogs automatically but for beforeunload we might need to handle it explicitly
    // or verify it prevents navigation if not handled?
    // Actually, modern browsers might just show it. Playwright can check for 'dialog' event.

    let dialogTriggered = false;
    page.on('dialog', async dialog => {
      dialogTriggered = true;
      expect(dialog.type()).toBe('beforeunload');
      await dialog.accept(); // Allow navigation to proceed
    });

    await page.reload();
    expect(dialogTriggered).toBe(true);
  });

  test('scroll cue shows on an overflowing issue and jumps to the end when clicked', async ({ page }) => {
    const title = `ScrollCue_${Date.now()}`;
    // Long enough that the rendered description alone overflows the main column.
    const description = Array.from({ length: 60 }, (_, i) => `Line ${i + 1} of a long description.`).join('\n\n');
    await createIssue(page, { title, description, status: 'Todo' });
    await openIssueByTitle(page, title);

    const scrollArea = page.locator('.modal-main-scroll');
    const cue = page.locator('.scroll-cue-down');

    // Content extends below the fold, so the cue is shown.
    await expect(cue).toHaveClass(/visible/);

    await cue.click();

    // The jump is animated, so poll until the main column has reached its end.
    await expect.poll(() =>
      scrollArea.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)
    ).toBeLessThanOrEqual(4);

    // Nothing left below the fold — the cue hides itself again.
    await expect(cue).not.toHaveClass(/visible/);
  });

  test('top marker appears after scrolling down and jumps back to the top', async ({ page }) => {
    const title = `TopCue_${Date.now()}`;
    const description = Array.from({ length: 60 }, (_, i) => `Line ${i + 1} of a long description.`).join('\n\n');
    await createIssue(page, { title, description, status: 'Todo' });
    await openIssueByTitle(page, title);

    const scrollArea = page.locator('.modal-main-scroll');
    const up = page.locator('.scroll-cue-up');

    // At the top there is nothing to jump back to; the title stays pinned while scrolling
    await expect(up).not.toHaveClass(/visible/);
    await scrollArea.evaluate(el => { el.scrollTop = 300; });
    await expect(up).toHaveClass(/visible/);
    await expect(page.locator('#title')).toBeInViewport();

    await up.click();
    await expect.poll(() => scrollArea.evaluate(el => el.scrollTop)).toBeLessThanOrEqual(4);
    await expect(up).not.toHaveClass(/visible/);
  });

  test('an issue opens at the top, not where the previous issue was scrolled', async ({ page }) => {
    const description = Array.from({ length: 60 }, (_, i) => `Line ${i + 1} of a long description.`).join('\n\n');
    const first = `ReopenA_${Date.now()}`;
    const second = `ReopenB_${Date.now()}`;
    await createIssue(page, { title: first, description, status: 'Todo' });
    await createIssue(page, { title: second, description, status: 'Todo' });

    await openIssueByTitle(page, first);
    const scrollArea = page.locator('.modal-main-scroll');
    await scrollArea.evaluate(el => { el.scrollTop = 400; });
    await expect.poll(() => scrollArea.evaluate(el => el.scrollTop)).toBeGreaterThan(300);
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    await openIssueByTitle(page, second);
    await expect.poll(() => scrollArea.evaluate(el => el.scrollTop)).toBe(0);
    await expect(page.locator('#description-label')).toBeInViewport();
  });

  test('pinned title block has a line with equal space above and below', async ({ page }) => {
    const title = `PinnedLine_${Date.now()}`;
    const description = Array.from({ length: 60 }, (_, i) => `Line ${i + 1} of a long description.`).join('\n\n');
    await createIssue(page, { title, description, status: 'Todo' });
    await openIssueByTitle(page, title);

    const scrollArea = page.locator('.modal-main-scroll');
    // The column keeps its scroll position from the previous use of the modal
    await scrollArea.evaluate(el => { el.scrollTop = 0; });

    const pinned = scrollArea.locator('> .form-group').first();
    await expect(pinned).toHaveCSS('border-bottom-width', '1px');

    const gaps = await page.evaluate(() => {
      const top = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
      const input = top('#title');
      const block = top('.modal-main-scroll > .form-group:first-child');
      const label = top('#description-label');
      return { above: Math.round(block.bottom - 1 - input.bottom), below: Math.round(label.top - block.bottom) };
    });
    expect(gaps).toEqual({ above: 16, below: 16 });

    // While scrolled, the text still ends at the same line instead of touching the title field
    await scrollArea.evaluate(el => { el.scrollTop = 200; });
    await expect(pinned).toBeVisible();
    const stillPinned = await page.evaluate(() => {
      const input = document.querySelector('#title')!.getBoundingClientRect();
      const block = document.querySelector('.modal-main-scroll > .form-group:first-child')!.getBoundingClientRect();
      return Math.round(block.bottom - 1 - input.bottom);
    });
    expect(stillPinned).toBe(16);
  });

  test('renders issue details immediately without waiting for the issue fetch', async ({ page }) => {
    const title = `Instant-Render-${Date.now()}`;
    await createIssue(page, { title, status: 'Todo', description: '**bold** text' });

    // Hold the single-issue GET for 1.5 s; the modal must not depend on it to paint.
    let released = false;
    await page.route(/\/api\/projects\/\d+\/issues\/\d+$/, async route => {
      if (route.request().method() !== 'GET') return route.continue();
      await new Promise(r => setTimeout(r, 1500));
      released = true;
      await route.continue();
    });

    await openIssueByTitle(page, title);

    await expect(page.locator('#title')).toHaveValue(title, { timeout: 500 });
    await expect(page.locator('#description-preview strong')).toHaveText('bold', { timeout: 500 });
    expect(released).toBe(false);

    await page.unrouteAll({ behavior: 'wait' });
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();
  });
});
