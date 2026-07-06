import { test, expect } from './fixtures';
import { createIssue, openIssueByTitle, waitForToast, navigateTo } from './helpers/test-utils';

test.describe('Issue Activity (History + Comments)', () => {
  test.beforeEach(async ({ page, login }) => {
    await login();
  });

  test('activity area is visible below tasks with Comments/History tabs', async ({ page }) => {
    await createIssue(page, { title: 'Activity Area Issue', status: 'Todo' });
    await openIssueByTitle(page, 'Activity Area Issue');

    await expect(page.locator('#activity-section')).toBeVisible();
    await expect(page.locator('#tab-comments')).toHaveClass(/active/);
    await expect(page.locator('#comment-list')).toBeVisible();
    await expect(page.locator('#history-list')).toBeHidden();
  });

  test('add a comment and see it in the list', async ({ page }) => {
    await createIssue(page, { title: 'Comment Add Issue', status: 'Todo' });
    await openIssueByTitle(page, 'Comment Add Issue');

    await page.fill('#new-comment-body', 'This is my **first** comment');
    await page.click('#add-comment-btn');

    await waitForToast(page, 'Comment added');
    const comment = page.locator('.comment-item').filter({ hasText: 'first' });
    await expect(comment).toBeVisible();
    // Markdown bold should render, not show literal asterisks.
    await expect(comment.locator('.comment-body strong')).toHaveText('first');
  });

  test('edit an existing comment', async ({ page }) => {
    await createIssue(page, { title: 'Comment Edit Issue', status: 'Todo' });
    await openIssueByTitle(page, 'Comment Edit Issue');

    await page.fill('#new-comment-body', 'Original text');
    await page.click('#add-comment-btn');
    // Scope by the single comment item, not by text: editing swaps the display
    // text for a <textarea>, whose value isn't part of textContent, so a
    // hasText-filtered locator would stop matching once edit mode starts.
    const comment = page.locator('.comment-item').first();
    await expect(comment).toContainText('Original text');

    // Edit/Delete icons are hidden until the comment is hovered.
    await comment.hover();
    await comment.locator('.comment-edit-btn').click();
    const editInput = comment.locator('.comment-edit-input');
    await editInput.fill('Edited text');
    await comment.locator('.inline-save-btn').click();

    await waitForToast(page, 'Comment updated');
    await expect(comment).toContainText('Edited text');
    await expect(comment.locator('.comment-time')).toContainText('edited');
  });

  test('delete a comment', async ({ page }) => {
    await createIssue(page, { title: 'Comment Delete Issue', status: 'Todo' });
    await openIssueByTitle(page, 'Comment Delete Issue');

    await page.fill('#new-comment-body', 'Comment to delete');
    await page.click('#add-comment-btn');
    const comment = page.locator('.comment-item').filter({ hasText: 'Comment to delete' });
    await expect(comment).toBeVisible();

    // Edit/Delete icons are hidden until the comment is hovered.
    await comment.hover();
    await comment.locator('.comment-delete-btn').click();
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await page.click('#confirm-ok-btn');

    await waitForToast(page, 'Comment deleted');
    await expect(page.locator('.comment-item').filter({ hasText: 'Comment to delete' })).toHaveCount(0);
  });

  test('comment box is hidden on archived issues, history remains visible', async ({ page }) => {
    await createIssue(page, { title: 'Comment Archived Issue', status: 'Todo' });
    await openIssueByTitle(page, 'Comment Archived Issue');

    // A successful archive closes the modal; reopen it from the Archive view
    // to inspect the archived issue's state (mirrors archive.spec.ts).
    await page.click('#archive-issue-btn');
    await page.click('#confirm-ok-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    await navigateTo(page, 'archive');
    await page.click('.card:has-text("Comment Archived Issue")');
    await expect(page.locator('#issue-modal')).toBeVisible();
    await expect(page.locator('#archive-issue-btn')).toBeHidden();

    await expect(page.locator('#comment-form-container')).toBeHidden();

    await page.click('#tab-history');
    await expect(page.locator('#history-list')).toBeVisible();
  });

  test('history records creation, edits, task changes, and archive/unarchive oldest-first', async ({ page }) => {
    const title = 'Activity History Issue';
    const renamed = 'Activity History Issue Renamed';
    await createIssue(page, { title, status: 'Todo' });
    await openIssueByTitle(page, title);

    // Edit the title (triggers a field-change history entry on save).
    await page.click('#title');
    await page.fill('#title', renamed);
    await page.click('#modal-title'); // blur to trigger autosave
    await page.waitForResponse(r => /\/issues\/\d+$/.test(r.url().split('?')[0]) && r.request().method() === 'PUT');

    // Add a task, then complete it — archiving is blocked while a task is open.
    await page.fill('#new-task-title', 'History Task');
    await page.click('#add-task-btn');
    await expect(page.locator('.task-item')).toHaveCount(1);

    // The new history entry must appear immediately, without closing/reopening
    // the modal (regression check: task creation used to skip the refresh).
    await page.click('#tab-history');
    await expect(page.locator('.history-item').last().locator('.history-text')).toHaveText("Task: Added 'History Task'");
    await page.click('#tab-comments');

    await page.locator('.task-item input[type="checkbox"]').check();

    // Archive — a successful archive closes the modal; reopen from the
    // Archive view (mirrors archive.spec.ts's "unarchive issue via modal").
    await page.click('#archive-issue-btn');
    await page.click('#confirm-ok-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    await navigateTo(page, 'archive');
    await page.click(`.card:has-text("${renamed}")`);
    await expect(page.locator('#unarchive-issue-btn')).toBeVisible();

    // Unarchive — also closes the modal; reopen from the board.
    await page.click('#unarchive-issue-btn');
    await page.click('#confirm-ok-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    await navigateTo(page, 'board');
    await page.click(`.card:has-text("${renamed}")`);

    await page.click('#tab-history');
    const items = page.locator('.history-item');
    await expect(items).toHaveCount(6);
    await expect(items.nth(0).locator('.history-text')).toHaveText('Issue: Created');
    await expect(items.nth(1).locator('.history-text')).toHaveText('Title: Changed');
    await expect(items.nth(2).locator('.history-text')).toHaveText("Task: Added 'History Task'");
    await expect(items.nth(3).locator('.history-text')).toHaveText("Task: Completed 'History Task'");
    await expect(items.nth(4).locator('.history-text')).toHaveText('Issue: Archived');
    await expect(items.nth(5).locator('.history-text')).toHaveText('Issue: Unarchived');
  });
});
