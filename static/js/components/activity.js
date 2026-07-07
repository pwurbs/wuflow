import { fetchHistory, fetchComments, createComment, updateComment, deleteComment } from '../api.js';
import { escapeHtml, formatDateTime, getUserInitials, showNotification, showConfirm, initCharCounter, continueListOnEnter } from '../utils.js';
import { renderMarkdown } from '../markdown.js';
import { getStatusLabel } from '../status-config.js';
import { userCan, isCommentModerator, ACTION_CREATE_COMMENT, ACTION_UPDATE_COMMENT, ACTION_DELETE_COMMENT } from '../permissions.js';
import { state } from '../state.js';

const MAX_COMMENT_LENGTH = 500;

// Module-level context so tab switching and post-CRUD re-renders don't need to
// re-fetch the whole issue. Mirrors the closure style used by renderTasks.
const ctx = {
  issue: null,
  history: [],
  comments: [],
  callbacks: {},
  activeTab: 'comments',
  readOnly: false,
  // Only one comment may be in edit mode at a time — otherwise saving one
  // triggers a refreshComments() re-render that discards any other comment's
  // in-progress (unsaved) edit.
  editingCommentId: null
};

// Monotonic sequence guard against out-of-order async responses. loadActivity,
// refreshHistory, and refreshComments each bump this before awaiting; if a
// newer call has started by the time an older one's fetch resolves (e.g. the
// modal closed and reopened on a different issue while a background
// refreshHistory() from a field save was still in flight), the stale result is
// discarded instead of clobbering the fresher render.
let requestSeq = 0;
function nextSeq() { return ++requestSeq; }
function isStale(seq) { return seq !== requestSeq; }

const els = () => ({
  section: document.getElementById('activity-section'),
  tabComments: document.getElementById('tab-comments'),
  tabHistory: document.getElementById('tab-history'),
  commentList: document.getElementById('comment-list'),
  historyList: document.getElementById('history-list'),
  form: document.getElementById('comment-form-container'),
  input: document.getElementById('new-comment-body'),
  addBtn: document.getElementById('add-comment-btn')
});

// setupActivity wires the listeners (tab switching + new-comment form). Call
// once at app start, like setupModal.
export function setupActivity() {
  const e = els();
  if (!e.section) return;
  e.tabComments?.addEventListener('click', () => switchTab('comments'));
  e.tabHistory?.addEventListener('click', () => switchTab('history'));
  e.addBtn?.addEventListener('click', submitNewComment);
  if (e.input) {
    initCharCounter(e.input, MAX_COMMENT_LENGTH, { manual: false });
    e.input.addEventListener('keydown', (ev) => {
      // Ctrl/Cmd+Enter submits; plain Enter on a list line continues the list.
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); submitNewComment(); return; }
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey) continueListOnEnter(e.input, ev);
    });
  }
}

// loadActivity fetches history + comments for an issue and renders the area.
// Called from the modal's open flow. Defaults to the Comments tab.
export async function loadActivity(issue, callbacks = {}) {
  const seq = nextSeq();
  ctx.issue = issue;
  ctx.callbacks = callbacks;
  ctx.readOnly = issue.status === 'Archive';
  ctx.activeTab = 'comments';
  ctx.history = [];
  ctx.comments = [];
  ctx.editingCommentId = null;

  const e = els();
  if (!e.section) return;
  e.section.classList.remove('hidden');

  try {
    const [history, comments] = await Promise.all([
      fetchHistory(issue.project_id, issue.id),
      fetchComments(issue.project_id, issue.id)
    ]);
    if (isStale(seq)) return;
    ctx.history = history || [];
    ctx.comments = comments || [];
  } catch (err) {
    if (isStale(seq)) return;
    showNotification(err.message, 'error');
    return;
  }
  renderAll();
}

function switchTab(tab) {
  ctx.activeTab = tab;
  renderAll();
}

// refreshHistory re-fetches and re-renders just the History tab. Called by the
// modal after any issue field or task save completes, so a change made while
// the modal stays open shows up immediately instead of only on next reopen.
// No-op if no issue is currently loaded (activity area not open).
export async function refreshHistory() {
  if (!ctx.issue) return;
  const seq = nextSeq();
  const issue = ctx.issue;
  try {
    const history = await fetchHistory(issue.project_id, issue.id) || [];
    if (isStale(seq)) return;
    ctx.history = history;
  } catch (err) {
    if (isStale(seq)) return;
    showNotification(err.message, 'error');
    return;
  }
  renderAll();
}

function renderAll() {
  const e = els();
  if (!e.section) return;

  e.tabComments?.classList.toggle('active', ctx.activeTab === 'comments');
  e.tabHistory?.classList.toggle('active', ctx.activeTab === 'history');
  e.commentList?.classList.toggle('hidden', ctx.activeTab !== 'comments');
  e.historyList?.classList.toggle('hidden', ctx.activeTab !== 'history');

  // The new-comment form belongs to the Comments tab and is hidden on archived issues.
  const showForm = ctx.activeTab === 'comments' && !ctx.readOnly && userCan(state.currentUser, ACTION_CREATE_COMMENT);
  e.form?.classList.toggle('hidden', !showForm);

  renderComments(e.commentList);
  renderHistory(e.historyList);
}

// --- Comments ---------------------------------------------------------------

function authorName(user) {
  if (!user) return 'Unknown user';
  const name = `${user.first_name || ''} ${user.last_name || ''}`.trim();
  return name || user.email || 'Unknown user';
}

// buildAvatarBadge/buildAuthorSpan are shared by renderComments and renderHistory
// so the same initials/title/name logic isn't duplicated per list.
function buildAvatarBadge(user) {
  const badge = document.createElement('div');
  badge.className = 'user-badge';
  badge.textContent = getUserInitials(user);
  badge.title = authorName(user);
  return badge;
}

function buildAuthorSpan(user, className) {
  const author = document.createElement('span');
  author.className = className;
  author.textContent = authorName(user);
  return author;
}

function renderComments(container) {
  if (!container) return;
  container.innerHTML = '';

  if (ctx.comments.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'activity-empty';
    empty.textContent = 'No comments yet.';
    container.appendChild(empty);
    return;
  }

  const cu = state.currentUser;
  ctx.comments.forEach(comment => {
    const li = document.createElement('li');
    li.className = 'comment-item';
    li.dataset.id = comment.id;

    const canModify = (cu && comment.user_id === cu.id) || isCommentModerator(cu);

    const header = document.createElement('div');
    header.className = 'comment-header';

    header.appendChild(buildAvatarBadge(comment.user));

    const meta = document.createElement('div');
    meta.className = 'comment-meta';
    const author = buildAuthorSpan(comment.user, 'comment-author');
    const time = document.createElement('span');
    time.className = 'comment-time';
    time.textContent = comment.edited
      ? formatDateTime(comment.updated_at) + ' · edited'
      : formatDateTime(comment.created_at);
    meta.appendChild(author);
    meta.appendChild(time);
    header.appendChild(meta);

    if (canModify && !ctx.readOnly) {
      header.appendChild(buildCommentActions(comment, li, container));
    }
    li.appendChild(header);

    const body = document.createElement('div');
    body.className = 'comment-body md-preview';
    body.innerHTML = renderMarkdown(comment.body || '');
    li.appendChild(body);

    container.appendChild(li);
  });
}

// Matches .delete-task-btn's icon (tasks.js) — same glyph, same semantic
// action, reused here for consistency rather than a new delete icon.
const DELETE_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
const EDIT_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>';

function buildCommentActions(comment, li, container) {
  const actions = document.createElement('div');
  actions.className = 'comment-actions';

  if (userCan(state.currentUser, ACTION_UPDATE_COMMENT)) {
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'comment-edit-btn';
    editBtn.title = 'Edit comment';
    editBtn.innerHTML = EDIT_ICON;
    editBtn.addEventListener('click', () => enterCommentEdit(comment, li, container));
    actions.appendChild(editBtn);
  }
  if (userCan(state.currentUser, ACTION_DELETE_COMMENT)) {
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'comment-delete-btn';
    delBtn.title = 'Delete comment';
    delBtn.innerHTML = DELETE_ICON;
    delBtn.addEventListener('click', () => removeComment(comment));
    actions.appendChild(delBtn);
  }
  return actions;
}

// Hides Edit/Delete on every other comment while one is being edited, so
// there's no button to click into the "already editing" error in the first
// place — more preventive than corrective.
function setOtherCommentsActionsHidden(container, activeLi, hidden) {
  container.querySelectorAll('.comment-item').forEach(item => {
    if (item === activeLi) return;
    item.querySelector('.comment-actions')?.classList.toggle('actions-hidden', hidden);
  });
}

function enterCommentEdit(comment, li, container) {
  // Safety net: the Edit button on other comments is hidden while one is
  // being edited (see setOtherCommentsActionsHidden), so this should be
  // unreachable via the mouse — kept in case a button is still reachable
  // some other way (e.g. a stale reference).
  if (ctx.editingCommentId !== null) {
    showNotification('Finish editing the other comment first', 'error');
    return;
  }
  const body = li.querySelector('.comment-body');
  if (!body) return;
  ctx.editingCommentId = comment.id;
  ctx.callbacks.onEditStart?.();
  setOtherCommentsActionsHidden(container, li, true);

  // Same flush, single-border structure as the new-comment form
  // (.comment-editor-container) — textarea and action bar share one border,
  // no background seam between them.
  const editorContainer = document.createElement('div');
  editorContainer.className = 'comment-editor-container';

  const wrapper = document.createElement('div');
  wrapper.className = 'comment-edit-wrapper';

  const textarea = document.createElement('textarea');
  textarea.className = 'comment-edit-input';
  textarea.name = 'comment_edit_body';
  textarea.maxLength = MAX_COMMENT_LENGTH;
  // Without an explicit rows, the browser default (rows=2) becomes a size
  // floor even with field-sizing:content — start at 1 so it fits the actual
  // content, matching a single-line comment instead of always showing 2.
  textarea.rows = 1;
  textarea.value = comment.body || '';
  textarea.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey) continueListOnEnter(textarea, ev);
  });
  wrapper.appendChild(textarea);

  // Reuses the description editor's ✓/✕ inline-edit-btn styling (editor.css) —
  // Enter can't submit here since it's needed for list auto-continue.
  const barActions = document.createElement('div');
  barActions.className = 'comment-edit-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'inline-edit-btn inline-cancel-btn';
  cancel.title = 'Cancel';
  cancel.textContent = '✕';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'inline-edit-btn inline-save-btn';
  save.title = 'Save';
  save.textContent = '✓';
  barActions.appendChild(cancel);
  barActions.appendChild(save);

  editorContainer.appendChild(wrapper);
  editorContainer.appendChild(barActions);
  body.replaceWith(editorContainer);
  textarea.focus();
  // manual: true — the counter overlays inside the field (like the description
  // editor's), so it stays visible for the whole edit session instead of
  // toggling on focus/blur.
  initCharCounter(textarea, MAX_COMMENT_LENGTH, { manual: true }).show();

  const finish = () => {
    ctx.editingCommentId = null;
    setOtherCommentsActionsHidden(container, li, false);
    ctx.callbacks.onEditEnd?.();
  };
  cancel.addEventListener('click', () => { finish(); renderAll(); });
  save.addEventListener('click', async () => {
    const newBody = textarea.value.trim();
    if (!newBody) { showNotification('Comment must not be empty', 'error'); return; }
    try {
      await updateComment(ctx.issue.project_id, ctx.issue.id, comment.id, newBody);
      finish();
      await refreshComments();
      showNotification('Comment updated');
    } catch (err) {
      showNotification(err.message, 'error');
    }
  });
}

async function removeComment(comment) {
  if (!await showConfirm('Delete Comment', 'Delete this comment?', 'Delete')) return;
  try {
    await deleteComment(ctx.issue.project_id, ctx.issue.id, comment.id);
    await refreshComments();
    showNotification('Comment deleted');
  } catch (err) {
    showNotification(err.message, 'error');
  }
}

async function submitNewComment() {
  const e = els();
  const bodyText = (e.input?.value || '').trim();
  if (!bodyText) { showNotification('Comment must not be empty', 'error'); return; }
  try {
    await createComment(ctx.issue.project_id, ctx.issue.id, bodyText);
    if (e.input) {
      e.input.value = '';
      e.input.dispatchEvent(new Event('input')); // resets the char counter
    }
    await refreshComments();
    showNotification('Comment added');
  } catch (err) {
    showNotification(err.message, 'error');
  }
}

async function refreshComments() {
  if (!ctx.issue) return;
  const seq = nextSeq();
  const issue = ctx.issue;
  try {
    const comments = await fetchComments(issue.project_id, issue.id) || [];
    if (isStale(seq)) return;
    ctx.comments = comments;
  } catch (err) {
    if (isStale(seq)) return;
    showNotification(err.message, 'error');
    return;
  }
  renderAll();
}

// --- History ----------------------------------------------------------------

// All history lines follow the same "<Item>: <action> ..." rhythm so the type
// of change (not just its value) is consistent to scan down the timeline.
const fromTo = (label, action, from, to) => `${label}: ${action} ${from || 'none'} → ${to || 'none'}`;

// historySentence turns a history entry into a human-readable line. Returns plain
// text (assigned via textContent), so no escaping is required here.
function historySentence(entry) {
  const d = entry.data || {};
  switch (entry.event) {
    case 'created': return 'Issue: Created';
    case 'archived': return 'Issue: Archived';
    case 'unarchived': return 'Issue: Unarchived';
    // Moving an issue always resets its label, release, and status (server-enforced,
    // see the move confirmation dialog), so that note is always accurate here.
    case 'moved': return fromTo('Project', 'Moved', d.from, d.to) + ' (label, release, and status were reset)';
    case 'task': return d.detail || 'Task: Changed';
    case 'updated': return updatedSentence(d);
    default: return entry.event;
  }
}

function updatedSentence(d) {
  switch (d.field) {
    case 'title': return 'Title: Changed';
    case 'description': return 'Description: Changed';
    case 'status': return fromTo('Status', 'Changed', getStatusLabel(d.from), getStatusLabel(d.to));
    case 'priority': return fromTo('Priority', 'Changed', d.from, d.to);
    case 'deadline': return fromTo('Deadline', 'Changed', d.from, d.to);
    case 'assignee': return fromTo('Assignee', 'Changed', d.from, d.to);
    case 'label': return fromTo('Label', 'Changed', d.from, d.to);
    case 'release': return fromTo('Release', 'Changed', d.from, d.to);
    default: return 'Issue: Updated';
  }
}

// historyCategory buckets an entry into one of the 4 marker icons: creation
// (issue created), addition/deletion (a task was added/removed), or change
// (everything else — field edits, archive/unarchive, move, task
// complete/reopen/rename). Archive/unarchive/move are state transitions, not
// creation or deletion of anything, so they fall under "change".
function historyCategory(entry) {
  if (entry.event === 'created') return 'creation';
  if (entry.event === 'task') {
    const field = entry.data?.field;
    if (field === 'task_added') return 'addition';
    if (field === 'task_deleted') return 'deletion';
  }
  return 'change';
}

// Small feather-style icons (static, trusted markup — safe to assign via innerHTML).
const HISTORY_ICONS = {
  creation: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>',
  addition: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>',
  change: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>',
  deletion: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>'
};

function renderHistory(container) {
  if (!container) return;
  container.innerHTML = '';

  if (ctx.history.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'activity-empty';
    empty.textContent = 'No history yet.';
    container.appendChild(empty);
    return;
  }

  ctx.history.forEach(entry => {
    const li = document.createElement('li');
    li.className = `history-item history-${escapeHtml(entry.event)}`;

    const category = historyCategory(entry);
    const marker = document.createElement('span');
    marker.className = 'history-marker';
    marker.dataset.category = category;
    marker.innerHTML = HISTORY_ICONS[category];
    li.appendChild(marker);

    const content = document.createElement('div');
    content.className = 'history-content';

    const meta = document.createElement('div');
    meta.className = 'history-meta';
    meta.appendChild(buildAvatarBadge(entry.user));
    meta.appendChild(buildAuthorSpan(entry.user, 'history-author'));
    const time = document.createElement('span');
    time.className = 'history-time';
    time.textContent = formatDateTime(entry.created_at);
    meta.appendChild(time);
    content.appendChild(meta);

    const text = document.createElement('div');
    text.className = 'history-text';
    text.textContent = historySentence(entry);
    content.appendChild(text);

    li.appendChild(content);
    container.appendChild(li);
  });
}
