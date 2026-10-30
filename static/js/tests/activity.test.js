import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupActivity, loadActivity, refreshHistory, getOpenCommentDraft, closeCommentEditors } from '../components/activity.js';
import * as api from '../api.js';
import { state } from '../state.js';
import * as utils from '../utils.js';

vi.mock('../api.js', () => ({
  fetchHistory: vi.fn(),
  fetchComments: vi.fn(),
  createComment: vi.fn(),
  updateComment: vi.fn(),
  deleteComment: vi.fn()
}));

vi.mock('../state.js', () => ({
  state: { currentUser: { id: 1, role: 'user' } }
}));

vi.mock('../utils.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    escapeHtml: vi.fn(s => s),
    formatDateTime: vi.fn(dateStr => `formatted:${dateStr}`),
    getUserInitials: vi.fn(user => {
      if (!user) return '??';
      return ((user.first_name?.[0] || '') + (user.last_name?.[0] || '')).toUpperCase() || '??';
    }),
    showNotification: vi.fn(),
    showConfirm: vi.fn(),
    initCharCounter: vi.fn(() => ({ show: vi.fn(), hide: vi.fn() })),
    // Real implementation — the list auto-continue tests assert on its actual behavior.
    continueListOnEnter: actual.continueListOnEnter,
    guardSubmit: actual.guardSubmit,
    // Discards without asking; tests that need the question override it.
    confirmDiscard: vi.fn(async () => true)
  };
});

vi.mock('../markdown.js', () => ({
  renderMarkdown: vi.fn(md => `<p>${md}</p>`)
}));

vi.mock('../status-config.js', () => ({
  getStatusLabel: vi.fn(key => ({ Stage1: 'Working', Done: 'Done', Open: 'Open' }[key] || key))
}));

vi.mock('../permissions.js', () => ({
  userCan: vi.fn(() => true),
  isCommentModerator: vi.fn(user => user?.role === 'admin' || user?.role === 'sysadmin'),
  ACTION_CREATE_COMMENT: 'comment:create',
  ACTION_UPDATE_COMMENT: 'comment:update',
  ACTION_DELETE_COMMENT: 'comment:delete'
}));

const issue = { id: 1, project_id: 7, status: 'Open' };

function domFixture() {
  document.body.innerHTML = `
    <div id="activity-section" class="hidden">
      <div class="activity-tabs">
        <button id="tab-comments" class="activity-tab active"></button>
        <button id="tab-history" class="activity-tab"></button>
      </div>
      <ul id="comment-list" class="comment-list"></ul>
      <ul id="history-list" class="history-timeline hidden"></ul>
      <div id="comment-form-container">
        <div id="new-comment-editor" class="comment-editor-container">
          <div class="comment-input-wrapper">
            <textarea id="new-comment-body"></textarea>
          </div>
          <div id="new-comment-actions" class="comment-edit-actions hidden">
            <button id="cancel-comment-btn" type="button"></button>
            <button id="add-comment-btn" type="button"></button>
          </div>
        </div>
      </div>
    </div>
  `;
}

describe('Activity Component', () => {
  beforeEach(() => {
    domFixture();
    vi.clearAllMocks();
    state.currentUser = { id: 1, role: 'user' };
    api.fetchHistory.mockResolvedValue([]);
    api.fetchComments.mockResolvedValue([]);
    setupActivity();
  });

  it('unhides the activity section and defaults to the Comments tab', async () => {
    await loadActivity(issue);
    expect(document.getElementById('activity-section').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('tab-comments').classList.contains('active')).toBe(true);
    expect(document.getElementById('comment-list').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('history-list').classList.contains('hidden')).toBe(true);
  });

  it('fetches history and comments scoped to the issue', async () => {
    await loadActivity(issue);
    expect(api.fetchHistory).toHaveBeenCalledWith(7, 1);
    expect(api.fetchComments).toHaveBeenCalledWith(7, 1);
  });

  it('renders an empty state when there are no comments', async () => {
    await loadActivity(issue);
    const list = document.getElementById('comment-list');
    expect(list.querySelector('.activity-empty').textContent).toBe('No comments yet.');
  });

  it('renders comments with author, timestamp, and sanitized markdown body', async () => {
    api.fetchComments.mockResolvedValue([
      { id: 1, user_id: 2, user: { first_name: 'Ann', last_name: 'Thor' }, body: '**bold**', edited: false, created_at: '2026-01-01T10:00:00Z' }
    ]);
    await loadActivity(issue);

    const item = document.querySelector('.comment-item');
    expect(item.querySelector('.comment-author').textContent).toBe('Ann Thor');
    expect(item.querySelector('.comment-time').textContent).toContain('formatted:2026-01-01T10:00:00Z');
    expect(item.querySelector('.comment-body').innerHTML).toContain('<p>**bold**</p>');
  });

  it('marks an edited comment in its timestamp line, showing the edit time rather than the creation time', async () => {
    api.fetchComments.mockResolvedValue([
      { id: 1, user_id: 2, user: { first_name: 'Ann', last_name: 'Thor' }, body: 'hi', edited: true, created_at: '2026-01-01T10:00:00Z', updated_at: '2026-01-02T11:00:00Z' }
    ]);
    await loadActivity(issue);
    const text = document.querySelector('.comment-time').textContent;
    expect(text).toContain('edited');
    expect(text).toContain('formatted:2026-01-02T11:00:00Z');
    expect(text).not.toContain('formatted:2026-01-01T10:00:00Z');
  });

  it('shows edit/delete actions for the comment author', async () => {
    state.currentUser = { id: 1, role: 'user' };
    api.fetchComments.mockResolvedValue([
      { id: 1, user_id: 1, user: { first_name: 'Me', last_name: 'Self' }, body: 'mine', edited: false, created_at: '2026-01-01T10:00:00Z' }
    ]);
    await loadActivity(issue);
    expect(document.querySelector('.comment-edit-btn')).not.toBeNull();
    expect(document.querySelector('.comment-delete-btn')).not.toBeNull();
  });

  it('hides edit/delete actions for a non-author, non-admin user', async () => {
    state.currentUser = { id: 99, role: 'user' };
    api.fetchComments.mockResolvedValue([
      { id: 1, user_id: 1, user: { first_name: 'Other', last_name: 'User' }, body: 'not mine', edited: false, created_at: '2026-01-01T10:00:00Z' }
    ]);
    await loadActivity(issue);
    expect(document.querySelector('.comment-edit-btn')).toBeNull();
    expect(document.querySelector('.comment-delete-btn')).toBeNull();
  });

  it('shows edit/delete actions for an admin on a comment they do not own', async () => {
    state.currentUser = { id: 99, role: 'admin' };
    api.fetchComments.mockResolvedValue([
      { id: 1, user_id: 1, user: { first_name: 'Other', last_name: 'User' }, body: 'not mine', edited: false, created_at: '2026-01-01T10:00:00Z' }
    ]);
    await loadActivity(issue);
    expect(document.querySelector('.comment-edit-btn')).not.toBeNull();
    expect(document.querySelector('.comment-delete-btn')).not.toBeNull();
  });

  it('switches to the History tab and renders history entries oldest-first as given by the API', async () => {
    api.fetchHistory.mockResolvedValue([
      { id: 1, event: 'created', data: {}, user: { first_name: 'Ann', last_name: 'Thor' }, created_at: '2026-01-01T09:00:00Z' },
      { id: 2, event: 'archived', data: {}, user: { first_name: 'Ann', last_name: 'Thor' }, created_at: '2026-01-02T09:00:00Z' }
    ]);
    await loadActivity(issue);

    document.getElementById('tab-history').click();

    expect(document.getElementById('tab-history').classList.contains('active')).toBe(true);
    expect(document.getElementById('history-list').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('comment-list').classList.contains('hidden')).toBe(true);

    const items = document.querySelectorAll('.history-item');
    expect(items).toHaveLength(2);
    expect(items[0].querySelector('.history-text').textContent).toBe('Issue: Created');
    expect(items[1].querySelector('.history-text').textContent).toBe('Issue: Archived');
  });

  it('renders a friendly sentence for a status change, mapping raw keys to display labels', async () => {
    api.fetchHistory.mockResolvedValue([
      { id: 1, event: 'updated', data: { field: 'status', from: 'Open', to: 'Stage1' }, user: null, created_at: '2026-01-01T09:00:00Z' }
    ]);
    await loadActivity(issue);
    document.getElementById('tab-history').click();
    expect(document.querySelector('.history-text').textContent).toBe('Status: Changed Open → Working');
  });

  it('renders a title/description change without from/to values', async () => {
    api.fetchHistory.mockResolvedValue([
      { id: 1, event: 'updated', data: { field: 'title' }, user: null, created_at: '2026-01-01T09:00:00Z' }
    ]);
    await loadActivity(issue);
    document.getElementById('tab-history').click();
    expect(document.querySelector('.history-text').textContent).toBe('Title: Changed');
  });

  it('renders the task change detail verbatim', async () => {
    api.fetchHistory.mockResolvedValue([
      { id: 1, event: 'task', data: { field: 'task_added', detail: "Task: Added 'Foo'" }, user: null, created_at: '2026-01-01T09:00:00Z' }
    ]);
    await loadActivity(issue);
    document.getElementById('tab-history').click();
    expect(document.querySelector('.history-text').textContent).toBe("Task: Added 'Foo'");
  });

  it('renders a move event with old/new project names and a reset note', async () => {
    api.fetchHistory.mockResolvedValue([
      { id: 1, event: 'moved', data: { field: 'project', from: 'Alpha', to: 'Beta' }, user: null, created_at: '2026-01-01T09:00:00Z' }
    ]);
    await loadActivity(issue);
    document.getElementById('tab-history').click();
    expect(document.querySelector('.history-text').textContent).toBe('Project: Moved Alpha → Beta (label, release, and status were reset)');
  });

  it('picks the marker icon category from the event (and task field for task events)', async () => {
    api.fetchHistory.mockResolvedValue([
      { id: 1, event: 'created', data: {}, user: null, created_at: '2026-01-01T09:00:00Z' },
      { id: 2, event: 'updated', data: { field: 'status', from: 'Open', to: 'Stage1' }, user: null, created_at: '2026-01-02T09:00:00Z' },
      { id: 3, event: 'archived', data: {}, user: null, created_at: '2026-01-03T09:00:00Z' },
      { id: 4, event: 'moved', data: { field: 'project', from: 'Alpha', to: 'Beta' }, user: null, created_at: '2026-01-04T09:00:00Z' },
      { id: 5, event: 'task', data: { field: 'task_added', detail: "Task: Added 'Foo'" }, user: null, created_at: '2026-01-05T09:00:00Z' },
      { id: 6, event: 'task', data: { field: 'task_completed', detail: "Task: Completed 'Foo'" }, user: null, created_at: '2026-01-06T09:00:00Z' },
      { id: 7, event: 'task', data: { field: 'task_deleted', detail: "Task: Deleted 'Foo'" }, user: null, created_at: '2026-01-07T09:00:00Z' }
    ]);
    await loadActivity(issue);
    document.getElementById('tab-history').click();

    const categories = [...document.querySelectorAll('.history-marker')].map(m => m.dataset.category);
    expect(categories).toEqual(['creation', 'change', 'change', 'change', 'addition', 'change', 'deletion']);
  });

  it('renders an empty state when there is no history', async () => {
    await loadActivity(issue);
    document.getElementById('tab-history').click();
    expect(document.querySelector('#history-list .activity-empty').textContent).toBe('No history yet.');
  });

  it('hides the comment form on archived issues', async () => {
    await loadActivity({ ...issue, status: 'Archive' });
    expect(document.getElementById('comment-form-container').classList.contains('hidden')).toBe(true);
  });

  it('greys out the comments of an archived issue, but not those of an open one', async () => {
    api.fetchComments.mockResolvedValue([
      { id: 1, user_id: 1, user: { first_name: 'Me', last_name: 'Self' }, body: 'first', edited: false, created_at: '2026-01-01T09:00:00Z' }
    ]);
    await loadActivity({ ...issue, status: 'Archive' });
    expect(document.querySelector('.comment-item').getAttribute('aria-disabled')).toBe('true');

    await loadActivity(issue);
    expect(document.querySelector('.comment-item').hasAttribute('aria-disabled')).toBe(false);
  });

  it.each([['an open', 'Open'], ['an archived', 'Archive']])('opens a link in a comment of %s issue in a new tab instead of leaving the app', async (_label, status) => {
    api.fetchComments.mockResolvedValue([
      { id: 1, user_id: 1, user: { first_name: 'Me', last_name: 'Self' }, body: 'see [docs](https://example.com/a)', edited: false, created_at: '2026-01-01T09:00:00Z' }
    ]);
    const marked = await import('../markdown.js');
    marked.renderMarkdown.mockReturnValueOnce('<p>see <a href="https://example.com/a"><span>docs</span></a></p>');
    await loadActivity({ ...issue, status });
    const openSpy = vi.spyOn(globalThis, 'open').mockImplementation(() => ({}));

    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.querySelector('.comment-body span').dispatchEvent(click);

    expect(openSpy).toHaveBeenCalledWith('https://example.com/a', '_blank', 'noopener,noreferrer');
    expect(click.defaultPrevented).toBe(true);
    openSpy.mockRestore();
  });

  it('shows the comment form on a non-archived issue', async () => {
    await loadActivity(issue);
    expect(document.getElementById('comment-form-container').classList.contains('hidden')).toBe(false);
  });

  it('submits a new comment and refreshes the list', async () => {
    api.createComment.mockResolvedValue({ id: 5 });
    api.fetchComments
      .mockResolvedValueOnce([]) // initial load
      .mockResolvedValueOnce([{ id: 5, user_id: 1, user: { first_name: 'Me', last_name: 'Self' }, body: 'new comment', edited: false, created_at: '2026-01-03T09:00:00Z' }]);

    await loadActivity(issue);

    const input = document.getElementById('new-comment-body');
    input.value = 'new comment';
    document.getElementById('add-comment-btn').click();

    await new Promise(process.nextTick);
    await new Promise(process.nextTick);

    expect(api.createComment).toHaveBeenCalledWith(7, 1, 'new comment');
    expect(utils.showNotification).toHaveBeenCalledWith('Comment added');
    expect(document.querySelectorAll('.comment-item')).toHaveLength(1);
  });

  it('posts a new comment only once while the first submit is in flight, with the editor greyed out', async () => {
    let resolveCreate;
    api.createComment.mockReturnValue(new Promise(r => { resolveCreate = r; }));
    await loadActivity(issue);

    const editor = document.getElementById('new-comment-editor');
    const input = document.getElementById('new-comment-body');
    const addBtn = document.getElementById('add-comment-btn');
    input.value = 'new comment';
    addBtn.click();
    expect(editor.getAttribute('aria-busy')).toBe('true');
    // A second ✓ (e.g. a stale handler) and Ctrl+Enter must not post again.
    addBtn.click();
    input.dispatchEvent(new globalThis.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, cancelable: true }));

    resolveCreate({ id: 5 });
    await new Promise(process.nextTick);
    await new Promise(process.nextTick);

    expect(api.createComment).toHaveBeenCalledTimes(1);
    expect(editor.hasAttribute('aria-busy')).toBe(false);
  });

  it('saves an edited comment only once while the first save is in flight, with the editor greyed out', async () => {
    api.fetchComments.mockResolvedValue([
      { id: 1, user_id: 1, user: { first_name: 'Me', last_name: 'Self' }, body: 'original', edited: false, created_at: '2026-01-01T09:00:00Z' }
    ]);
    let resolveUpdate;
    api.updateComment.mockReturnValue(new Promise(r => { resolveUpdate = r; }));
    await loadActivity(issue);

    document.querySelector('.comment-edit-btn').click();
    const textarea = document.querySelector('.comment-edit-input');
    const save = document.querySelector('#comment-list .inline-save-btn');
    textarea.value = 'changed';
    save.click();
    expect(textarea.closest('.comment-editor-container').getAttribute('aria-busy')).toBe('true');
    save.dispatchEvent(new MouseEvent('click')); // a second ✓, e.g. from a stale handler

    resolveUpdate({});
    await new Promise(process.nextTick);
    await new Promise(process.nextTick);

    expect(api.updateComment).toHaveBeenCalledTimes(1);
  });

  it('re-enables ✓ after a failed submit so the user can retry', async () => {
    api.createComment.mockRejectedValue(new Error('Network error'));
    await loadActivity(issue);

    document.getElementById('new-comment-body').value = 'new comment';
    const addBtn = document.getElementById('add-comment-btn');
    addBtn.click();
    await new Promise(process.nextTick);

    expect(utils.showNotification).toHaveBeenCalledWith('Network error', 'error');
    expect(addBtn.disabled).toBe(false);
    expect(document.getElementById('new-comment-body').value).toBe('new comment');
  });

  it('auto-continues a bullet list on Enter in the new-comment textarea', async () => {
    await loadActivity(issue);
    const input = document.getElementById('new-comment-body');
    input.value = '- first item';
    input.selectionStart = input.selectionEnd = input.value.length;
    const event = new globalThis.KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    vi.spyOn(event, 'preventDefault');
    input.dispatchEvent(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(input.value).toBe('- first item\n- ');
  });

  it('shows an error notification and does not call the API when submitting an empty comment', async () => {
    await loadActivity(issue);
    document.getElementById('new-comment-body').value = '   ';
    document.getElementById('add-comment-btn').click();

    await new Promise(process.nextTick);

    expect(api.createComment).not.toHaveBeenCalled();
    expect(utils.showNotification).toHaveBeenCalledWith('Comment must not be empty', 'error');
  });

  it('keeps the new-comment ✓/✕ bar hidden until the field is focused', async () => {
    await loadActivity(issue);
    const actions = document.getElementById('new-comment-actions');
    expect(actions.classList.contains('hidden')).toBe(true);

    document.getElementById('new-comment-body').focus();
    expect(actions.classList.contains('hidden')).toBe(false);
    // The counter is driven by the open state, not by focus.
    expect(utils.initCharCounter).toHaveBeenCalledWith(document.getElementById('new-comment-body'), 1000, { manual: true });
    expect(utils.initCharCounter.mock.results[0].value.show).toHaveBeenCalled();
  });

  it('scrolls the whole new-comment editor into view when it opens and when it grows', async () => {
    // jsdom has neither scrollIntoView nor layout; the component skips the
    // call without the former and reads offsetHeight to detect growth.
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(cb => { cb(); return 0; });
    const editorBox = document.getElementById('new-comment-editor');
    const setHeight = h => Object.defineProperty(editorBox, 'offsetHeight', { configurable: true, value: h });

    try {
      setHeight(60);
      await loadActivity(issue);
      const input = document.getElementById('new-comment-body');
      input.focus();

      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView.mock.instances[0]).toBe(editorBox);
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' });

      // Typing that doesn't wrap leaves the box the same height — no need to
      // restart the scroll animation.
      input.value = 'line one';
      input.dispatchEvent(new Event('input'));
      expect(scrollIntoView).toHaveBeenCalledTimes(1);

      // A line wrap grows it (field-sizing: content), pushing the action bar
      // out of sight again.
      setHeight(80);
      input.value = 'line one\nline two';
      input.dispatchEvent(new Event('input'));
      expect(scrollIntoView).toHaveBeenCalledTimes(2);
    } finally {
      rafSpy.mockRestore();
      delete HTMLElement.prototype.scrollIntoView;
    }
  });

  it('collapses the new-comment form again when it is left empty', async () => {
    await loadActivity(issue);
    const input = document.getElementById('new-comment-body');
    input.focus();
    input.blur();
    expect(document.getElementById('new-comment-actions').classList.contains('hidden')).toBe(true);
  });

  it('keeps the new-comment form open on blur when a draft was typed', async () => {
    await loadActivity(issue);
    const input = document.getElementById('new-comment-body');
    input.focus();
    input.value = 'draft';
    input.blur();
    expect(document.getElementById('new-comment-actions').classList.contains('hidden')).toBe(false);
  });

  it('discards the draft and collapses the form when cancelled', async () => {
    await loadActivity(issue);
    const input = document.getElementById('new-comment-body');
    input.focus();
    input.value = 'draft';
    document.getElementById('cancel-comment-btn').click();
    await new Promise(process.nextTick); // ✕ asks before discarding changed text

    expect(input.value).toBe('');
    expect(document.getElementById('new-comment-actions').classList.contains('hidden')).toBe(true);
  });

  it('clears a draft left over from a previously opened issue', async () => {
    await loadActivity(issue);
    const input = document.getElementById('new-comment-body');
    input.focus();
    input.value = 'draft';
    input.blur(); // a draft keeps the form open even unfocused

    await loadActivity({ ...issue, id: 2 });

    expect(input.value).toBe('');
    expect(document.getElementById('new-comment-actions').classList.contains('hidden')).toBe(true);
  });

  it('hides every comment\'s edit/delete actions while a new comment is open, and restores them after submitting', async () => {
    api.createComment.mockResolvedValue({ id: 5 });
    api.fetchComments.mockResolvedValue([
      { id: 1, user_id: 1, user: { first_name: 'Me', last_name: 'Self' }, body: 'first', edited: false, created_at: '2026-01-01T09:00:00Z' }
    ]);
    await loadActivity(issue);

    const input = document.getElementById('new-comment-body');
    input.focus();
    expect(document.querySelector('.comment-actions').classList.contains('actions-hidden')).toBe(true);

    input.value = 'new comment';
    document.getElementById('add-comment-btn').click();
    await new Promise(process.nextTick);
    await new Promise(process.nextTick);

    expect(document.getElementById('new-comment-actions').classList.contains('hidden')).toBe(true);
    expect(document.querySelector('.comment-actions').classList.contains('actions-hidden')).toBe(false);
  });

  it('re-applies the hidden comment actions after a tab switch while a new comment is open', async () => {
    api.fetchComments.mockResolvedValue([
      { id: 1, user_id: 1, user: { first_name: 'Me', last_name: 'Self' }, body: 'first', edited: false, created_at: '2026-01-01T09:00:00Z' }
    ]);
    await loadActivity(issue);

    const input = document.getElementById('new-comment-body');
    input.focus();
    input.value = 'draft';
    document.getElementById('tab-history').click();
    document.getElementById('tab-comments').click();

    expect(document.querySelector('.comment-actions').classList.contains('actions-hidden')).toBe(true);
  });

  it('blocks editing an existing comment while a new comment is unconfirmed', async () => {
    api.fetchComments.mockResolvedValue([
      { id: 1, user_id: 1, user: { first_name: 'Me', last_name: 'Self' }, body: 'first', edited: false, created_at: '2026-01-01T09:00:00Z' }
    ]);
    await loadActivity(issue);

    const input = document.getElementById('new-comment-body');
    input.focus();
    input.value = 'draft';
    document.querySelector('.comment-edit-btn').click();

    expect(utils.showNotification).toHaveBeenCalledWith('Finish the new comment first', 'error');
    expect(document.querySelector('.comment-edit-input')).toBeNull();
  });

  // readOnly is the whole blocked state — the dimming is derived from it in
  // CSS (:has([readonly])), so there's no separate class to assert.
  it.each([
    ['cancelled', '#comment-list .inline-cancel-btn'],
    ['saved', '#comment-list .inline-save-btn']
  ])('blocks the new-comment form while an existing comment is being edited, and restores it once %s', async (_label, finishBtn) => {
    api.fetchComments.mockResolvedValue([
      { id: 1, user_id: 1, user: { first_name: 'Me', last_name: 'Self' }, body: 'original', edited: false, created_at: '2026-01-01T09:00:00Z' }
    ]);
    api.updateComment.mockResolvedValue({});
    await loadActivity(issue);

    const input = document.getElementById('new-comment-body');
    const editor = document.getElementById('new-comment-editor');
    document.querySelector('.comment-edit-btn').click();
    expect(input.readOnly).toBe(true);
    expect(editor.getAttribute('aria-disabled')).toBe('true');

    document.querySelector('.comment-edit-input').value = 'updated';
    document.querySelector(finishBtn).click();
    await new Promise(process.nextTick);
    await new Promise(process.nextTick);

    expect(input.readOnly).toBe(false);
    expect(editor.hasAttribute('aria-disabled')).toBe(false);
  });

  it('deletes a comment after confirmation and refreshes the list', async () => {
    api.fetchComments
      .mockResolvedValueOnce([{ id: 1, user_id: 1, user: { first_name: 'Me', last_name: 'Self' }, body: 'mine', edited: false, created_at: '2026-01-01T09:00:00Z' }])
      .mockResolvedValueOnce([]);
    utils.showConfirm.mockResolvedValue(true);
    api.deleteComment.mockResolvedValue();

    await loadActivity(issue);
    document.querySelector('.comment-delete-btn').click();

    await new Promise(process.nextTick);
    await new Promise(process.nextTick);

    expect(api.deleteComment).toHaveBeenCalledWith(7, 1, 1);
    expect(utils.showNotification).toHaveBeenCalledWith('Comment deleted');
    expect(document.querySelectorAll('.comment-item')).toHaveLength(0);
  });

  it('does not delete when the user cancels the confirmation', async () => {
    api.fetchComments.mockResolvedValue([
      { id: 1, user_id: 1, user: { first_name: 'Me', last_name: 'Self' }, body: 'mine', edited: false, created_at: '2026-01-01T09:00:00Z' }
    ]);
    utils.showConfirm.mockResolvedValue(false);

    await loadActivity(issue);
    document.querySelector('.comment-delete-btn').click();

    await new Promise(process.nextTick);

    expect(api.deleteComment).not.toHaveBeenCalled();
  });

  it('enters inline edit mode and saves an edited comment', async () => {
    api.fetchComments
      .mockResolvedValueOnce([{ id: 1, user_id: 1, user: { first_name: 'Me', last_name: 'Self' }, body: 'original', edited: false, created_at: '2026-01-01T09:00:00Z' }])
      .mockResolvedValueOnce([{ id: 1, user_id: 1, user: { first_name: 'Me', last_name: 'Self' }, body: 'edited text', edited: true, created_at: '2026-01-01T09:00:00Z', updated_at: '2026-01-01T09:05:00Z' }]);
    api.updateComment.mockResolvedValue({});

    await loadActivity(issue);
    document.querySelector('.comment-edit-btn').click();

    const textarea = document.querySelector('.comment-edit-input');
    expect(textarea).not.toBeNull();
    textarea.value = 'edited text';
    document.querySelector('#comment-list .inline-save-btn').click();

    await new Promise(process.nextTick);
    await new Promise(process.nextTick);

    expect(api.updateComment).toHaveBeenCalledWith(7, 1, 1, 'edited text');
    expect(utils.showNotification).toHaveBeenCalledWith('Comment updated');
    // Re-rendered from the refreshed comment list, with the edited marker shown.
    expect(document.querySelector('.comment-body').innerHTML).toContain('edited text');
    expect(document.querySelector('.comment-time').textContent).toContain('edited');
  });

  it('auto-continues a numbered list on Enter in the inline comment editor', async () => {
    api.fetchComments.mockResolvedValue([
      { id: 1, user_id: 1, user: { first_name: 'Me', last_name: 'Self' }, body: 'original', edited: false, created_at: '2026-01-01T09:00:00Z' }
    ]);

    await loadActivity(issue);
    document.querySelector('.comment-edit-btn').click();

    const textarea = document.querySelector('.comment-edit-input');
    textarea.value = '1. first item';
    textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
    const event = new globalThis.KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    vi.spyOn(event, 'preventDefault');
    textarea.dispatchEvent(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(textarea.value).toBe('1. first item\n2. ');
  });

  it('gives the inline comment editor its own visible character counter', async () => {
    api.fetchComments.mockResolvedValue([
      { id: 1, user_id: 1, user: { first_name: 'Me', last_name: 'Self' }, body: 'original', edited: false, created_at: '2026-01-01T09:00:00Z' }
    ]);

    await loadActivity(issue);
    document.querySelector('.comment-edit-btn').click();

    const textarea = document.querySelector('.comment-edit-input');
    expect(utils.initCharCounter).toHaveBeenCalledWith(textarea, 1000, { manual: true });
    const result = utils.initCharCounter.mock.results.at(-1).value;
    expect(result.show).toHaveBeenCalled();
  });

  it('cancels inline edit mode without calling the API', async () => {
    api.fetchComments.mockResolvedValue([
      { id: 1, user_id: 1, user: { first_name: 'Me', last_name: 'Self' }, body: 'original', edited: false, created_at: '2026-01-01T09:00:00Z' }
    ]);

    await loadActivity(issue);
    document.querySelector('.comment-edit-btn').click();
    document.querySelector('#comment-list .inline-cancel-btn').click();
    await new Promise(process.nextTick); // ✕ asks before discarding changed text

    expect(api.updateComment).not.toHaveBeenCalled();
    expect(document.querySelector('.comment-edit-input')).toBeNull();
  });

  it('shows an error notification on a failed fetch', async () => {
    api.fetchHistory.mockRejectedValue(new Error('network down'));
    api.fetchComments.mockResolvedValue([]);
    await loadActivity(issue);
    expect(utils.showNotification).toHaveBeenCalledWith('network down', 'error');
  });

  it('hides edit/delete actions on other comments while one is being edited, and restores them on cancel', async () => {
    api.fetchComments.mockResolvedValue([
      { id: 1, user_id: 1, user: { first_name: 'Me', last_name: 'Self' }, body: 'first', edited: false, created_at: '2026-01-01T09:00:00Z' },
      { id: 2, user_id: 1, user: { first_name: 'Me', last_name: 'Self' }, body: 'second', edited: false, created_at: '2026-01-02T09:00:00Z' }
    ]);
    await loadActivity(issue);

    const items = document.querySelectorAll('.comment-item');
    items[0].querySelector('.comment-edit-btn').click();
    expect(items[1].querySelector('.comment-actions').classList.contains('actions-hidden')).toBe(true);

    document.querySelector('#comment-list .inline-cancel-btn').click();
    await new Promise(process.nextTick); // ✕ asks before discarding changed text
    expect(document.querySelectorAll('.comment-item')[1].querySelector('.comment-actions').classList.contains('actions-hidden')).toBe(false);
  });

  it('blocks editing a second comment while another is already being edited', async () => {
    api.fetchComments.mockResolvedValue([
      { id: 1, user_id: 1, user: { first_name: 'Me', last_name: 'Self' }, body: 'first', edited: false, created_at: '2026-01-01T09:00:00Z' },
      { id: 2, user_id: 1, user: { first_name: 'Me', last_name: 'Self' }, body: 'second', edited: false, created_at: '2026-01-02T09:00:00Z' }
    ]);
    await loadActivity(issue);

    const items = document.querySelectorAll('.comment-item');
    items[0].querySelector('.comment-edit-btn').click();
    items[1].querySelector('.comment-edit-btn').click();

    expect(utils.showNotification).toHaveBeenCalledWith('Finish editing the other comment first', 'error');
    expect(document.querySelectorAll('.comment-edit-input')).toHaveLength(1);
  });

  it('shows an error notification when saving an edited comment fails', async () => {
    api.fetchComments.mockResolvedValue([
      { id: 1, user_id: 1, user: { first_name: 'Me', last_name: 'Self' }, body: 'original', edited: false, created_at: '2026-01-01T09:00:00Z' }
    ]);
    api.updateComment.mockRejectedValue(new Error('save failed'));

    await loadActivity(issue);
    document.querySelector('.comment-edit-btn').click();

    const textarea = document.querySelector('.comment-edit-input');
    textarea.value = 'edited text';
    document.querySelector('#comment-list .inline-save-btn').click();

    await new Promise(process.nextTick);

    expect(utils.showNotification).toHaveBeenCalledWith('save failed', 'error');
    // Edit mode is left open so the user doesn't lose their unsaved text.
    expect(document.querySelector('.comment-edit-input')).not.toBeNull();
  });

  it('shows an error notification when deleting a comment fails', async () => {
    api.fetchComments.mockResolvedValue([
      { id: 1, user_id: 1, user: { first_name: 'Me', last_name: 'Self' }, body: 'mine', edited: false, created_at: '2026-01-01T09:00:00Z' }
    ]);
    utils.showConfirm.mockResolvedValue(true);
    api.deleteComment.mockRejectedValue(new Error('delete failed'));

    await loadActivity(issue);
    document.querySelector('.comment-delete-btn').click();

    await new Promise(process.nextTick);
    await new Promise(process.nextTick);

    expect(utils.showNotification).toHaveBeenCalledWith('delete failed', 'error');
  });

  it('shows an error notification when submitting a new comment fails', async () => {
    api.createComment.mockRejectedValue(new Error('create failed'));

    await loadActivity(issue);
    document.getElementById('new-comment-body').value = 'new comment';
    document.getElementById('add-comment-btn').click();

    await new Promise(process.nextTick);

    expect(utils.showNotification).toHaveBeenCalledWith('create failed', 'error');
  });

  it('shows an error notification when the comment list re-fetch fails after a successful create', async () => {
    api.createComment.mockResolvedValue({ id: 5 });
    api.fetchComments
      .mockResolvedValueOnce([]) // initial load
      .mockRejectedValueOnce(new Error('refresh failed'));

    await loadActivity(issue);
    document.getElementById('new-comment-body').value = 'new comment';
    document.getElementById('add-comment-btn').click();

    await new Promise(process.nextTick);
    await new Promise(process.nextTick);

    expect(utils.showNotification).toHaveBeenCalledWith('refresh failed', 'error');
  });

  // docs/frontend.md "Editing Fields"
  describe('editor keys and drafts', () => {
    const key = (el, k, opts = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
    const tick = async () => { for (let i = 0; i < 3; i++) await new Promise(process.nextTick); };
    const oneComment = () => api.fetchComments.mockResolvedValue([
      { id: 1, user_id: 1, user: { first_name: 'Me', last_name: 'Self' }, body: 'original', edited: false, created_at: '2026-01-01T09:00:00Z' }
    ]);

    it('discards the new comment with Escape, asking because text was typed', async () => {
      await loadActivity(issue);
      const input = document.getElementById('new-comment-body');
      input.focus();
      input.value = 'draft';

      utils.confirmDiscard.mockResolvedValueOnce(false); // Keep editing
      key(input, 'Escape');
      await tick();
      expect(utils.confirmDiscard).toHaveBeenLastCalledWith(true);
      expect(input.value).toBe('draft');

      key(input, 'Escape');
      await tick();
      expect(input.value).toBe('');
      expect(document.getElementById('new-comment-actions').classList.contains('hidden')).toBe(true);
    });

    it('saves an edited comment with Cmd/Ctrl+Enter', async () => {
      oneComment();
      api.updateComment.mockResolvedValue({});
      await loadActivity(issue);
      document.querySelector('.comment-edit-btn').click();
      const textarea = document.querySelector('.comment-edit-input');
      textarea.value = 'changed';

      key(textarea, 'Enter', { ctrlKey: true });
      await tick();

      expect(api.updateComment).toHaveBeenCalledWith(7, 1, 1, 'changed');
    });

    it('cancels an edited comment with Escape or ✕, asking only when the text was changed', async () => {
      oneComment();
      await loadActivity(issue);

      document.querySelector('.comment-edit-btn').click();
      key(document.querySelector('.comment-edit-input'), 'Escape');
      await tick();
      expect(utils.confirmDiscard).toHaveBeenLastCalledWith(false);
      expect(document.querySelector('.comment-edit-input')).toBeNull();

      document.querySelector('.comment-edit-btn').click();
      document.querySelector('.comment-edit-input').value = 'changed';
      utils.confirmDiscard.mockResolvedValueOnce(false); // Keep editing
      document.querySelector('#comment-list .inline-cancel-btn').click();
      await tick();
      expect(utils.confirmDiscard).toHaveBeenLastCalledWith(true);
      expect(document.querySelector('.comment-edit-input').value).toBe('changed');
      expect(api.updateComment).not.toHaveBeenCalled();
    });

    it('offers the open new comment as a draft whose save reports success', async () => {
      api.createComment.mockResolvedValue({ id: 5 });
      await loadActivity(issue);
      expect(getOpenCommentDraft()).toBeNull();

      const input = document.getElementById('new-comment-body');
      input.focus();
      expect(getOpenCommentDraft().changed).toBe(false);
      input.value = 'draft';
      const draft = getOpenCommentDraft();
      expect(draft.changed).toBe(true);

      expect(await draft.save()).toBe(true);
      expect(api.createComment).toHaveBeenCalledWith(7, 1, 'draft');
      expect(getOpenCommentDraft()).toBeNull();
    });

    it('reports a failed draft save as false and keeps the editor open', async () => {
      oneComment();
      api.updateComment.mockRejectedValue(new Error('Network error'));
      await loadActivity(issue);
      document.querySelector('.comment-edit-btn').click();
      document.querySelector('.comment-edit-input').value = 'changed';

      const draft = getOpenCommentDraft();
      expect(draft.changed).toBe(true);
      expect(await draft.save()).toBe(false);
      expect(getOpenCommentDraft()).not.toBeNull();
    });

    it('closes an open comment editor without saving and tells the modal', async () => {
      oneComment();
      const onEditEnd = vi.fn();
      await loadActivity(issue, { onEditStart: vi.fn(), onEditEnd });
      document.querySelector('.comment-edit-btn').click();
      document.querySelector('.comment-edit-input').value = 'changed';

      closeCommentEditors();

      expect(getOpenCommentDraft()).toBeNull();
      expect(onEditEnd).toHaveBeenCalled();
      expect(document.querySelector('.comment-edit-input')).toBeNull();
      expect(document.getElementById('new-comment-editor').hasAttribute('aria-disabled')).toBe(false);
      expect(api.updateComment).not.toHaveBeenCalled();
    });
  });

  describe('history sentence text for less common event and field types', () => {
    it('renders an unarchived event', async () => {
      api.fetchHistory.mockResolvedValue([
        { id: 1, event: 'unarchived', data: {}, user: null, created_at: '2026-01-01T09:00:00Z' }
      ]);
      await loadActivity(issue);
      document.getElementById('tab-history').click();
      expect(document.querySelector('.history-text').textContent).toBe('Issue: Unarchived');
    });

    it('falls back to the raw event name for an unrecognized event type', async () => {
      api.fetchHistory.mockResolvedValue([
        { id: 1, event: 'some_future_event', data: {}, user: null, created_at: '2026-01-01T09:00:00Z' }
      ]);
      await loadActivity(issue);
      document.getElementById('tab-history').click();
      expect(document.querySelector('.history-text').textContent).toBe('some_future_event');
    });

    it.each([
      ['description', {}, 'Description: Changed'],
      ['priority', { from: 'Low', to: 'High' }, 'Priority: Changed Low → High'],
      ['deadline', { from: '2026-01-01', to: '2026-02-01' }, 'Deadline: Changed 2026-01-01 → 2026-02-01'],
      ['assignee', { from: 'Ann', to: 'Bob' }, 'Assignee: Changed Ann → Bob'],
      ['label', { from: 'Bug', to: 'Feature' }, 'Label: Changed Bug → Feature'],
      ['release', { from: 'v1', to: 'v2' }, 'Release: Changed v1 → v2']
    ])('renders a %s change sentence', async (field, fromTo, expected) => {
      api.fetchHistory.mockResolvedValue([
        { id: 1, event: 'updated', data: { field, ...fromTo }, user: null, created_at: '2026-01-01T09:00:00Z' }
      ]);
      await loadActivity(issue);
      document.getElementById('tab-history').click();
      expect(document.querySelector('.history-text').textContent).toBe(expected);
    });

    it('falls back to a generic "Issue: Updated" sentence for an unrecognized field', async () => {
      api.fetchHistory.mockResolvedValue([
        { id: 1, event: 'updated', data: { field: 'some_future_field' }, user: null, created_at: '2026-01-01T09:00:00Z' }
      ]);
      await loadActivity(issue);
      document.getElementById('tab-history').click();
      expect(document.querySelector('.history-text').textContent).toBe('Issue: Updated');
    });
  });

  describe('refreshHistory', () => {
    it('re-fetches and re-renders the History tab for the currently loaded issue', async () => {
      api.fetchHistory.mockResolvedValueOnce([]);
      await loadActivity(issue);
      document.getElementById('tab-history').click();
      expect(document.querySelectorAll('.history-item')).toHaveLength(0);

      api.fetchHistory.mockResolvedValueOnce([
        { id: 1, event: 'created', data: {}, user: null, created_at: '2026-01-01T09:00:00Z' }
      ]);
      await refreshHistory();

      expect(api.fetchHistory).toHaveBeenCalledWith(7, 1);
      expect(document.querySelectorAll('.history-item')).toHaveLength(1);
    });

    it('shows an error notification when the re-fetch fails', async () => {
      api.fetchHistory.mockResolvedValueOnce([]);
      await loadActivity(issue);

      api.fetchHistory.mockRejectedValueOnce(new Error('history refresh failed'));
      await refreshHistory();

      expect(utils.showNotification).toHaveBeenCalledWith('history refresh failed', 'error');
    });

    it('discards a stale result if a newer loadActivity call resolves first', async () => {
      // Baseline load for the original issue (id 1).
      api.fetchHistory.mockResolvedValueOnce([]);
      await loadActivity(issue);

      // Simulate a background refresh (e.g. from a field save) whose request is
      // still in flight — we control exactly when it resolves.
      let resolveStaleFetch;
      api.fetchHistory.mockImplementationOnce(() => new Promise(resolve => { resolveStaleFetch = resolve; }));
      const stalePromise = refreshHistory();

      // Meanwhile the modal closes and reopens on a different issue, and that
      // fresh load resolves before the stale background refresh does.
      const otherIssue = { ...issue, id: 99 };
      api.fetchHistory.mockResolvedValueOnce([
        { id: 5, event: 'created', data: {}, user: null, created_at: '2026-02-01T09:00:00Z' }
      ]);
      api.fetchComments.mockResolvedValueOnce([]);
      await loadActivity(otherIssue);

      // The stale fetch (for the old issue) finally resolves after the newer load.
      resolveStaleFetch([
        { id: 1, event: 'archived', data: {}, user: null, created_at: '2026-01-01T09:00:00Z' }
      ]);
      await stalePromise;

      document.getElementById('tab-history').click();
      const items = document.querySelectorAll('.history-item');
      expect(items).toHaveLength(1);
      expect(items[0].querySelector('.history-text').textContent).toBe('Issue: Created');
    });
  });
});
