import { state, setCurrentIssue } from '../state.js';
import { getStatusOptions, getStatusLabel, STATUS_OPEN, STATUS_ARCHIVE } from '../status-config.js';
import { createIssue, updateIssue, archiveIssue, unarchiveIssue, moveIssue, createTask, updateTaskPositions, fetchLabelsByProject, fetchReleases, fetchStatusConfig, fetchIssueById, fetchUsers, fetchProjects, deleteIssue } from '../api.js';
import { showNotification, showConfirm, updateDateInputStyle, canArchive, initCharCounter, countCodepoints, getDeadlineStatus, getTaskDeadlineStatus, continueListOnEnter, promptAdminPasswordConfirmation, toDateInputValue, guardSubmit, onGuardedSubmit, confirmDiscard, markBusy } from '../utils.js';
import { MAX_TITLE_LENGTH, MAX_DESC_LENGTH } from '../validation-config.js';
import { PRIORITY_NORMAL, PRIORITY_OPTIONS, RELEASE_STATUS_CLOSED } from '../domain-constants.js';
import { renderMarkdown } from '../markdown.js';
import { userCan, ACTION_CREATE_ISSUE, ACTION_UPDATE_ISSUE, ACTION_DELETE_ISSUE, ACTION_ARCHIVE_ISSUE, ACTION_UNARCHIVE_ISSUE, ACTION_MOVE_ISSUE, ACTION_CREATE_TASK, ACTION_UPDATE_TASK } from '../permissions.js';
import { renderTasks } from './tasks.js';
import { setupActivity, loadActivity, refreshHistory, getOpenCommentDraft, closeCommentEditors } from './activity.js';
import { getDragAfterTaskElement, getDraggedTask } from '../drag.js';

let refreshAppCallback = null;
let rerenderViewsCallback = null;
let previousActiveNavBtn = null;
let currentEtag = null; // Stores ETag for conflict detection
// Never matches a server ETag: forces a 409 so a save built on outdated data goes
// through the conflict dialog instead of silently overwriting newer changes.
const STALE_ETAG = '"stale"';
let issueLoad = null; // Pending background revalidation of the open issue (see openModal)
let issueLoadSeq = 0; // Bumped per open/close so a late revalidation can't touch another issue
let hasSavedDuringSession = false; // Tracks whether any save occurred in this modal session

export function setupModal(refreshApp, rerenderViews) {
  refreshAppCallback = refreshApp;
  rerenderViewsCallback = rerenderViews;
  const form = document.getElementById('issue-form');

  // Global checking of state is tricky if we don't have reference to 'currentIssue' variable in app.js
  // We use state.currentIssue.

  document.getElementById('cancel-btn').addEventListener('click', closeModal);
  document.getElementById('done-btn').addEventListener('click', handleDone);
  onGuardedSubmit(form, handleIssueSubmit);


  document.getElementById('delete-issue-btn').addEventListener('click', handleDeleteIssue);
  document.getElementById('archive-issue-btn').addEventListener('click', handleArchiveIssue);
  document.getElementById('unarchive-issue-btn').addEventListener('click', handleUnarchiveIssue);

  setupInlineEditing();
  setupEditorToolbar();
  setupSidebarImmediateSave();
  setupActivity();
  setupScrollCue();

  // Character counters
  initCharCounter(document.getElementById('description-editor'), MAX_DESC_LENGTH, { className: 'editor-counter' });
  initCharCounter(document.getElementById('new-task-title'), MAX_TITLE_LENGTH, { className: 'task-title-counter' });

  // Task Form
  // + Add and Enter share the in-flight submit instead of creating the task twice
  // while the first request is still running.
  const addTaskBtn = document.getElementById('add-task-btn');
  const newTaskTitle = document.getElementById('new-task-title');
  _submitTaskFn = guardSubmit(handleTaskSubmit, { field: addTaskBtn.closest('.input-group') });
  addTaskBtn.addEventListener('click', _submitTaskFn);
  newTaskTitle.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void _submitTaskFn();
    }
  });
  newTaskTitle.addEventListener('input', syncUnloadListener);

  // Task Drag Reordering Logic
  const taskList = document.getElementById('task-list');
  taskList.addEventListener('dragover', (e) => {
    e.preventDefault();
    const draggedTask = getDraggedTask();
    if (!draggedTask) return;
    const afterElement = getDragAfterTaskElement(taskList, e.clientY);
    if (afterElement == null) {
      taskList.appendChild(draggedTask);
    } else {
      afterElement.before(draggedTask);
    }
  });

  // Custom Date Input Click Handling
  document.querySelectorAll('.custom-date-input').forEach(container => {
    container.addEventListener('click', (e) => {
      // Skip if this is the planned dates wrapper (handled separately)
      if (container.id === 'planned-dates-wrapper') return;

      const input = container.querySelector('input[type="date"]');
      if (input && typeof input.showPicker === 'function') {
        input.showPicker();
      } else if (input) {
        input.click();
      }
    });
  });

  // Date input styling
  document.querySelectorAll('input[type="date"]').forEach(input => {
    input.addEventListener('change', () => updateDateInputStyle(input));
  });

  // Custom Dropdown Logic
  setupCustomDropdown('status-dropdown', 'status-trigger', 'status-options', 'status', 'status-text');
  setupCustomDropdown('label-dropdown', 'label-trigger', 'label-options', 'label-select', 'label-text');
  setupCustomDropdown('priority-dropdown', 'priority-trigger', 'priority-options', 'priority', 'priority-text');
  setupCustomDropdown('assignee-dropdown', 'assignee-trigger', 'assignee-options', 'assignee-select', 'assignee-text');
  setupCustomDropdown('project-dropdown', 'project-trigger', 'project-options', 'project-select', 'project-text');
  setupCustomDropdown('release-dropdown', 'release-trigger', 'release-options', 'release-select', 'release-text');

  // Close dropdowns on outside click
  document.addEventListener('click', (e) => {
    ['status-dropdown', 'label-dropdown', 'priority-dropdown', 'assignee-dropdown', 'project-dropdown', 'release-dropdown'].forEach(id => {
      const container = document.getElementById(id);
      if (container && !container.contains(e.target)) {
        const opts = container.querySelector('.custom-select-options');
        opts.classList.add('hidden');
        opts.style.maxHeight = '';
      }
    });
  });
}

function setupScrollCue() {
  const scrollEl = document.querySelector('.modal-main-scroll');
  const down = document.querySelector('.scroll-cue-down');
  const up = document.querySelector('.scroll-cue-up');
  if (!scrollEl || !down || !up) return;

  const update = () => {
    const hasMore = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight > 4;
    down.classList.toggle('visible', hasMore);
    up.classList.toggle('visible', scrollEl.scrollTop > 4);
  };

  down.addEventListener('click', () => {
    scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: 'smooth' });
  });
  up.addEventListener('click', () => {
    scrollEl.scrollTo({ top: 0, behavior: 'smooth' });
  });

  scrollEl.addEventListener('scroll', update, { passive: true });
  new MutationObserver(update).observe(scrollEl, { childList: true, subtree: true });
  update();
}

export async function openModal(issue = null) {
  const modal = document.getElementById('issue-modal');
  modal.classList.remove('hidden');
  // The modal element is reused: start every issue at the top, not where the last one was left
  const scrollEl = document.querySelector('.modal-main-scroll');
  if (scrollEl) scrollEl.scrollTop = 0;
  hasSavedDuringSession = false;

  const seq = ++issueLoadSeq;
  currentEtag = null;

  if (issue) {
    // Render immediately from the caller's copy (list endpoints return the same shape as
    // GET /issues/{id}), then revalidate in the background to obtain the ETag and pick up
    // changes made elsewhere. Saves wait for the revalidation via etagForSave().
    // Cloned so in-modal edits never mutate the caller's list entry directly
    // (rerenderAfterIssueChange merges them back explicitly).
    const current = structuredClone(issue);
    setCurrentIssue(current);
    renderModalDropdowns(current);
    setupEditModal(current);
    issueLoad = revalidateIssue(current, seq);
  } else {
    issueLoad = null;
    setCurrentIssue(null);
    renderModalDropdowns(null);
    setupNewModal();
  }
  resetTaskForm();
}

async function revalidateIssue(issue, seq) {
  let freshIssue, etag;
  try {
    ({ issue: freshIssue, etag } = await fetchIssueById(issue.project_id, issue.id));
  } catch (e) {
    console.error(e);
    if (seq === issueLoadSeq) {
      showNotification('Failed to load issue', 'error');
      closeModal();
    }
    return;
  }
  if (seq !== issueLoadSeq) return; // modal closed or another issue opened meanwhile
  issueLoad = null;

  if (!freshIssue) {
    showNotification('Issue not found or was deleted', 'error');
    closeModal();
    return;
  }
  if (freshIssue.updated_at === issue.updated_at) {
    currentEtag = etag;
    return;
  }
  if (isEditing()) {
    // Keep the user's in-progress input; their first save will hit the conflict dialog.
    currentEtag = STALE_ETAG;
    return;
  }
  currentEtag = etag;
  setCurrentIssue(freshIssue);
  renderModalDropdowns(freshIssue);
  renderIssueFields(freshIssue);
}

/**
 * Returns the ETag to send with a save built from state.currentIssue. Waits for a pending
 * background revalidation first; if it replaced the issue with a newer server copy, the
 * save's data is outdated and STALE_ETAG forces the conflict flow.
 */
async function etagForSave() {
  if (!issueLoad) return currentEtag;
  const baseIssue = state.currentIssue;
  await issueLoad;
  return state.currentIssue === baseIssue ? currentEtag : STALE_ETAG;
}

function setupProjectDropdown(issue) {
  const projectInput = document.getElementById('project-select');
  const projectText = document.getElementById('project-text');
  const projectTrigger = document.getElementById('project-trigger');
  if (!projectInput || !projectText) return;

  const storedProjectId = issue ? null : localStorage.getItem('wuflow_selectedProjectId');
  projectInput.value = issue?.project_id ?? (storedProjectId ? Number.parseInt(storedProjectId) : 1);
  projectText.textContent = issue?.project?.name ?? 'default';

  const applyProjects = (projects) => {
    renderProjectOptions(projects);
    const currentId = Number.parseInt(projectInput.value);
    const found = projects.find(p => p.id === currentId);
    if (found) projectText.textContent = found.name;
  };
  if (state.projects.length) {
    applyProjects(state.projects);
  } else {
    fetchProjects().then(applyProjects).catch(err => console.error('Failed to load projects', err));
  }

  if (projectTrigger) {
    const restricted = !!issue && !userCan(state.currentUser, ACTION_MOVE_ISSUE);
    projectTrigger.disabled = restricted || issue?.status === STATUS_ARCHIVE;
    projectTrigger.title = restricted ? 'Insufficient permissions to move this issue' : '';
  }
}

function renderModalDropdowns(issue) {
  // Status Dropdown
  const statusInput = document.getElementById('status');
  const currentStatus = issue?.status ?? STATUS_OPEN;
  statusInput.value = currentStatus;
  document.getElementById('status-text').textContent = getStatusLabel(currentStatus);
  renderStatusOptions();

  // Priority Dropdown
  const priorityInput = document.getElementById('priority');
  priorityInput.value = issue?.priority ?? PRIORITY_NORMAL;
  document.getElementById('priority-text').textContent = issue?.priority ?? PRIORITY_NORMAL;
  renderPriorityOptions();

  // Label Dropdown
  const labelInput = document.getElementById('label-select');
  const labelText = document.getElementById('label-text');
  labelInput.value = issue?.label?.id ?? '';
  labelText.textContent = issue?.label?.name ?? 'No Label';

  const labelProjectId = issue?.project_id ?? (state.selectedProjectId ?? 1);
  const applyLabels = (labels) => {
    renderLabelOptions(labels);
    if (issue?.label) {
      const found = labels.find(l => l.id === issue.label.id);
      if (found) labelText.textContent = found.name;
    }
  };
  // refreshApp caches the selected project's labels; only an issue from another
  // project (e.g. in the "all projects" view) needs its own fetch.
  if (state.labelsProjectId === labelProjectId) {
    applyLabels(state.labels);
  } else {
    fetchLabelsByProject(labelProjectId).then(applyLabels).catch(err => console.error('Failed to load labels', err));
  }

  // Assignee Dropdown
  const assigneeInput = document.getElementById('assignee-select');
  const assigneeText = document.getElementById('assignee-text');
  assigneeInput.value = issue?.assignee_id ?? '';
  assigneeText.textContent = issue?.assignee ? (issue.assignee.first_name + ' ' + issue.assignee.last_name) : 'Unassigned';

  const applyUsers = (users) => {
    renderAssigneeOptions(users);
    if (issue?.assignee_id) {
      const found = users.find(u => u.id === issue.assignee_id);
      if (found) assigneeText.textContent = found.first_name + ' ' + found.last_name;
    }
  };
  if (state.users.length) {
    applyUsers(state.users);
  } else {
    fetchUsers().then(applyUsers).catch(err => console.error('Failed to load users', err));
  }

  // Project Dropdown
  setupProjectDropdown(issue);

  // Release Dropdown
  const releaseInput = document.getElementById('release-select');
  const releaseText = document.getElementById('release-text');
  if (releaseInput && releaseText) {
    releaseInput.value = issue?.release_id ?? '';
    releaseText.textContent = issue?.release?.name ?? 'No Release';
    renderReleaseOptions(state.releases, issue?.release_id ?? null);
  }
}

function setupEditModal(issue) {
  renderIssueFields(issue);

  // Activity area (History + Comments) — fetches its own data lazily on open.
  void loadActivity(issue, {
    onEditStart: syncUnloadListener,
    onEditEnd: syncUnloadListener
  });
}

// Renders everything in the edit modal except the Activity area, so a background
// revalidation can refresh the fields without refetching history/comments.
function renderIssueFields(issue) {
  const isArchived = issue.status === STATUS_ARCHIVE;
  document.getElementById('modal-title').textContent = isArchived ? `Archived Issue #${issue.id}` : `Issue Details #${issue.id}`;
  document.getElementById('issue-id').value = issue.id;
  document.getElementById('title').value = issue.title;
  document.getElementById('description-editor').value = issue.description || '';
  const { html } = renderMarkdown(issue.description || '', true);
  document.getElementById('description-preview').innerHTML = html;
  // We do NOT show the toast on initial load to avoid spamming the user when opening an issue with old bad data,
  // we only show the error on active edit actions (Save / Preview).

  // Planned Date Chip Logic
  renderPlannedDateChips(issue);

  setDeadlineInput(issue);
  document.getElementById('deadline-display')?.classList.toggle('overdue', getDeadlineStatus(issue).late);

  document.getElementById('tasks-section').classList.remove('hidden');
  document.getElementById('task-form-container').classList.toggle('hidden', isArchived);

  renderTasks(issue.tasks || [], document.getElementById('task-list'), issue, { readOnly: isArchived, ...taskCallbacks(issue) });

  const user = state.currentUser;
  const canDelete = !isArchived && userCan(user, ACTION_DELETE_ISSUE);
  const canArchBtn = !isArchived && userCan(user, ACTION_ARCHIVE_ISSUE);
  const canUnarchBtn = isArchived && userCan(user, ACTION_UNARCHIVE_ISSUE);
  document.getElementById('delete-issue-btn').classList.toggle('hidden', !canDelete);
  document.getElementById('archive-issue-btn').classList.toggle('hidden', !canArchBtn);
  document.getElementById('unarchive-issue-btn').classList.toggle('hidden', !canUnarchBtn);

  setSidebarReadOnly(isArchived);

  // Enable inline edit mode; an archived issue shows title and description as plain text
  toggleInlineEditMode(true, isArchived);

  document.getElementById('save-issue-btn').classList.add('hidden');
  document.getElementById('cancel-btn').classList.add('hidden');
  document.getElementById('done-btn').classList.remove('hidden');
}

function setupNewModal() {
  document.getElementById('modal-title').textContent = 'New Issue';
  document.getElementById('issue-form').reset();
  document.getElementById('description-editor').value = '';
  document.getElementById('description-preview').innerHTML = '';
  document.getElementById('issue-id').value = '';

  renderPlannedDateChips(null);

  updateDateInputStyle(document.getElementById('deadline'));
  document.getElementById('deadline-display')?.classList.remove('overdue');

  document.getElementById('tasks-section').classList.add('hidden');
  document.getElementById('activity-section')?.classList.add('hidden');
  document.getElementById('delete-issue-btn').classList.add('hidden');
  document.getElementById('archive-issue-btn').classList.add('hidden');
  document.getElementById('unarchive-issue-btn').classList.add('hidden');

  toggleInlineEditMode(false);
  setSidebarReadOnly(false);

  const activeNav = document.querySelector('.left-menu .menu-btn.active');
  if (activeNav && activeNav.id !== 'add-issue-btn') {
    previousActiveNavBtn = activeNav;
    activeNav.classList.remove('active');
  }
  document.getElementById('add-issue-btn').classList.add('active');
  document.getElementById('save-issue-btn').classList.remove('hidden');
  document.getElementById('cancel-btn').classList.remove('hidden');
  document.getElementById('done-btn').classList.add('hidden');

}

function resetMdPreview(previewEl) {
  previewEl.classList.remove('active');
  document.getElementById('md-preview-toggle')?.classList.remove('active');
  document.querySelectorAll('.editor-btn[data-md]').forEach(b => {
    b.disabled = false;
    b.classList.remove('disabled');
  });
}

function setAriaDisabled(el, disabled) {
  if (disabled) el.setAttribute('aria-disabled', 'true');
  else el.removeAttribute('aria-disabled');
}

// enable: edit modal, where title and description are shown read-only until clicked
// (readOnly: never, for an archived issue, which is greyed out); otherwise the new-issue form.
function toggleInlineEditMode(enable, readOnly = false) {
  const titleInput = document.getElementById('title');
  const descContainer = document.querySelector('.editor-container');
  const descEditor = document.getElementById('description-editor');
  const descPreview = document.getElementById('description-preview');
  const descEditActions = document.getElementById('description-edit-actions');

  resetMdPreview(descPreview);

  for (const el of [titleInput, descContainer]) {
    el.classList.toggle('inline-editable', enable && !readOnly);
    el.classList.toggle('read-only-text', enable && readOnly);
    setAriaDisabled(el, enable && readOnly);
  }
  titleInput.readOnly = enable;
  descEditor.classList.toggle('hidden', enable);
  descPreview.classList.toggle('hidden', !enable);
  descEditActions.classList.add('hidden');
}

// The dropdowns and dates of an archived issue can't be used. The project trigger is left
// to setupProjectDropdown, which also disables it for missing permissions.
function setSidebarReadOnly(readOnly) {
  const modal = document.getElementById('issue-modal');
  modal.querySelectorAll('.custom-select-trigger:not(#project-trigger)').forEach(el => { el.disabled = readOnly; });
  modal.querySelectorAll('.custom-date-input').forEach(el => setAriaDisabled(el, readOnly));
}

export function closeModal() {
  document.getElementById('issue-modal').classList.add('hidden');
  leaveEditors();
  const addBtn = document.getElementById('add-issue-btn');
  if (addBtn.classList.contains('active')) {
    addBtn.classList.remove('active');
    if (previousActiveNavBtn) {
      previousActiveNavBtn.classList.add('active');
      previousActiveNavBtn = null;
    }
  }
  setCurrentIssue(null);
  currentEtag = null;
  _saveEditingTaskFn = null;
  issueLoad = null;
  issueLoadSeq++;
  resetTaskForm();
  syncUnloadListener();
  if (refreshAppCallback) refreshAppCallback();
}

/**
 * Helper function to save issue with conflict detection.
 * Returns the saved issue as the server returned it, or null if a conflict occurred.
 */
async function saveIssueWithConflictCheck(issue, successMessage) {
  const result = await updateIssue(issue.project_id, issue, await etagForSave());

  if (result.conflict) {
    const shouldReload = await showConfirm(
      'Conflict Detected',
      'This issue was modified by another user. Would you like to reload with the latest data?',
      'Reload',
      'Cancel',
      'primary'
    );
    if (shouldReload) {
      // Reload data in-place without closing modal
      const { issue: freshIssue, etag } = await fetchIssueById(issue.project_id, issue.id);
      if (freshIssue) {
        currentEtag = etag;
        setCurrentIssue(freshIssue);
        renderModalDropdowns(freshIssue);
        setupEditModal(freshIssue);
        showNotification('Reloaded with latest data');
      }
    }
    // If Cancel clicked, do nothing - keep modal open with current data
    return null;
  }

  // Update stored ETag with new value
  currentEtag = result.etag;
  hasSavedDuringSession = true;
  if (successMessage) showNotification(successMessage);
  void refreshHistory();
  return result.issue;
}

// Writes to the open issue run one at a time. Each is built from the issue as the previous
// save left it and sent with that save's new ETag; sent in parallel, the second save would
// carry the ETag the first one just replaced and fail with a false conflict.
let issueSaveChain = Promise.resolve();

// Runs write() after the writes queued before it.
function enqueueIssueWrite(write) {
  const run = issueSaveChain.then(write);
  issueSaveChain = run.catch(() => {});
  return run;
}

/**
 * Queues a save of the given fields of the current issue. getChanges(issue) returns them,
 * computed from the issue as left by earlier saves. On success the fields are applied to
 * state.currentIssue, then the server's copy of the issue (e.g. the cleaned-up title, the
 * assignee object), except its tasks: an open task editor or drag holds the current task
 * objects. Resolves false on a conflict or if the modal was closed meanwhile.
 */
function saveIssueChanges(getChanges, successMessage) {
  const issueId = state.currentIssue?.id;
  return enqueueIssueWrite(async () => {
    const issue = state.currentIssue;
    if (!issue || issue.id !== issueId) return false; // modal closed or another issue opened meanwhile
    const changes = getChanges(issue);
    const saved = await saveIssueWithConflictCheck({ ...issue, ...changes }, successMessage);
    if (!saved) return false;
    Object.assign(issue, changes, { ...saved, tasks: issue.tasks });
    // After applying the saved issue: the views copy it, and a card with the old updated_at
    // would make a quick reopen look like a change by someone else (forced conflict).
    rerenderViewsCallback?.();
    return true;
  });
}

function validateIssueForm(title, description) {
  if (!title) {
    showNotification('Title is required.', 'error');
    document.getElementById('title').focus();
    return false;
  }
  if (countCodepoints(title) > MAX_TITLE_LENGTH) {
    showNotification(`Title must not exceed ${MAX_TITLE_LENGTH} characters.`, 'error');
    document.getElementById('title').focus();
    return false;
  }
  if (countCodepoints(description) > MAX_DESC_LENGTH) {
    showNotification(`Description must not exceed ${MAX_DESC_LENGTH} characters.`, 'error');
    return false;
  }
  return true;
}

function getIssueDataFromForm() {
  const title = document.getElementById('title').value.trim();
  const description = document.getElementById('description-editor').value || '';
  const assigneeIdVal = document.getElementById('assignee-select').value;
  const labelId = document.getElementById('label-select').value;
  const projectIdVal = document.getElementById('project-select')?.value;
  const releaseIdVal = document.getElementById('release-select')?.value;

  return {
    title,
    description,
    deadline: document.getElementById('deadline').value ? new Date(document.getElementById('deadline').value + 'T12:00:00') : null,
    planned_dates: getPlannedDatesFromDOM(),
    status: document.getElementById('status').value,
    priority: document.getElementById('priority').value,
    assignee_id: assigneeIdVal ? Number.parseInt(assigneeIdVal) : null,
    position: state.currentIssue ? state.currentIssue.position : 0,
    label: labelId ? { id: Number.parseInt(labelId) } : null,
    project_id: projectIdVal ? Number.parseInt(projectIdVal) : 1,
    release_id: releaseIdVal ? Number.parseInt(releaseIdVal) : null
  };
}

async function handleIssueSubmit() {
  const issueData = getIssueDataFromForm();
  if (!validateIssueForm(issueData.title, issueData.description)) return;

  try {
    if (state.currentIssue) {
      if (!userCan(state.currentUser, ACTION_UPDATE_ISSUE)) return;
      // Queued like the field saves, so it does not race them with an outdated ETag.
      if (!(await saveIssueChanges(() => issueData, 'Issue updated'))) return;
    } else {
      if (!userCan(state.currentUser, ACTION_CREATE_ISSUE)) return;
      const { strippedHTML } = renderMarkdown(issueData.description || '', true);
      if (strippedHTML) {
        showNotification('Description contains unsupported HTML tags.', 'error');
        return;
      }
      const newIssue = await createIssue(issueData.project_id, issueData);
      showNotification(`Issue #${newIssue.id} created successfully`);
    }
    closeModal();
  } catch (err) {
    showNotification(err.message, 'error');
  }
}

async function handleDeleteIssue() {
  if (!state.currentIssue) return;
  if (!userCan(state.currentUser, ACTION_DELETE_ISSUE)) return;
  const confirmed = await promptAdminPasswordConfirmation(
    'Delete Issue',
    `Do you really want to delete "${state.currentIssue.title}"?\nThis permanently deletes the issue along with all of its tasks, comments, and activity history. This cannot be undone.`,
    async (adminPassword) => {
      await deleteIssue(state.currentIssue.project_id, state.currentIssue.id, adminPassword);
    },
    'Delete'
  );
  if (!confirmed) return;
  closeModal();
  showNotification('Issue deleted');
}

async function handleArchiveIssue() {
  if (!state.currentIssue) return;
  if (!userCan(state.currentUser, ACTION_ARCHIVE_ISSUE)) return;
  // Let queued field saves finish first, so closing the modal does not drop them.
  await issueSaveChain;
  if (!state.currentIssue) return;

  const check = canArchive(state.currentIssue);
  if (!check.allowed) {
    await showConfirm('Cannot Archive', check.reason, 'OK', null, 'primary');
    return;
  }

  if (await showConfirm('Archive Issue', `Archive "${state.currentIssue.title}"?`, 'Archive', 'Cancel', 'primary')) {
    try {
      const updated = await archiveIssue(state.currentIssue.project_id, state.currentIssue.id);
      if (updated?.id) {
        closeModal();
        showNotification('Issue archived');
      }
    } catch (err) {
      showNotification(err.message, 'error');
    }
  }
}

async function handleUnarchiveIssue() {
  if (!state.currentIssue) return;
  if (!userCan(state.currentUser, ACTION_UNARCHIVE_ISSUE)) return;
  // Let queued field saves finish first, so closing the modal does not drop them.
  await issueSaveChain;
  if (!state.currentIssue) return;
  if (await showConfirm('Unarchive Issue', `Move "${state.currentIssue.title}" back to specific status?`, 'Move to Done', 'Cancel', 'primary')) {
    try {
      const updated = await unarchiveIssue(state.currentIssue.project_id, state.currentIssue.id);
      if (updated?.id) {
        closeModal();
        showNotification('Issue unarchived');
      }
    } catch (err) {
      showNotification(err.message, 'error');
    }
  }
}

// Inline Editing
let originalTitle = '';
let originalDesc = '';
let _saveTitleFn = null;
let _cancelTitleFn = null;
let _saveDescFn = null;
let _cancelDescFn = null;
let _discardDescFn = null; // ✕ and Escape: cancel, after asking if the text was changed
let _saveEditingTaskFn = null; // save() of the task currently in edit mode, awaited by handleDone()
let _submitTaskFn = null; // adds the task typed into the new-task field

// Callbacks passed to renderTasks() for the tasks of the given issue.
function taskCallbacks(issue) {
  return {
    onTaskUpdate: () => { rerenderViewsCallback?.(); void refreshHistory(); },
    onTaskOrderSave: () => saveTaskOrder(issue),
    onTaskEditStart,
    onTaskEditEnd,
  };
}

function onTaskEditStart(saveTask) {
  _saveEditingTaskFn = saveTask;
  syncUnloadListener();
}

function onTaskEditEnd() {
  _saveEditingTaskFn = null;
  syncUnloadListener();
}

function setupInlineEditing() {
  const titleInput = document.getElementById('title');
  const titleCounter = initCharCounter(titleInput, MAX_TITLE_LENGTH, { manual: true });

  const descEditor = document.getElementById('description-editor');
  const descContainer = document.querySelector('.editor-container');
  const descEditActions = document.getElementById('description-edit-actions');
  const descCancelBtn = document.getElementById('desc-cancel-btn');
  const descSaveBtn = document.getElementById('desc-save-btn');

  // Title
  titleInput.addEventListener('focus', () => {
    // In new-issue mode the input has neither inline class — show counter on focus
    if (!titleInput.classList.contains('inline-editable') && !titleInput.classList.contains('inline-editing')) {
      titleCounter.show();
    }
  });

  titleInput.addEventListener('click', () => {
    if (state.currentIssue?.status === STATUS_ARCHIVE) return;
    if (titleInput.classList.contains('inline-editable')) {
      originalTitle = titleInput.value;
      titleInput.classList.remove('inline-editable');
      titleInput.classList.add('inline-editing');
      titleInput.readOnly = false;
      titleInput.focus();
      titleCounter.show();
      syncUnloadListener();
    }
  });

  titleInput.addEventListener('keydown', (e) => {
    if (!titleInput.classList.contains('inline-editing')) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      _saveTitleFn();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      _cancelTitleFn();
    }
  });

  const cancelTitle = () => {
    titleInput.value = originalTitle;
    titleInput.classList.add('inline-editable');
    titleInput.classList.remove('inline-editing');
    titleInput.readOnly = true;
    titleCounter.hide();
    syncUnloadListener();
  };

  // Returns false if the title could not be saved (input stays in edit mode with the text).
  const doSaveTitle = async () => {
    const newTitle = titleInput.value.trim();
    if (!newTitle) {
      cancelTitle(); // Revert to original if empty
      return true;
    }
    if (newTitle !== state.currentIssue.title) {
      try {
        const saved = await saveIssueChanges(() => ({ title: newTitle }), 'Title updated');
        if (!saved) return false; // Conflict occurred - stay in edit mode

        // The saved title is the server's, cleaned of e.g. HTML tags and null bytes.
        titleInput.value = state.currentIssue.title;
        if (newTitle !== state.currentIssue.title) {
          showNotification('Unsupported HTML tags are not rendered for security.', 'error');
        }
      } catch (err) {
        showNotification(err.message, 'error');
        return false; // Keep edit mode
      }
    }
    titleInput.classList.add('inline-editable');
    titleInput.classList.remove('inline-editing');
    titleInput.readOnly = true;
    titleCounter.hide();
    syncUnloadListener();
    return true;
  };

  // Enter and blur can both trigger a save (e.g. when the re-login dialog takes focus while
  // the first save waits); they share the in-flight save instead of sending a second,
  // stale-ETag request that would fail with a conflict.
  const saveTitle = guardSubmit(doSaveTitle, { field: titleInput.closest('.title-input-container') });

  titleInput.addEventListener('blur', async (e) => {
    if (!titleInput.classList.contains('inline-editing')) {
      titleCounter.hide(); // new-issue mode: hide counter on blur
      return;
    }
    if (e.relatedTarget?.id === 'done-btn') return; // handleDone() will save it directly
    await saveTitle();
  });

  _saveTitleFn = saveTitle;
  _cancelTitleFn = cancelTitle;

  // Description — click on preview to enter edit mode
  const descPreview = document.getElementById('description-preview');

  descPreview.addEventListener('click', (e) => {
    const anchor = e.target.closest('a');
    if (anchor) {
      e.preventDefault();
      globalThis.open(anchor.href, '_blank', 'noopener,noreferrer');
      return;
    }
    if (state.currentIssue?.status === STATUS_ARCHIVE) return;
    if (descContainer.classList.contains('inline-editable')) {
      originalDesc = descEditor.value;
      descContainer.classList.remove('inline-editable');
      descContainer.classList.add('inline-editing');
      descPreview.classList.add('hidden');
      descEditor.classList.remove('hidden');
      descEditActions.classList.remove('hidden');
      descEditor.focus();
      descEditor.setSelectionRange(0, 0);
      descEditor.scrollTop = 0;
      requestAnimationFrame(() => {
        document.querySelector('.modal-body')?.scrollTo({ top: 0 });
      });
      syncUnloadListener();
    }
  });

  // Live preview while editing
  descEditor.addEventListener('input', () => {
    descPreview.innerHTML = renderMarkdown(descEditor.value);
  });

  const cancelDesc = () => {
    descEditor.value = originalDesc;
    descPreview.innerHTML = renderMarkdown(originalDesc);
    descContainer.classList.add('inline-editable');
    descContainer.classList.remove('inline-editing');
    descEditor.classList.add('hidden');
    descPreview.classList.remove('hidden');
    descEditActions.classList.add('hidden');
    resetMdPreview(descPreview);
    syncUnloadListener();
  };

  // Returns false if the description could not be saved (editor stays open with the text).
  const doSaveDesc = async () => {
    const newDesc = descEditor.value;
    if (newDesc !== state.currentIssue.description) {
      try {
        const saved = await saveIssueChanges(() => ({ description: newDesc }), 'Description updated');
        if (!saved) return false;
      } catch (err) {
        showNotification(err.message, 'error');
        return false;
      }
    }
    const { html, strippedHTML } = renderMarkdown(newDesc, true);
    descPreview.innerHTML = html;
    if (strippedHTML) {
      showNotification('Unsupported HTML tags are not rendered for security.', 'error');
    }
    descContainer.classList.add('inline-editable');
    descContainer.classList.remove('inline-editing');
    descEditor.classList.add('hidden');
    descPreview.classList.remove('hidden');
    descEditActions.classList.add('hidden');
    resetMdPreview(descPreview);
    syncUnloadListener();
    return true;
  };

  // ✓, Cmd/Ctrl+Enter and the modal's Done handler share the in-flight save instead of
  // sending it twice.
  const saveDesc = guardSubmit(doSaveDesc, { field: descContainer });
  const discardDesc = async () => {
    if (await confirmDiscard(descEditor.value !== originalDesc)) cancelDesc();
  };

  _saveDescFn = saveDesc;
  _cancelDescFn = cancelDesc;
  _discardDescFn = discardDesc;

  descCancelBtn.addEventListener('click', discardDesc);
  descSaveBtn.addEventListener('click', saveDesc);
}

async function handleDone() {
  const titleInput = document.getElementById('title');
  const descEditor = document.getElementById('description-editor');

  // Let queued field saves finish first, so closing the modal does not drop them.
  await issueSaveChain;

  // Title: auto-save (or revert if empty); a failed save keeps the modal open
  if (titleInput.classList.contains('inline-editing') && !(await _saveTitleFn())) return;

  // Description: keep explicit prompt behavior; a failed save keeps the modal open
  if (document.querySelector('.editor-container').classList.contains('inline-editing')) {
    const descDone = await processFieldOnDone(descEditor.value !== originalDesc, 'Save description?', _saveDescFn, _cancelDescFn);
    if (!descDone) return;
  }

  // Tasks: auto-save the task currently in edit mode; a failed save keeps the modal open
  if (_saveEditingTaskFn && !(await _saveEditingTaskFn())) return;

  // New task and comments: never added or dropped without asking
  if (!(await processFieldOnDone(hasNewTaskText(), 'Add task?', _submitTaskFn, resetTaskForm, 'Add'))) return;
  const comment = getOpenCommentDraft();
  if (comment && !(await processFieldOnDone(comment.changed, 'Save comment?', comment.save, comment.discard))) return;

  const showUpdatedNotification = state.currentIssue && hasSavedDuringSession && !errorToastShown();
  closeModal();
  if (showUpdatedNotification) {
    showNotification('Issue updated');
  }
}

// True while an error toast is on screen, e.g. the warning that HTML was removed from the
// saved title. "Issue updated" on Done would replace it before it could be read.
function errorToastShown() {
  const toast = document.getElementById('notification-toast');
  return !!toast && toast.classList.contains('error') && !toast.classList.contains('hidden');
}

// Unchanged text is discarded silently, changed text after asking the question.
// Returns false if the user chose to save but the save failed, so the modal must stay open.
async function processFieldOnDone(changed, question, saveFn, cancelFn, saveText = 'Save') {
  if (changed && await showConfirm('Unsaved Changes', question, saveText, 'Discard', 'primary')) {
    return saveFn();
  }
  cancelFn();
  return true;
}

// Leaves every inline editor without saving, e.g. when the modal closes after archiving.
function leaveEditors() {
  if (document.getElementById('title').classList.contains('inline-editing')) _cancelTitleFn();
  if (document.querySelector('.editor-container').classList.contains('inline-editing')) _cancelDescFn();
  closeCommentEditors();
}

export function preventNavigation(e) {
  e.preventDefault();
  e.returnValue = '';
}

// True while the title, description or a task is in inline edit mode, i.e. a re-render of
// the issue fields would overwrite the user's input.
function isEditing() {
  const titleEditing = document.getElementById('title').classList.contains('inline-editing');
  const descEditing = document.querySelector('.editor-container').classList.contains('inline-editing');
  return titleEditing || descEditing || _saveEditingTaskFn !== null;
}

function hasNewTaskText() {
  return document.getElementById('new-task-title').value.trim() !== '';
}

// The browser asks before leaving the page only while an editor holds unsaved text. The
// listener is not kept permanently, because it keeps some browsers from caching the page.
function syncUnloadListener() {
  if (isEditing() || hasNewTaskText() || getOpenCommentDraft()) {
    window.addEventListener('beforeunload', preventNavigation);
  } else {
    window.removeEventListener('beforeunload', preventNavigation);
  }
}

// Resets the sidebar controls to the last saved values after a failed or conflicting save,
// so an unsaved choice never looks persisted once the error toast is gone.
function revertSidebarControls() {
  if (!state.currentIssue) return;
  renderModalDropdowns(state.currentIssue);
  setDeadlineInput(state.currentIssue);
}

function setDeadlineInput(issue) {
  const deadlineInput = document.getElementById('deadline');
  deadlineInput.value = toDateInputValue(issue.deadline);
  updateDateInputStyle(deadlineInput);
}

// Saves the given fields of the current issue, with the field of the changed control
// busy until its save is done. On success they are applied to state.currentIssue; on
// conflict or error the sidebar is reset to the saved values.
async function saveSidebarField(changes, successMsg, control) {
  try {
    if (await markBusy(sidebarFieldOf(control), () => saveIssueChanges(() => changes, successMsg))) return true;
  } catch (err) {
    showNotification(err.message, 'error');
  }
  revertSidebarControls();
  return false;
}

// A sidebar field: the label and the control, dimmed together while saving.
function sidebarFieldOf(control) {
  return control.closest('.form-group');
}

async function handleDeadlineChange(rawValue) {
  if (!state.currentIssue) return;
  const dateVal = rawValue ? new Date(rawValue + 'T12:00:00') : null;
  if (!(await saveSidebarField({ deadline: dateVal }, null, document.getElementById('deadline')))) return;
  const dlStatus = getDeadlineStatus({ deadline: dateVal, release: state.currentIssue.release });
  document.getElementById('deadline-display')?.classList.toggle('overdue', dlStatus.late);
  const lateTaskCount = refreshTaskDeadlineStyles();
  const taskSuffix = lateTaskCount === 1 ? '' : 's';
  const taskWarning = lateTaskCount > 0 ? ` — ${lateTaskCount} task${taskSuffix} past deadline` : '';
  showNotification(
    dlStatus.late ? `Deadline updated — ${dlStatus.reason}${taskWarning}` : `Deadline updated${taskWarning}`,
    dlStatus.late || lateTaskCount > 0 ? 'warning' : 'success'
  );
}

function setupSidebarImmediateSave() {

  const deadlineInput = document.getElementById('deadline');

  const statusSelect = document.getElementById('status');
  const labelSelect = document.getElementById('label-select');
  const prioritySelect = document.getElementById('priority');
  const assigneeSelect = document.getElementById('assignee-select');

  prioritySelect.addEventListener('change', async () => {
    if (state.currentIssue) await saveSidebarField({ priority: prioritySelect.value }, 'Priority updated', prioritySelect);
  });

  statusSelect.addEventListener('change', async () => {
    if (state.currentIssue) await saveSidebarField({ status: statusSelect.value }, 'Status updated', statusSelect);
  });

  if (assigneeSelect) {
    assigneeSelect.addEventListener('change', async () => {
      if (state.currentIssue) {
        const val = assigneeSelect.value;
        const assigneeID = val ? Number.parseInt(val) : null;
        await saveSidebarField({ assignee_id: assigneeID }, 'Assignee updated', assigneeSelect);
      }
    });
  }

  deadlineInput.addEventListener('change', () => handleDeadlineChange(deadlineInput.value));
  if (labelSelect) {
    labelSelect.addEventListener('change', async () => {
      if (state.currentIssue) {
        const val = labelSelect.value;
        const labelVal = val ? { id: Number.parseInt(val) } : null;
        await saveSidebarField({ label: labelVal }, 'Label updated', labelSelect);
      }
    });
  }

  const releaseSelect = document.getElementById('release-select');
  if (releaseSelect) {
    releaseSelect.addEventListener('change', async () => {
      if (state.currentIssue) {
        const val = releaseSelect.value;
        const releaseId = val ? Number.parseInt(val) : null;
        const release = val ? state.releases.find(r => r.id === releaseId) ?? null : null;
        if (await saveSidebarField({ release_id: releaseId, release }, 'Release updated', releaseSelect)) {
          const dlStatus = getDeadlineStatus(state.currentIssue);
          document.getElementById('deadline-display')?.classList.toggle('overdue', dlStatus.late);
          if (dlStatus.late) showNotification(`Release updated — deadline is ${dlStatus.reason}`, 'warning');
        }
      }
    });
  }

  const projectSelect = document.getElementById('project-select');
  if (projectSelect) {
    projectSelect.addEventListener('change', async () => {
      const val = projectSelect.value;
      const projectId = val ? Number.parseInt(val) : 1;

      if (state.currentIssue) {
        // Queued like the field saves: a save still in flight would otherwise finish after
        // the move and set currentEtag back to the ETag from before the move.
        await enqueueIssueWrite(() => moveIssueToProject(projectId));
      } else {
        localStorage.setItem('wuflow_selectedProjectId', String(projectId));
      }
    });
  }
}

async function moveIssueToProject(projectId) {
  if (!state.currentIssue) return;
  const projectSelect = document.getElementById('project-select');
  let moveResult = null;
  const confirmed = await promptAdminPasswordConfirmation(
    'Move Issue to another Project',
    'Do you really want to move this issue to another project?\nIts label, release, and status will be reset, since these fields are project-specific and cannot be preserved across projects.',
    async (adminPassword) => {
      moveResult = await moveIssue(state.currentIssue.project_id, state.currentIssue.id, projectId, adminPassword);
    },
    'Move Issue',
    'primary'
  );
  if (!confirmed) {
    projectSelect.value = state.currentIssue.project_id;
    document.getElementById('project-text').textContent = state.currentIssue.project?.name ?? '';
    return;
  }
  const { issue: updated, etag } = moveResult;
  currentEtag = etag;
  setCurrentIssue(updated);
  localStorage.setItem('wuflow_selectedProjectId', String(projectId));
  // The project-option click already loaded label/release/statusconfig for the new
  // project. Just reset the displayed values that the server cleared on move.
  document.getElementById('label-select').value = '';
  document.getElementById('label-text').textContent = 'No Label';
  document.getElementById('release-select').value = '';
  document.getElementById('release-text').textContent = 'No Release';
  document.getElementById('status').value = STATUS_OPEN;
  document.getElementById('status-text').textContent = getStatusLabel(STATUS_OPEN);
  document.getElementById('status-options')?.classList.add('hidden');
  setupEditModal(updated);
  showNotification('Project changed', 'info');
}

function needsLeadingNewline(value, pos) {
  return pos > 0 && value[pos - 1] !== '\n';
}

function setupEditorToolbar() {
  const editor = document.getElementById('description-editor');
  const preview = document.getElementById('description-preview');

  function handleEnterKey(e) {
    continueListOnEnter(editor, e);
  }

  function handleTabKey(e) {
    e.preventDefault();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const value = editor.value;

    // If no text is selected, and Shift is NOT pressed, just insert two spaces.
    if (start === end && !e.shiftKey) {
      editor.value = value.substring(0, start) + '  ' + value.substring(end);
      editor.selectionStart = editor.selectionEnd = start + 2;
      editor.dispatchEvent(new Event('input'));
      return;
    }

    // Multi-line or Shift+Tab logic
    let adjustedEnd = end;
    if (end > start && value[end - 1] === '\n') {
      adjustedEnd = end - 1;
    }

    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = value.indexOf('\n', adjustedEnd);
    if (lineEnd === -1) lineEnd = value.length;

    const beforeStr = value.substring(0, lineStart);
    const lines = value.substring(lineStart, lineEnd).split('\n');
    const afterStr = value.substring(lineEnd);

    let startOffset = 0;
    let endOffset = 0;

    const newLines = lines.map((line, idx) => {
      let newLine = line;
      let diff = 0;

      if (e.shiftKey) {
        if (newLine.startsWith('  ')) {
          newLine = newLine.substring(2);
          diff = -2;
        } else if (newLine.startsWith(' ') || newLine.startsWith('\t')) {
          newLine = newLine.substring(1);
          diff = -1;
        }
      } else {
        newLine = '  ' + newLine;
        diff = 2;
      }

      if (idx === 0) startOffset += diff;
      endOffset += diff;

      return newLine;
    });

    editor.value = beforeStr + newLines.join('\n') + afterStr;

    const newStart = Math.max(lineStart, start + startOffset);
    const newEnd = Math.max(lineStart, end + endOffset);

    editor.selectionStart = newStart;
    editor.selectionEnd = start === end ? newStart : newEnd;

    editor.dispatchEvent(new Event('input'));
  }

  editor.addEventListener('keydown', (e) => {
    // Saving and discarding only apply to the inline editor, not to the new-issue form.
    const inlineEditing = document.querySelector('.editor-container').classList.contains('inline-editing');
    if (inlineEditing && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void _saveDescFn();
    } else if (inlineEditing && e.key === 'Escape') {
      e.preventDefault();
      void _discardDescFn();
    } else if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      handleEnterKey(e);
    } else if (e.key === 'Tab') {
      handleTabKey(e);
    }
  });

  function insertMarkdown(before, after = '') {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selected = editor.value.slice(start, end);
    editor.value = editor.value.slice(0, start) + before + selected + after + editor.value.slice(end);
    editor.selectionStart = start + before.length;
    editor.selectionEnd = start + before.length + selected.length;
    editor.focus();
    preview.innerHTML = renderMarkdown(editor.value);
  }

  function applyList(type) {
    const start = editor.selectionStart;
    const lines = editor.value.slice(start, editor.selectionEnd).split('\n');
    const replaced = lines.map((l, i) => type === 'ol' ? `${i + 1}. ` + l : '- ' + l).join('\n');
    editor.value = editor.value.slice(0, start) + replaced + editor.value.slice(editor.selectionEnd);
    editor.focus();
    preview.innerHTML = renderMarkdown(editor.value);
  }

  function applyHeading(level) {
    const start = editor.selectionStart;
    const lines = editor.value.slice(start, editor.selectionEnd).split('\n');
    const prefix = level === 1 ? '# ' : '## ';
    const replaced = lines.map(l => prefix + l.replace(/^#+\s/, '')).join('\n');
    editor.value = editor.value.slice(0, start) + replaced + editor.value.slice(editor.selectionEnd);
    editor.focus();
    preview.innerHTML = renderMarkdown(editor.value);
  }

  function applyLink() {
    const selected = editor.value.slice(editor.selectionStart, editor.selectionEnd).trim();
    if (selected && /^https?:\/\//i.test(selected)) {
      insertMarkdown('[', `](${selected})`);
    } else {
      insertMarkdown('[', '](https://)');
    }
  }

  function applyCode() {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selected = editor.value.slice(start, end);

    if (selected.includes('\n')) {
      const needsNewlineAfter = end < editor.value.length && editor.value[end] !== '\n';
      const beforePfx = needsLeadingNewline(editor.value, start) ? '\n```\n' : '```\n';
      const afterSfx = needsNewlineAfter ? '\n```\n' : '\n```';
      insertMarkdown(beforePfx, afterSfx);
    } else {
      insertMarkdown('`', '`');
    }
  }

  function applyTable() {
    const pos = editor.selectionStart;
    const value = editor.value;
    const prefix = needsLeadingNewline(value, pos) ? '\n' : '';
    const template = `${prefix}| Header 1 | Header 2 | Header 3 |\n| --- | --- | --- |\n| Cell | Cell | Cell |\n`;
    editor.value = value.slice(0, pos) + template + value.slice(pos);
    editor.selectionStart = editor.selectionEnd = pos + prefix.length + 2;
    editor.focus();
    preview.innerHTML = renderMarkdown(editor.value);
  }

  function handleMarkdownCommand(cmd) {
    switch (cmd) {
      case 'ul': applyList('ul'); break;
      case 'ol': applyList('ol'); break;
      case 'h1': applyHeading(1); break;
      case 'h2': applyHeading(2); break;
      case 'link': applyLink(); break;
      case 'code': applyCode(); break;
      case 'table': applyTable(); break;
    }
  }

  document.querySelectorAll('.editor-btn[data-md]').forEach(btn => {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => {
      if (btn.dataset.prefix) {
        insertMarkdown(btn.dataset.prefix, btn.dataset.suffix || '');
      } else {
        handleMarkdownCommand(btn.dataset.md);
      }
    });
  });

  // Preview toggle
  document.getElementById('md-preview-toggle')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const showingPreview = !preview.classList.contains('hidden');
    const toolbarBtns = document.querySelectorAll('.editor-btn[data-md]');

    if (showingPreview) {
      preview.classList.add('hidden');
      preview.classList.remove('active');
      editor.classList.remove('hidden');
      editor.focus();
      btn.classList.remove('active');
      toolbarBtns.forEach(b => {
        b.disabled = false;
        b.classList.remove('disabled');
      });
    } else {
      const { html, strippedHTML } = renderMarkdown(editor.value, true);
      preview.innerHTML = html;
      if (strippedHTML) {
        showNotification('Unsupported HTML tags are not rendered for security.', 'error');
      }
      preview.classList.remove('hidden');
      preview.classList.add('active');
      editor.classList.add('hidden');
      btn.classList.add('active');
      toolbarBtns.forEach(b => {
        b.disabled = true;
        b.classList.add('disabled');
      });
    }
  });
}

// Task Logic Helpers
function refreshTaskDeadlineStyles() {
  let lateCount = 0;
  document.querySelectorAll('#task-list .task-item').forEach(li => {
    const input = li.querySelector('.task-deadline-input');
    const display = li.querySelector('.task-deadline-display');
    const container = li.querySelector('.task-deadline-container');
    if (!input || !display || !container) return;
    const deadline = input.value ? new Date(input.value + 'T12:00:00') : null;
    const status = getTaskDeadlineStatus(deadline, state.currentIssue);
    display.classList.toggle('overdue', status.late);
    container.title = status.late ? status.reason : 'Set Deadline';
    if (status.late) lateCount++;
  });
  return lateCount;
}

function resetTaskForm() {
  const title = document.getElementById('new-task-title');
  const deadline = document.getElementById('new-task-deadline');
  if (title) title.value = '';
  if (deadline) {
    deadline.value = '';
    updateDateInputStyle(deadline);
  }
}

// Returns true if the task was added.
async function handleTaskSubmit() {
  if (!state.currentIssue) return false;
  if (!userCan(state.currentUser, ACTION_CREATE_TASK)) return false;
  const titleInput = document.getElementById('new-task-title');
  const deadlineInput = document.getElementById('new-task-deadline');
  if (!titleInput.value.trim()) return false;
  if (countCodepoints(titleInput.value) > MAX_TITLE_LENGTH) {
    showNotification(`Task title must not exceed ${MAX_TITLE_LENGTH} characters.`, 'error');
    return false;
  }

  const taskData = {
    issue_id: state.currentIssue.id,
    title: titleInput.value,
    done: false,
    deadline: deadlineInput.value ? new Date(deadlineInput.value + 'T12:00:00') : null,
    position: state.currentIssue.tasks ? state.currentIssue.tasks.length : 0
  };

  try {
    const newTask = await createTask(state.currentIssue.project_id, state.currentIssue.id, taskData);
    if (!state.currentIssue.tasks) state.currentIssue.tasks = [];
    state.currentIssue.tasks.push(newTask);
    renderTasks(state.currentIssue.tasks, document.getElementById('task-list'), state.currentIssue, taskCallbacks(state.currentIssue));
    resetTaskForm();
    syncUnloadListener();
    const taskDlStatus = getTaskDeadlineStatus(taskData.deadline, state.currentIssue);
    showNotification(taskDlStatus.late ? `Task created — ${taskDlStatus.reason}` : 'Task created', taskDlStatus.late ? 'warning' : 'success');
    if (rerenderViewsCallback) rerenderViewsCallback();
    void refreshHistory();
    return true;
  } catch (err) {
    showNotification(err.message, 'error');
    return false;
  }
}

async function saveTaskOrder(issue) {
  if (!userCan(state.currentUser, ACTION_UPDATE_TASK)) return;
  const taskItems = [...document.querySelectorAll('#task-list .task-item')];
  const positions = [];
  const previous = [];
  taskItems.forEach((item, index) => {
    const id = Number.parseInt(item.dataset.id);
    const task = issue.tasks.find(t => t.id === id);
    if (task && task.position !== index) {
      previous.push({ task, position: task.position });
      task.position = index;
      positions.push({ id, position: index });
    }
  });

  if (positions.length > 0) {
    try {
      await updateTaskPositions(issue.project_id, issue.id, positions);
      issue.tasks.sort((a, b) => a.position - b.position);
    } catch (err) {
      showNotification(err.message, 'error');
      // The server saved none of the positions (all-or-nothing), so put the tasks back
      // in their old order; otherwise the unsaved order would look saved.
      previous.forEach(({ task, position }) => { task.position = position; });
      renderTasks(issue.tasks, document.getElementById('task-list'), issue, taskCallbacks(issue));
    }
  }
}



// Custom Dropdown Split
function setupCustomDropdown(wrapperId, triggerId, optionsId, inputId, textId) {
  const trigger = document.getElementById(triggerId);
  const options = document.getElementById(optionsId);

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();

    if (state.currentIssue?.status === STATUS_ARCHIVE) return;

    const wasHidden = options.classList.contains('hidden');

    // Close others
    ['status-dropdown', 'label-dropdown', 'priority-dropdown', 'assignee-dropdown'].forEach(id => {
      if (id !== wrapperId) {
        const otherOptions = document.getElementById(id).querySelector('.custom-select-options');
        otherOptions.classList.add('hidden');
        otherOptions.style.maxHeight = '';
      }
    });

    if (wasHidden) {
      // Constrain dropdown to available space below the trigger within the modal
      const triggerRect = trigger.getBoundingClientRect();
      const modalContent = document.querySelector('.issue-modal-content');
      if (modalContent) {
        const modalRect = modalContent.getBoundingClientRect();
        const spaceBelow = modalRect.bottom - 20 - triggerRect.bottom;
        options.style.maxHeight = Math.max(80, Math.min(300, spaceBelow)) + 'px';
      }
      options.classList.remove('hidden');
    } else {
      options.classList.add('hidden');
      options.style.maxHeight = '';
    }
  });
}

function renderStatusOptions() {
  const optionsContainer = document.getElementById('status-options');
  optionsContainer.innerHTML = '';

  getStatusOptions().forEach(({ value, label }) => {
    const div = document.createElement('div');
    div.className = 'custom-option';
    div.textContent = label;
    div.addEventListener('click', () => {
      selectOption('status', 'status-text', 'status-options', value, label);
    });
    optionsContainer.appendChild(div);
  });
}

function renderPriorityOptions() {
  const optionsContainer = document.getElementById('priority-options');
  optionsContainer.innerHTML = '';
  PRIORITY_OPTIONS.forEach(({ text, value }) => {
    const div = document.createElement('div');
    div.className = 'custom-option';
    div.textContent = text;
    div.addEventListener('click', () => {
      selectOption('priority', 'priority-text', 'priority-options', value, text);
    });
    optionsContainer.appendChild(div);
  });
}

function renderLabelOptions(labels) {
  const optionsContainer = document.getElementById('label-options');
  optionsContainer.innerHTML = '';

  // No Label Option
  const noLabelDiv = document.createElement('div');
  noLabelDiv.className = 'custom-option';
  noLabelDiv.textContent = 'No Label';
  noLabelDiv.addEventListener('click', () => {
    selectOption('label-select', 'label-text', 'label-options', '', 'No Label');
  });
  optionsContainer.appendChild(noLabelDiv);

  labels.forEach(label => {
    const div = document.createElement('div');
    div.className = 'custom-option';
    div.textContent = label.name;

    div.addEventListener('click', () => {
      selectOption('label-select', 'label-text', 'label-options', label.id, label.name);
    });
    optionsContainer.appendChild(div);
  });
}

export function renderReleaseOptions(releases, currentReleaseId) {
  const optionsContainer = document.getElementById('release-options');
  if (!optionsContainer) return;
  optionsContainer.innerHTML = '';

  const noReleaseDiv = document.createElement('div');
  noReleaseDiv.className = 'custom-option';
  noReleaseDiv.textContent = 'No Release';
  noReleaseDiv.addEventListener('click', () => {
    selectOption('release-select', 'release-text', 'release-options', '', 'No Release');
  });
  optionsContainer.appendChild(noReleaseDiv);

  (releases || []).filter(r => r.status !== RELEASE_STATUS_CLOSED).sort((a, b) => a.name.localeCompare(b.name)).forEach(release => {
    const div = document.createElement('div');
    div.className = 'custom-option';
    div.textContent = release.name;
    div.addEventListener('click', () => {
      selectOption('release-select', 'release-text', 'release-options', release.id, release.name);
    });
    optionsContainer.appendChild(div);
  });

  const releaseInput = document.getElementById('release-select');
  const releaseText = document.getElementById('release-text');
  if (releaseInput && releaseText) {
    if (currentReleaseId) {
      const found = (releases || []).find(r => r.id === currentReleaseId);
      releaseInput.value = currentReleaseId;
      releaseText.textContent = found ? found.name : 'No Release';
    } else {
      releaseInput.value = '';
      releaseText.textContent = 'No Release';
    }
  }
}

function renderProjectOptions(projects) {
  const optionsContainer = document.getElementById('project-options');
  if (!optionsContainer) return;
  optionsContainer.innerHTML = '';

  (projects || []).forEach(project => {
    const div = document.createElement('div');
    div.className = 'custom-option';
    div.textContent = project.name;
    div.addEventListener('click', () => {
      selectOption('project-select', 'project-text', 'project-options', project.id, project.name);
      fetchLabelsByProject(project.id).then(labels => {
        renderLabelOptions(labels);
        document.getElementById('label-select').value = '';
        document.getElementById('label-text').textContent = 'No Label';
      }).catch(err => console.error('Failed to reload labels for project', err));
      fetchReleases(project.id).then(releases => {
        state.releases = releases;
        renderReleaseOptions(releases, null);
      }).catch(err => console.error('Failed to reload releases for project', err));
      fetchStatusConfig(project.id).then(cfg => {
        state.statusConfig = cfg;
        renderStatusOptions();
        const statusInput = document.getElementById('status');
        const statusText = document.getElementById('status-text');
        if (statusInput) statusInput.value = STATUS_OPEN;
        if (statusText) statusText.textContent = 'Open';
        document.getElementById('status-options')?.classList.add('hidden');
      }).catch(err => console.error('Failed to reload status config for project', err));
    });
    optionsContainer.appendChild(div);
  });
}

function renderAssigneeOptions(users) {
  const optionsContainer = document.getElementById('assignee-options');
  optionsContainer.innerHTML = '';

  // Unassigned Option
  const unassignedDiv = document.createElement('div');
  unassignedDiv.className = 'custom-option';
  unassignedDiv.textContent = 'Unassigned';
  unassignedDiv.addEventListener('click', () => {
    selectOption('assignee-select', 'assignee-text', 'assignee-options', '', 'Unassigned');
  });
  optionsContainer.appendChild(unassignedDiv);

  // "Assign to me" Option
  if (state.currentUser) {
    const meDiv = document.createElement('div');
    meDiv.className = 'custom-option';
    meDiv.textContent = 'Assign to me';
    meDiv.addEventListener('click', () => {
      selectOption('assignee-select', 'assignee-text', 'assignee-options', state.currentUser.id, `${state.currentUser.first_name} ${state.currentUser.last_name}`);
    });
    optionsContainer.appendChild(meDiv);
  }

  users.filter(u => u.active && u.id !== state.currentUser?.id).forEach(user => {
    const div = document.createElement('div');
    div.className = 'custom-option';
    div.textContent = `${user.first_name} ${user.last_name}`;

    div.addEventListener('click', () => {
      selectOption('assignee-select', 'assignee-text', 'assignee-options', user.id, `${user.first_name} ${user.last_name}`);
    });
    optionsContainer.appendChild(div);
  });
}

function selectOption(inputId, textId, optionsId, value, text) {
  const input = document.getElementById(inputId);
  const textSpan = document.getElementById(textId);
  const options = document.getElementById(optionsId);

  if (input.value != value) {
    input.value = value;
    textSpan.textContent = text;
    input.dispatchEvent(new Event('change')); // Trigger immediate save if applicable
  }

  options.classList.add('hidden');
  options.style.maxHeight = '';
}


// --- Planned Dates Chip UI ---

function getPlannedDatesFromDOM() {
  const container = document.getElementById('planned-dates-container');
  if (!container) return [];
  const chips = container.querySelectorAll('.date-chip');
  const dates = [];
  chips.forEach(chip => {
    dates.push(chip.dataset.date);
  });
  return dates;
}

function renderPlannedDateChips(issue) {
  const container = document.getElementById('planned-dates-container');
  if (!container) return; // Ensure element exists in HTML

  container.innerHTML = '';

  const dates = issue?.planned_dates ? [...issue.planned_dates] : [];
  dates.sort((a, b) => a.localeCompare(b));

  dates.forEach(dateStr => {
    container.appendChild(createDateChip(dateStr));
  });

  // Add Button
  const addBtn = document.createElement('div');
  addBtn.className = 'date-chip-add';
  addBtn.innerHTML = '+';
  addBtn.title = 'Add Date';

  // Hidden Date Input for picking
  const picker = document.createElement('input');
  picker.type = 'date';
  picker.id = 'planned-date-picker';
  picker.name = 'planned-date-picker';
  picker.style.position = 'absolute';
  picker.style.opacity = '0';
  picker.style.bottom = '0';
  picker.style.left = '0';
  picker.style.width = '0';
  picker.style.height = '0';

  addBtn.appendChild(picker);

  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (typeof picker.showPicker === 'function') {
      picker.showPicker();
    } else {
      picker.click();
    }
  });

  picker.addEventListener('change', async () => {
    if (picker.value) {
      await addPlannedDate(picker.value);
      picker.value = ''; // Reset
    }
  });

  container.appendChild(addBtn);
}

function createDateChip(dateStr) {
  const chip = document.createElement('div');
  chip.className = 'date-chip';
  chip.dataset.date = dateStr;

  const span = document.createElement('span');
  span.textContent = new Date(dateStr).toLocaleDateString(navigator.language, { month: 'numeric', day: 'numeric' });

  const remove = document.createElement('span');
  remove.className = 'remove';
  remove.innerHTML = '&times;';
  remove.addEventListener('click', async (e) => {
    e.stopPropagation();
    await removePlannedDate(dateStr);
  });

  chip.appendChild(span);
  chip.appendChild(remove);

  return chip;
}

function plannedDatesField() {
  return sidebarFieldOf(document.getElementById('planned-dates-container'));
}

async function addPlannedDate(dateStr) {
  // If editing existing issue
  if (state.currentIssue) {
    if (!(state.currentIssue.planned_dates || []).includes(dateStr)) {
      try {
        // The dates are computed when the save runs, so quick consecutive adds all persist.
        const saved = await markBusy(plannedDatesField(), () => saveIssueChanges(issue => ({
          planned_dates: [...new Set([...(issue.planned_dates || []), dateStr])]
            .sort((a, b) => a.localeCompare(b)),
        }), 'Date added'));
        if (saved) renderPlannedDateChips(state.currentIssue);
      } catch (err) {
        showNotification(err.message, 'error');
      }
    }
  } else {
    // New Issue mode
    const dates = getPlannedDatesFromDOM();
    // Check dupe
    if (!dates.includes(dateStr)) {
      dates.push(dateStr);
      dates.sort((a, b) => a.localeCompare(b));
      renderPlannedDateChips({ planned_dates: dates });
    }
  }
}

async function removePlannedDate(dateStr) {
  if (state.currentIssue) {
    if (state.currentIssue.planned_dates) {
      try {
        const saved = await markBusy(plannedDatesField(), () => saveIssueChanges(issue => ({
          planned_dates: (issue.planned_dates || []).filter(d => d !== dateStr),
        }), 'Date removed'));
        if (saved) renderPlannedDateChips(state.currentIssue);
      } catch (err) {
        showNotification(err.message, 'error');
      }
    }
  } else {
    // New Issue mode
    const container = document.getElementById('planned-dates-container');
    const chip = container.querySelector(`.date-chip[data-date="${dateStr}"]`);
    if (chip) chip.remove();
  }
}
