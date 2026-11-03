import { state, setCurrentIssue } from '../state.ts';
import { getStatusLabel, STATUS_OPEN, STATUS_ARCHIVE } from '../status-config.ts';
import { createIssue, updateIssue, archiveIssue, unarchiveIssue, moveIssue, createTask, updateTaskPositions, fetchLabelsByProject, fetchIssueById, fetchUsers, fetchProjects, deleteIssue } from '../api.ts';
import { byId, showNotification, showConfirm, updateDateInputStyle, canArchive, initCharCounter, countCodepoints, getDeadlineStatus, getTaskDeadlineStatus, promptAdminPasswordConfirmation, toDateInputValue, guardSubmit, onGuardedSubmit, confirmDiscard, markBusy, setAriaDisabled, isErrorToastShown, bySelector, errorMessage } from '../utils.ts';
import { MAX_TITLE_LENGTH, MAX_DESC_LENGTH } from '../validation-config.ts';
import { PRIORITY_NORMAL, DEFAULT_PROJECT_ID } from '../domain-constants.ts';
import type { Priority } from '../domain-constants.ts';
import type { IssueStatus } from '../status-config.ts';
import type { IssueWrite } from '../api.ts';
import type { Issue, Label, PositionUpdate, Project, Task, User } from '../models.ts';
import type { RefreshApp, RerenderView } from '../list-utils.ts';
import { renderMarkdown, renderMarkdownWithReport } from '../markdown.ts';
import { userCan, ACTION_CREATE_ISSUE, ACTION_UPDATE_ISSUE, ACTION_DELETE_ISSUE, ACTION_ARCHIVE_ISSUE, ACTION_UNARCHIVE_ISSUE, ACTION_MOVE_ISSUE, ACTION_CREATE_TASK, ACTION_UPDATE_TASK } from '../permissions.ts';
import { renderTasks } from './tasks.ts';
import { setupEditorToolbar, exitMdPreview } from './editor-toolbar.ts';
import { setupIssueDropdowns, renderStatusOptions, renderPriorityOptions, renderLabelOptions, renderReleaseOptions, renderProjectOptions, renderAssigneeOptions, loadProjectOptions } from './issue-dropdowns.ts';
import { getPlannedDatesFromDOM, renderPlannedDateChips } from './planned-dates.ts';
import { setupActivity, loadActivity, refreshHistory, getOpenCommentDraft, closeCommentEditors } from './activity.ts';
import { getDragAfterTaskElement, getDraggedTask } from '../drag.ts';

let refreshAppCallback: RefreshApp | null = null;
let rerenderViewsCallback: RerenderView | null = null;
let previousActiveNavBtn: Element | null = null;
let currentEtag: string | null = null; // Stores ETag for conflict detection
// Never matches a server ETag: forces a 409 so a save built on outdated data goes
// through the conflict dialog instead of silently overwriting newer changes.
const STALE_ETAG = '"stale"';
let issueLoad: Promise<void> | null = null; // Pending background revalidation of the open issue (see openModal)
let issueLoadSeq = 0; // Bumped per open/close so a late revalidation can't touch another issue
let hasSavedDuringSession = false; // Tracks whether any save occurred in this modal session

export function setupModal(refreshApp: RefreshApp, rerenderViews: RerenderView) {
  refreshAppCallback = refreshApp;
  rerenderViewsCallback = rerenderViews;
  const form = byId('issue-form', HTMLFormElement);

  // Global checking of state is tricky if we don't have reference to 'currentIssue' variable in app.ts
  // We use state.currentIssue.

  byId('cancel-btn').addEventListener('click', closeModal);
  byId('done-btn').addEventListener('click', handleDone);
  onGuardedSubmit(form, handleIssueSubmit);


  byId('delete-issue-btn').addEventListener('click', handleDeleteIssue);
  byId('archive-issue-btn').addEventListener('click', handleArchiveIssue);
  byId('unarchive-issue-btn').addEventListener('click', handleUnarchiveIssue);

  setupInlineEditing();
  setupEditorToolbar({
    isEditing: isDescEditing,
    save: () => _saveDescFn(),
    discard: () => _discardDescFn(),
  });
  setupSidebarImmediateSave();
  setupActivity();
  setupScrollCue();

  // Character counters
  initCharCounter(byId('description-editor', HTMLTextAreaElement), MAX_DESC_LENGTH, { className: 'editor-counter' });
  initCharCounter(byId('new-task-title', HTMLInputElement), MAX_TITLE_LENGTH, { className: 'task-title-counter' });

  // Task Form
  // + Add and Enter share the in-flight submit instead of creating the task twice
  // while the first request is still running.
  const addTaskBtn = byId('add-task-btn');
  const newTaskTitle = byId('new-task-title', HTMLInputElement);
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
  const taskList = byId('task-list');
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

      const input = container.querySelector<HTMLInputElement>('input[type="date"]');
      if (input && typeof input.showPicker === 'function') {
        input.showPicker();
      } else if (input) {
        input.click();
      }
    });
  });

  // Date input styling
  document.querySelectorAll<HTMLInputElement>('input[type="date"]').forEach(input => {
    input.addEventListener('change', () => updateDateInputStyle(input));
  });

  setupIssueDropdowns();
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

export function openModal(issue: Issue | null = null) {
  const modal = byId('issue-modal');
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

async function revalidateIssue(issue: Issue, seq: number) {
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

function setupProjectDropdown(issue: Issue | null) {
  const projectInput = byId('project-select', HTMLInputElement);
  const projectText = byId('project-text');
  const projectTrigger = byId('project-trigger', HTMLButtonElement);

  const storedProjectId = issue ? null : localStorage.getItem('wuflow_selectedProjectId');
  projectInput.value = String(issue?.project_id ?? (storedProjectId ? Number.parseInt(storedProjectId) : DEFAULT_PROJECT_ID));
  projectText.textContent = issue?.project?.name ?? 'default';

  const applyProjects = (projects: Project[]) => {
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

  const restricted = !!issue && !userCan(state.currentUser, ACTION_MOVE_ISSUE);
  projectTrigger.disabled = restricted || issue?.status === STATUS_ARCHIVE;
  projectTrigger.title = restricted ? 'Insufficient permissions to move this issue' : '';
}

function renderModalDropdowns(issue: Issue | null) {
  // Status Dropdown
  const statusInput = byId('status', HTMLInputElement);
  const currentStatus = issue?.status ?? STATUS_OPEN;
  statusInput.value = currentStatus;
  byId('status-text').textContent = getStatusLabel(currentStatus);
  renderStatusOptions();

  // Priority Dropdown
  const priorityInput = byId('priority', HTMLInputElement);
  priorityInput.value = issue?.priority ?? PRIORITY_NORMAL;
  byId('priority-text').textContent = issue?.priority ?? PRIORITY_NORMAL;
  renderPriorityOptions();

  // Label Dropdown
  const labelInput = byId('label-select', HTMLInputElement);
  const labelText = byId('label-text');
  labelInput.value = String(issue?.label?.id ?? '');
  labelText.textContent = issue?.label?.name ?? 'No Label';

  const labelProjectId = issue?.project_id ?? (state.selectedProjectId ?? DEFAULT_PROJECT_ID);
  const applyLabels = (labels: Label[]) => {
    renderLabelOptions(labels);
    const label = issue?.label;
    if (label) {
      const found = labels.find(l => l.id === label.id);
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
  const assigneeInput = byId('assignee-select', HTMLInputElement);
  const assigneeText = byId('assignee-text');
  assigneeInput.value = String(issue?.assignee_id ?? '');
  assigneeText.textContent = issue?.assignee ? (issue.assignee.first_name + ' ' + issue.assignee.last_name) : 'Unassigned';

  const applyUsers = (users: User[]) => {
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
  renderReleaseOptions(state.releases, issue?.release_id ?? null);
}

function setupEditModal(issue: Issue) {
  renderIssueFields(issue);

  // Activity area (History + Comments) — fetches its own data lazily on open.
  void loadActivity(issue, {
    onEditStart: syncUnloadListener,
    onEditEnd: syncUnloadListener
  });
}

// Renders everything in the edit modal except the Activity area, so a background
// revalidation can refresh the fields without refetching history/comments.
function renderIssueFields(issue: Issue) {
  const isArchived = issue.status === STATUS_ARCHIVE;
  byId('modal-title').textContent = isArchived ? `Archived Issue #${issue.id}` : `Issue Details #${issue.id}`;
  byId('issue-id', HTMLInputElement).value = String(issue.id);
  byId('title', HTMLInputElement).value = issue.title;
  byId('description-editor', HTMLTextAreaElement).value = issue.description || '';
  byId('description-preview').innerHTML = renderMarkdown(issue.description || '');
  // We do NOT show the toast on initial load to avoid spamming the user when opening an issue with old bad data,
  // we only show the error on active edit actions (Save / Preview).

  // Planned Date Chip Logic
  renderPlannedDateChips(issue, savePlannedDates);

  setDeadlineInput(issue);
  byId('deadline-display').classList.toggle('overdue', getDeadlineStatus(issue).late);

  byId('tasks-section').classList.remove('hidden');
  byId('task-form-container').classList.toggle('hidden', isArchived);

  renderTasks(issue.tasks || [], byId('task-list'), issue, { readOnly: isArchived, ...taskCallbacks(issue) });

  const user = state.currentUser;
  const canDelete = !isArchived && userCan(user, ACTION_DELETE_ISSUE);
  const canArchBtn = !isArchived && userCan(user, ACTION_ARCHIVE_ISSUE);
  const canUnarchBtn = isArchived && userCan(user, ACTION_UNARCHIVE_ISSUE);
  byId('delete-issue-btn').classList.toggle('hidden', !canDelete);
  byId('archive-issue-btn').classList.toggle('hidden', !canArchBtn);
  byId('unarchive-issue-btn').classList.toggle('hidden', !canUnarchBtn);

  setSidebarReadOnly(isArchived);

  // Enable inline edit mode; an archived issue shows title and description as plain text
  toggleInlineEditMode(true, isArchived);

  byId('save-issue-btn').classList.add('hidden');
  byId('cancel-btn').classList.add('hidden');
  byId('done-btn').classList.remove('hidden');
}

function setupNewModal() {
  byId('modal-title').textContent = 'New Issue';
  byId('issue-form', HTMLFormElement).reset();
  byId('description-editor', HTMLTextAreaElement).value = '';
  byId('description-preview').innerHTML = '';
  byId('issue-id', HTMLInputElement).value = '';

  renderPlannedDateChips(null, savePlannedDates);

  updateDateInputStyle(byId('deadline', HTMLInputElement));
  byId('deadline-display').classList.remove('overdue');

  byId('tasks-section').classList.add('hidden');
  byId('activity-section').classList.add('hidden');
  byId('delete-issue-btn').classList.add('hidden');
  byId('archive-issue-btn').classList.add('hidden');
  byId('unarchive-issue-btn').classList.add('hidden');

  toggleInlineEditMode(false);
  setSidebarReadOnly(false);

  const activeNav = document.querySelector('.left-menu .menu-btn.active');
  if (activeNav && activeNav.id !== 'add-issue-btn') {
    previousActiveNavBtn = activeNav;
    activeNav.classList.remove('active');
  }
  byId('add-issue-btn').classList.add('active');
  byId('save-issue-btn').classList.remove('hidden');
  byId('cancel-btn').classList.remove('hidden');
  byId('done-btn').classList.add('hidden');

}

// enable: edit modal, where title and description are shown read-only until clicked
// (readOnly: never, for an archived issue, which is greyed out); otherwise the new-issue form.
function toggleInlineEditMode(enable: boolean, readOnly = false) {
  const titleInput = byId('title', HTMLInputElement);
  const descContainer = bySelector(document, '.editor-container');
  const descEditor = byId('description-editor', HTMLTextAreaElement);
  const descPreview = byId('description-preview');
  const descEditActions = byId('description-edit-actions');

  exitMdPreview();

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
function setSidebarReadOnly(readOnly: boolean) {
  const modal = byId('issue-modal');
  modal.querySelectorAll<HTMLButtonElement>('.custom-select-trigger:not(#project-trigger)').forEach(el => { el.disabled = readOnly; });
  modal.querySelectorAll('.custom-date-input').forEach(el => setAriaDisabled(el, readOnly));
}

export function closeModal() {
  byId('issue-modal').classList.add('hidden');
  leaveEditors();
  const addBtn = byId('add-issue-btn');
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
async function saveIssueWithConflictCheck(issue: IssueWrite & { id: number; project_id: number }, successMessage: string | null) {
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
let issueSaveChain: Promise<unknown> = Promise.resolve();

// Runs write() after the writes queued before it.
function enqueueIssueWrite<T>(write: () => Promise<T>): Promise<T> {
  const run = issueSaveChain.then(write);
  issueSaveChain = run.catch(() => {});
  return run;
}

// The fields a save of the open issue changes.
type IssueChanges = Partial<IssueWrite>;

/**
 * Queues a save of the given fields of the current issue. getChanges(issue) returns them,
 * computed from the issue as left by earlier saves. On success the fields are applied to
 * state.currentIssue, then the server's copy of the issue (e.g. the cleaned-up title, the
 * assignee object), except its tasks: an open task editor or drag holds the current task
 * objects. Resolves false on a conflict or if the modal was closed meanwhile.
 */
function saveIssueChanges(getChanges: (issue: Issue) => IssueChanges, successMessage: string | null) {
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
    return state.currentIssue === issue;
  });
}

function validateIssueForm(title: string, description: string) {
  if (!title) {
    showNotification('Title is required.', 'error');
    byId('title', HTMLInputElement).focus();
    return false;
  }
  if (countCodepoints(title) > MAX_TITLE_LENGTH) {
    showNotification(`Title must not exceed ${MAX_TITLE_LENGTH} characters.`, 'error');
    byId('title', HTMLInputElement).focus();
    return false;
  }
  if (countCodepoints(description) > MAX_DESC_LENGTH) {
    showNotification(`Description must not exceed ${MAX_DESC_LENGTH} characters.`, 'error');
    return false;
  }
  return true;
}

function getIssueDataFromForm(): IssueWrite & { project_id: number } {
  const title = byId('title', HTMLInputElement).value.trim();
  const description = byId('description-editor', HTMLTextAreaElement).value;
  const deadlineVal = byId('deadline', HTMLInputElement).value;
  const assigneeIdVal = byId('assignee-select', HTMLInputElement).value;
  const labelId = byId('label-select', HTMLInputElement).value;
  const projectIdVal = byId('project-select', HTMLInputElement).value;
  const releaseIdVal = byId('release-select', HTMLInputElement).value;

  return {
    title,
    description,
    deadline: deadlineVal ? new Date(deadlineVal + 'T12:00:00') : null,
    planned_dates: getPlannedDatesFromDOM(),
    // The hidden inputs only ever hold a value of the status and priority dropdowns.
    status: byId('status', HTMLInputElement).value as IssueStatus,
    priority: byId('priority', HTMLInputElement).value as Priority,
    assignee_id: assigneeIdVal ? Number.parseInt(assigneeIdVal) : null,
    position: state.currentIssue ? state.currentIssue.position : 0,
    label: labelId ? { id: Number.parseInt(labelId) } : null,
    project_id: projectIdVal ? Number.parseInt(projectIdVal) : DEFAULT_PROJECT_ID,
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
      const { strippedHTML } = renderMarkdownWithReport(issueData.description || '');
      if (strippedHTML) {
        showNotification('Description contains unsupported HTML tags.', 'error');
        return;
      }
      const newIssue = await createIssue(issueData.project_id, issueData);
      showNotification(`Issue #${newIssue.id} created successfully`);
    }
    closeModal();
  } catch (err) {
    showNotification(errorMessage(err), 'error');
  }
}

async function handleDeleteIssue() {
  const issue = state.currentIssue;
  if (!issue) return;
  if (!userCan(state.currentUser, ACTION_DELETE_ISSUE)) return;
  const confirmed = await promptAdminPasswordConfirmation(
    'Delete Issue',
    `Do you really want to delete "${issue.title}"?\nThis permanently deletes the issue along with all of its tasks, comments, and activity history. This cannot be undone.`,
    async (adminPassword) => {
      await deleteIssue(issue.project_id, issue.id, adminPassword);
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
      showNotification(errorMessage(err), 'error');
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
      showNotification(errorMessage(err), 'error');
    }
  }
}

// Inline Editing
let originalTitle = '';
let originalDesc = '';
// Set by setupModal(); nothing calls them before that.
function notSetUp(): never {
  throw new Error('setupModal() has not run');
}
let _saveTitleFn: () => Promise<boolean> = notSetUp;
let _cancelTitleFn: () => void = notSetUp;
let _saveDescFn: () => Promise<boolean> = notSetUp;
let _cancelDescFn: () => void = notSetUp;
let _discardDescFn: () => Promise<void> = notSetUp; // ✕ and Escape: cancel, after asking if the text was changed
let _saveEditingTaskFn: (() => unknown) | null = null; // save() of the task currently in edit mode, awaited by handleDone()
let _submitTaskFn: () => Promise<boolean> = notSetUp; // adds the task typed into the new-task field

// The issue open in the modal, for code that only runs in the edit modal (not for a new issue).
function openIssue() {
  if (!state.currentIssue) throw new Error('No issue open');
  return state.currentIssue;
}

// Callbacks passed to renderTasks() for the tasks of the given issue.
function taskCallbacks(issue: Issue) {
  return {
    onTaskUpdate: () => { rerenderViewsCallback?.(); void refreshHistory(); },
    onTaskOrderSave: () => saveTaskOrder(issue),
    onTaskEditStart,
    onTaskEditEnd,
  };
}

function onTaskEditStart(saveTask: () => unknown) {
  _saveEditingTaskFn = saveTask;
  syncUnloadListener();
}

function onTaskEditEnd() {
  _saveEditingTaskFn = null;
  syncUnloadListener();
}

function setupInlineEditing() {
  const titleInput = byId('title', HTMLInputElement);
  const titleCounter = initCharCounter(titleInput, MAX_TITLE_LENGTH, { manual: true });

  const descEditor = byId('description-editor', HTMLTextAreaElement);
  const descContainer = bySelector(document, '.editor-container');
  const descEditActions = byId('description-edit-actions');
  const descCancelBtn = byId('desc-cancel-btn');
  const descSaveBtn = byId('desc-save-btn');

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
      void _saveTitleFn();
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
    if (newTitle !== openIssue().title) {
      try {
        const saved = await saveIssueChanges(() => ({ title: newTitle }), 'Title updated');
        if (!saved) return false; // Conflict occurred - stay in edit mode

        // The saved title is the server's, cleaned of e.g. HTML tags and null bytes.
        const savedTitle = openIssue().title;
        titleInput.value = savedTitle;
        if (newTitle !== savedTitle) {
          showNotification('Unsupported HTML tags are not rendered for security.', 'error');
        }
      } catch (err) {
        showNotification(errorMessage(err), 'error');
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
    if (e.relatedTarget instanceof Element && e.relatedTarget.id === 'done-btn') return; // handleDone() will save it directly
    await saveTitle();
  });

  _saveTitleFn = saveTitle;
  _cancelTitleFn = cancelTitle;

  // Description — click on preview to enter edit mode
  const descPreview = byId('description-preview');

  descPreview.addEventListener('click', (e) => {
    const anchor = e.target instanceof Element ? e.target.closest('a') : null;
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
    exitMdPreview();
    syncUnloadListener();
  };

  // Returns false if the description could not be saved (editor stays open with the text).
  const doSaveDesc = async () => {
    const newDesc = descEditor.value;
    if (newDesc !== openIssue().description) {
      try {
        const saved = await saveIssueChanges(() => ({ description: newDesc }), 'Description updated');
        if (!saved) return false;
      } catch (err) {
        showNotification(errorMessage(err), 'error');
        return false;
      }
    }
    const { html, strippedHTML } = renderMarkdownWithReport(newDesc);
    descPreview.innerHTML = html;
    if (strippedHTML) {
      showNotification('Unsupported HTML tags are not rendered for security.', 'error');
    }
    descContainer.classList.add('inline-editable');
    descContainer.classList.remove('inline-editing');
    descEditor.classList.add('hidden');
    descPreview.classList.remove('hidden');
    descEditActions.classList.add('hidden');
    exitMdPreview();
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
  const descEditor = byId('description-editor', HTMLTextAreaElement);

  // Let queued field saves finish first, so closing the modal does not drop them.
  await issueSaveChain;

  // Title: auto-save (or revert if empty); a failed save keeps the modal open
  if (isTitleEditing() && !(await _saveTitleFn())) return;

  // Description: keep explicit prompt behavior; a failed save keeps the modal open
  if (isDescEditing()) {
    const descDone = await processFieldOnDone(descEditor.value !== originalDesc, 'Save description?', _saveDescFn, _cancelDescFn);
    if (!descDone) return;
  }

  // Tasks: auto-save the task currently in edit mode; a failed save keeps the modal open
  if (_saveEditingTaskFn && !(await _saveEditingTaskFn())) return;

  // New task and comments: never added or dropped without asking
  if (!(await processFieldOnDone(hasNewTaskText(), 'Add task?', _submitTaskFn, resetTaskForm, 'Add'))) return;
  const comment = getOpenCommentDraft();
  if (comment && !(await processFieldOnDone(comment.changed(), 'Save comment?', comment.save, comment.discard))) return;

  // An error toast, e.g. the warning that HTML was removed from the saved title, would be
  // replaced by "Issue updated" before it could be read.
  const showUpdatedNotification = state.currentIssue && hasSavedDuringSession && !isErrorToastShown();
  closeModal();
  if (showUpdatedNotification) {
    showNotification('Issue updated');
  }
}

// Unchanged text is discarded silently, changed text after asking the question.
// Returns false if the user chose to save but the save failed, so the modal must stay open.
async function processFieldOnDone(changed: boolean, question: string, saveFn: () => Promise<boolean>, cancelFn: () => void, saveText = 'Save') {
  if (changed && await showConfirm('Unsaved Changes', question, saveText, 'Discard', 'primary')) {
    return saveFn();
  }
  cancelFn();
  return true;
}

// Leaves every inline editor without saving, e.g. when the modal closes after archiving.
function leaveEditors() {
  if (isTitleEditing()) _cancelTitleFn();
  if (isDescEditing()) _cancelDescFn();
  closeCommentEditors();
}

export function preventNavigation(e: BeforeUnloadEvent) {
  e.preventDefault();
}

// True while the title, description or a task is in inline edit mode, i.e. a re-render of
// the issue fields would overwrite the user's input.
function isEditing() {
  return isTitleEditing() || isDescEditing() || _saveEditingTaskFn !== null;
}

function isTitleEditing() {
  return byId('title', HTMLInputElement).classList.contains('inline-editing');
}

function isDescEditing() {
  return bySelector(document, '.editor-container').classList.contains('inline-editing');
}

function hasNewTaskText() {
  return byId('new-task-title', HTMLInputElement).value.trim() !== '';
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

function setDeadlineInput(issue: Issue) {
  const deadlineInput = byId('deadline', HTMLInputElement);
  deadlineInput.value = toDateInputValue(issue.deadline);
  updateDateInputStyle(deadlineInput);
}

// Saves the given fields of the current issue, with the field of the changed control
// busy until its save is done. On success they are applied to state.currentIssue; on
// conflict or error the sidebar is reset to the saved values.
async function saveSidebarField(changes: IssueChanges, successMsg: string | null, control: Element) {
  try {
    if (await markBusy(sidebarFieldOf(control), () => saveIssueChanges(() => changes, successMsg))) return true;
  } catch (err) {
    showNotification(errorMessage(err), 'error');
  }
  revertSidebarControls();
  return false;
}

// A sidebar field: the label and the control, dimmed together while saving.
function sidebarFieldOf(control: Element) {
  return control.closest('.form-group');
}

function plannedDatesField() {
  return sidebarFieldOf(byId('planned-dates-container'));
}

// Saves the planned dates of the current issue, with their field busy until the save is done.
function savePlannedDates(getChanges: (issue: Issue) => IssueChanges, successMessage: string) {
  return markBusy(plannedDatesField(), () => saveIssueChanges(getChanges, successMessage));
}

async function handleDeadlineChange(rawValue: string) {
  if (!state.currentIssue) return;
  const dateVal = rawValue ? new Date(rawValue + 'T12:00:00') : null;
  if (!(await saveSidebarField({ deadline: dateVal }, null, byId('deadline', HTMLInputElement)))) return;
  const dlStatus = getDeadlineStatus({ deadline: dateVal, release: state.currentIssue.release });
  byId('deadline-display').classList.toggle('overdue', dlStatus.late);
  const lateTaskCount = refreshTaskDeadlineStyles();
  const taskSuffix = lateTaskCount === 1 ? '' : 's';
  const taskWarning = lateTaskCount > 0 ? ` — ${lateTaskCount} task${taskSuffix} past deadline` : '';
  showNotification(
    dlStatus.late ? `Deadline updated — ${dlStatus.reason}${taskWarning}` : `Deadline updated${taskWarning}`,
    dlStatus.late || lateTaskCount > 0 ? 'warning' : 'success'
  );
}

function setupSidebarImmediateSave() {

  const deadlineInput = byId('deadline', HTMLInputElement);

  const statusSelect = byId('status', HTMLInputElement);
  const labelSelect = byId('label-select', HTMLInputElement);
  const prioritySelect = byId('priority', HTMLInputElement);
  const assigneeSelect = byId('assignee-select', HTMLInputElement);

  prioritySelect.addEventListener('change', async () => {
    // The hidden input only ever holds a value of the priority dropdown.
    if (state.currentIssue) await saveSidebarField({ priority: prioritySelect.value as Priority }, 'Priority updated', prioritySelect);
  });

  statusSelect.addEventListener('change', async () => {
    // The hidden input only ever holds a value of the status dropdown.
    if (state.currentIssue) await saveSidebarField({ status: statusSelect.value as IssueStatus }, 'Status updated', statusSelect);
  });

  assigneeSelect.addEventListener('change', async () => {
    if (state.currentIssue) {
      const val = assigneeSelect.value;
      const assigneeID = val ? Number.parseInt(val) : null;
      await saveSidebarField({ assignee_id: assigneeID }, 'Assignee updated', assigneeSelect);
    }
  });

  deadlineInput.addEventListener('change', () => handleDeadlineChange(deadlineInput.value));
  labelSelect.addEventListener('change', async () => {
    if (state.currentIssue) {
      const val = labelSelect.value;
      const labelVal = val ? { id: Number.parseInt(val) } : null;
      await saveSidebarField({ label: labelVal }, 'Label updated', labelSelect);
    }
  });

  const releaseSelect = byId('release-select', HTMLInputElement);
  releaseSelect.addEventListener('change', async () => {
    if (state.currentIssue) {
      const val = releaseSelect.value;
      const releaseId = val ? Number.parseInt(val) : null;
      if (await saveSidebarField({ release_id: releaseId }, 'Release updated', releaseSelect)) {
        const dlStatus = getDeadlineStatus(state.currentIssue);
        byId('deadline-display').classList.toggle('overdue', dlStatus.late);
        if (dlStatus.late) showNotification(`Release updated — deadline is ${dlStatus.reason}`, 'warning');
      }
    }
  });

  const projectSelect = byId('project-select', HTMLInputElement);
  projectSelect.addEventListener('change', async () => {
    const val = projectSelect.value;
    const projectId = val ? Number.parseInt(val) : DEFAULT_PROJECT_ID;

    if (state.currentIssue) {
      // Queued like the field saves: a save still in flight would otherwise finish after
      // the move and set currentEtag back to the ETag from before the move.
      await enqueueIssueWrite(() => moveIssueToProject(projectId));
    } else {
      localStorage.setItem('wuflow_selectedProjectId', String(projectId));
      await loadProjectOptions(projectId);
    }
  });
}

async function moveIssueToProject(projectId: number) {
  const issue = state.currentIssue;
  if (!issue) return;
  const projectSelect = byId('project-select', HTMLInputElement);
  const result: { moved?: Awaited<ReturnType<typeof moveIssue>> } = {};
  const confirmed = await promptAdminPasswordConfirmation(
    'Move Issue to another Project',
    'Do you really want to move this issue to another project?\nIts label, release, and status will be reset, since these fields are project-specific and cannot be preserved across projects.',
    async (adminPassword) => {
      result.moved = await moveIssue(issue.project_id, issue.id, projectId, adminPassword);
    },
    'Move Issue',
    'primary'
  );
  if (!confirmed || !result.moved) {
    projectSelect.value = String(issue.project_id);
    byId('project-text').textContent = issue.project?.name ?? '';
    return;
  }
  const { issue: updated, etag } = result.moved;
  currentEtag = etag;
  setCurrentIssue(updated);
  localStorage.setItem('wuflow_selectedProjectId', String(projectId));
  await loadProjectOptions(projectId);
  setupEditModal(updated);
  showNotification('Project changed', 'info');
}

// Task Logic Helpers
function refreshTaskDeadlineStyles() {
  let lateCount = 0;
  document.querySelectorAll('#task-list .task-item').forEach(li => {
    const input = li.querySelector<HTMLInputElement>('.task-deadline-input');
    const display = li.querySelector('.task-deadline-display');
    const container = li.querySelector<HTMLElement>('.task-deadline-container');
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
  byId('new-task-title', HTMLInputElement).value = '';
  const deadline = byId('new-task-deadline', HTMLInputElement);
  deadline.value = '';
  updateDateInputStyle(deadline);
}

// Returns true if the task was added.
async function handleTaskSubmit() {
  if (!state.currentIssue) return false;
  if (!userCan(state.currentUser, ACTION_CREATE_TASK)) return false;
  const titleInput = byId('new-task-title', HTMLInputElement);
  const deadlineInput = byId('new-task-deadline', HTMLInputElement);
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
    state.currentIssue.tasks ??= [];
    state.currentIssue.tasks.push(newTask);
    renderTasks(state.currentIssue.tasks, byId('task-list'), state.currentIssue, taskCallbacks(state.currentIssue));
    resetTaskForm();
    syncUnloadListener();
    const taskDlStatus = getTaskDeadlineStatus(taskData.deadline, state.currentIssue);
    showNotification(taskDlStatus.late ? `Task created — ${taskDlStatus.reason}` : 'Task created', taskDlStatus.late ? 'warning' : 'success');
    if (rerenderViewsCallback) rerenderViewsCallback();
    void refreshHistory();
    return true;
  } catch (err) {
    showNotification(errorMessage(err), 'error');
    return false;
  }
}

async function saveTaskOrder(issue: Issue) {
  const tasks = issue.tasks;
  if (!tasks || !userCan(state.currentUser, ACTION_UPDATE_TASK)) return;
  const taskItems = [...document.querySelectorAll<HTMLElement>('#task-list .task-item')];
  const positions: PositionUpdate[] = [];
  const previous: { task: Task; position: number }[] = [];
  taskItems.forEach((item, index) => {
    const id = Number(item.dataset.id);
    const task = tasks.find(t => t.id === id);
    if (task && task.position !== index) {
      previous.push({ task, position: task.position });
      task.position = index;
      positions.push({ id, position: index });
    }
  });

  if (positions.length > 0) {
    try {
      await updateTaskPositions(issue.project_id, issue.id, positions);
      tasks.sort((a, b) => a.position - b.position);
    } catch (err) {
      showNotification(errorMessage(err), 'error');
      // The server saved none of the positions (all-or-nothing), so put the tasks back
      // in their old order; otherwise the unsaved order would look saved.
      previous.forEach(({ task, position }) => { task.position = position; });
      renderTasks(tasks, byId('task-list'), issue, taskCallbacks(issue));
    }
  }
}
