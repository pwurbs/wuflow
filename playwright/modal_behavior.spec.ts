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
    const cue = page.locator('.scroll-cue');

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
});
