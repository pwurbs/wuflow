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

  test('the new comment editor stays hidden until used and then opens fully in view', async ({ page }) => {
    await createIssue(page, { title: 'Comment Scroll Issue', status: 'Todo' });
    await openIssueByTitle(page, 'Comment Scroll Issue');
    // The modal is shown before the issue data arrives — wait for it.
    await expect(page.locator('#issue-id')).not.toHaveValue('');
    const issueId = await page.inputValue('#issue-id');

    // Enough comments to push the form well below the fold.
    await page.evaluate(async (id) => {
      for (let i = 1; i <= 10; i++) {
        await fetch(`/api/projects/1/issues/${id}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: `Filler comment ${i}` }),
        });
      }
    }, issueId);

    // An existing issue closes via Done (Cancel only exists in create mode).
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();
    await openIssueByTitle(page, 'Comment Scroll Issue');
    await expect(page.locator('.comment-item')).toHaveCount(10);

    // Only viewing so far: no confirm/cancel buttons on the empty field.
    await expect(page.locator('#new-comment-actions')).toBeHidden();

    await page.evaluate(() => document.querySelector('.modal-main-scroll')?.scrollTo({ top: 0 }));
    // focus(), not click(): a click would make Playwright scroll the field
    // into view itself and hide the very behavior under test.
    await page.evaluate(() => document.getElementById('new-comment-body')?.focus());
    await expect(page.locator('#new-comment-actions')).toBeVisible();

    // The whole editor — textarea and button bar — must sit inside the
    // scrollable main column. Polling the overflow in pixels (rather than a
    // boolean) names the failure if it ever regresses.
    await expect.poll(async () => page.evaluate(() => {
      const editor = document.getElementById('new-comment-editor')!.getBoundingClientRect();
      const view = document.querySelector('.modal-main-scroll')!.getBoundingClientRect();
      return Math.round(editor.bottom - view.bottom);
    })).toBeLessThanOrEqual(0);
  });

  test('comment creation, editing and deletion are blocked via API on archived issues', async ({ page }) => {
    await createIssue(page, { title: 'Comment API Archived Issue', status: 'Todo' });
    await openIssueByTitle(page, 'Comment API Archived Issue');

    // Add a comment before archiving, so there's one to try to edit/delete afterwards.
    await page.fill('#new-comment-body', 'Pre-archive comment');
    await page.click('#add-comment-btn');
    await waitForToast(page, 'Comment added');
    const issueId = await page.inputValue('#issue-id');
    const commentId = await page.evaluate(async (id) => {
      const resp = await fetch(`/api/projects/1/issues/${id}/comments`);
      const comments = await resp.json();
      return comments[0].id;
    }, issueId);

    // Archive closes the modal; reopen from the Archive view.
    await page.click('#archive-issue-btn');
    await page.click('#confirm-ok-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();
    await navigateTo(page, 'archive');
    await page.click('.card:has-text("Comment API Archived Issue")');
    await expect(page.locator('#issue-modal')).toBeVisible();

    const statuses = await page.evaluate(
      async ({ issueId, commentId }) => {
        const create = await fetch(`/api/projects/1/issues/${issueId}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: 'Should not be allowed' }),
        });
        const edit = await fetch(`/api/projects/1/issues/${issueId}/comments/${commentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: 'Should not be editable' }),
        });
        const del = await fetch(`/api/projects/1/issues/${issueId}/comments/${commentId}`, {
          method: 'DELETE',
        });
        return { create: create.status, edit: edit.status, del: del.status };
      },
      { issueId, commentId }
    );

    expect(statuses.create).toBe(403);
    expect(statuses.edit).toBe(403);
    expect(statuses.del).toBe(403);

    // The original comment survives untouched.
    const comments = await page.evaluate(async (id) => {
      const resp = await fetch(`/api/projects/1/issues/${id}/comments`);
      return resp.json();
    }, issueId);
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toBe('Pre-archive comment');
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
