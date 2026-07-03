import { state, setCurrentIssue } from '../state.js';
import { getStatusOptions, getStatusLabel, STATUS_OPEN, STATUS_ARCHIVE } from '../status-config.js';
import { createIssue, updateIssue, archiveIssue, unarchiveIssue, moveIssue, createTask, updateTask, fetchLabelsByProject, fetchReleases, fetchStatusConfig, fetchIssueById, fetchUsers, fetchProjects, deleteIssue } from '../api.js';
import { showNotification, showConfirm, updateDateInputStyle, canArchive, initCharCounter, countCodepoints, getUserInitials, getDeadlineStatus, getTaskDeadlineStatus, formatDateTime } from '../utils.js';
import { MAX_TITLE_LENGTH, MAX_DESC_LENGTH } from '../validation-config.js';
import { PRIORITY_NORMAL, PRIORITY_OPTIONS, RELEASE_STATUS_CLOSED } from '../domain-constants.js';
import { renderMarkdown } from '../markdown.js';
import { userCan, ACTION_CREATE_ISSUE, ACTION_UPDATE_ISSUE, ACTION_DELETE_ISSUE, ACTION_ARCHIVE_ISSUE, ACTION_UNARCHIVE_ISSUE, ACTION_MOVE_ISSUE, ACTION_CREATE_TASK, ACTION_UPDATE_TASK } from '../permissions.js';
import { renderTasks } from './tasks.js';
import { getDragAfterTaskElement, getDraggedTask } from '../drag.js';

let refreshAppCallback = null;
let rerenderViewsCallback = null;
let previousActiveNavBtn = null;
let currentEtag = null; // Stores ETag for conflict detection
let hasSavedDuringSession = false; // Tracks whether any save occurred in this modal session

export function setupModal(refreshApp, rerenderViews) {
  refreshAppCallback = refreshApp;
  rerenderViewsCallback = rerenderViews;
  const form = document.getElementById('issue-form');

  // Global checking of state is tricky if we don't have reference to 'currentIssue' variable in app.js
  // We use state.currentIssue.

  document.getElementById('cancel-btn').addEventListener('click', closeModal);
  document.getElementById('done-btn').addEventListener('click', handleDone);
  form.addEventListener('submit', handleIssueSubmit);


  document.getElementById('delete-issue-btn').addEventListener('click', handleDeleteIssue);
  document.getElementById('archive-issue-btn').addEventListener('click', handleArchiveIssue);
  document.getElementById('unarchive-issue-btn').addEventListener('click', handleUnarchiveIssue);

  setupInlineEditing();
  setupEditorToolbar();
  setupSidebarImmediateSave();

  // Character counters
  initCharCounter(document.getElementById('description-editor'), MAX_DESC_LENGTH, { className: 'editor-counter' });
  initCharCounter(document.getElementById('new-task-title'), MAX_TITLE_LENGTH, { className: 'task-title-counter' });

  // Task Form
  document.getElementById('add-task-btn').addEventListener('click', handleTaskSubmit);
  document.getElementById('new-task-title').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleTaskSubmit(e);
    }
  });

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

export async function openModal(issue = null) {
  const modal = document.getElementById('issue-modal');
  modal.classList.remove('hidden');
  hasSavedDuringSession = false;

  if (issue) {
    // Show loading state to prevent interaction while fetching fresh data
    const modalContent = modal.querySelector('.modal-content');
    modalContent.classList.add('loading-state');

    // Clear stale content so the previous issue's data isn't visible under the loading overlay.
    // Use direct .value assignment (not form.reset()) to avoid triggering change event listeners.
    document.getElementById('title').value = '';
    document.getElementById('description-editor').value = '';
    document.getElementById('description-preview').innerHTML = '';

    // Fetch fresh data from server to ensure we have latest version
    try {
      const { issue: freshIssue, etag } = await fetchIssueById(issue.project_id, issue.id);

      modalContent.classList.remove('loading-state');

      if (!freshIssue) {
        showNotification('Issue not found or was deleted', 'error');
        closeModal();
        return;
      }
      currentEtag = etag;
      setCurrentIssue(freshIssue);
      renderModalDropdowns(freshIssue);
      setupEditModal(freshIssue);
    } catch (e) {
      modalContent.classList.remove('loading-state');
      console.error(e);
      showNotification('Failed to load issue', 'error');
      modal.classList.add('hidden');
    }
  } else {
    currentEtag = null;
    setCurrentIssue(null);
    renderModalDropdowns(null);
    setupNewModal();
  }
  resetTaskForm();
}

function setupProjectDropdown(issue) {
  const projectInput = document.getElementById('project-select');
  const projectText = document.getElementById('project-text');
  const projectTrigger = document.getElementById('project-trigger');
  if (!projectInput || !projectText) return;

  const storedProjectId = issue ? null : localStorage.getItem('wuflow_selectedProjectId');
  projectInput.value = issue?.project_id ?? (storedProjectId ? Number.parseInt(storedProjectId) : 1);
  projectText.textContent = issue?.project?.name ?? 'default';

  fetchProjects().then(projects => {
    renderProjectOptions(projects);
    const currentId = Number.parseInt(projectInput.value);
    const found = projects.find(p => p.id === currentId);
    if (found) projectText.textContent = found.name;
  }).catch(err => console.error('Failed to load projects', err));

  if (projectTrigger) {
    const restricted = !!issue && !userCan(state.currentUser, ACTION_MOVE_ISSUE);
    projectTrigger.disabled = restricted;
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
  fetchLabelsByProject(labelProjectId).then(labels => {
    renderLabelOptions(labels);
    if (issue?.label) {
      const found = labels.find(l => l.id === issue.label.id);
      if (found) labelText.textContent = found.name;
    }
  }).catch(err => console.error('Failed to load labels', err));

  // Assignee Dropdown
  const assigneeInput = document.getElementById('assignee-select');
  const assigneeText = document.getElementById('assignee-text');
  assigneeInput.value = issue?.assignee_id ?? '';
  assigneeText.textContent = issue?.assignee ? (issue.assignee.first_name + ' ' + issue.assignee.last_name) : 'Unassigned';

  fetchUsers().then(users => {
    renderAssigneeOptions(users);
    if (issue?.assignee_id) {
      const found = users.find(u => u.id === issue.assignee_id);
      if (found) assigneeText.textContent = found.first_name + ' ' + found.last_name;
    }
  }).catch(err => console.error('Failed to load users', err));

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
  const isArchived = issue.status === STATUS_ARCHIVE;
  document.getElementById('modal-title').textContent = isArchived ? `Archived Issue #${issue.id}` : `Edit Issue #${issue.id}`;
  document.getElementById('issue-id').value = issue.id;
  document.getElementById('title').value = issue.title;
  document.getElementById('description-editor').value = issue.description || '';
  const { html } = renderMarkdown(issue.description || '', true);
  document.getElementById('description-preview').innerHTML = html;
  // We do NOT show the toast on initial load to avoid spamming the user when opening an issue with old bad data,
  // we only show the error on active edit actions (Save / Preview).

  // Planned Date Chip Logic
  renderPlannedDateChips(issue);

  document.getElementById('deadline').value = issue.deadline ? new Date(issue.deadline).toISOString().slice(0, 10) : '';

  updateDateInputStyle(document.getElementById('deadline'));
  document.getElementById('deadline-display')?.classList.toggle('overdue', getDeadlineStatus(issue).late);

  document.getElementById('tasks-section').classList.remove('hidden');
  document.getElementById('task-form-container').classList.toggle('hidden', isArchived);

  renderTasks(issue.tasks || [], document.getElementById('task-list'), issue, {
    readOnly: isArchived,
    onTaskUpdate: () => rerenderViewsCallback?.(),
    onTaskOrderSave: async () => {
      await saveTaskOrder(issue);
    },
    onTaskEditStart: () => addUnloadListener(),
    onTaskEditEnd: () => checkRemoveUnloadListener()
  });

  const user = state.currentUser;
  const canDelete = !isArchived && userCan(user, ACTION_DELETE_ISSUE);
  const canArchBtn = !isArchived && userCan(user, ACTION_ARCHIVE_ISSUE);
  const canUnarchBtn = isArchived && userCan(user, ACTION_UNARCHIVE_ISSUE);
  document.getElementById('delete-issue-btn').classList.toggle('hidden', !canDelete);
  document.getElementById('archive-issue-btn').classList.toggle('hidden', !canArchBtn);
  document.getElementById('unarchive-issue-btn').classList.toggle('hidden', !canUnarchBtn);

  renderModalTimestamps(issue);

  // Read-Only UI Adjustments
  const dateInputs = document.querySelectorAll('.custom-date-input');
  dateInputs.forEach(el => {
    el.style.pointerEvents = isArchived ? 'none' : '';
    el.style.opacity = isArchived ? '0.7' : '';
  });

  const dropdownTriggers = document.querySelectorAll('.custom-select-trigger');
  dropdownTriggers.forEach(el => {
    el.style.pointerEvents = isArchived ? 'none' : '';
    el.style.opacity = isArchived ? '0.7' : '';
  });

  // Enable inline edit mode (handlers will check for archive status)
  toggleInlineEditMode(true);

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
  document.getElementById('delete-issue-btn').classList.add('hidden');
  document.getElementById('archive-issue-btn').classList.add('hidden');
  document.getElementById('unarchive-issue-btn').classList.add('hidden');
  document.getElementById('timestamp-container')?.classList.add('hidden');

  toggleInlineEditMode(false);

  document.querySelectorAll('.custom-date-input, .custom-select-trigger').forEach(el => {
    el.style.pointerEvents = '';
    el.style.opacity = '';
  });

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

function toggleInlineEditMode(enable) {
  const titleInput = document.getElementById('title');
  const descContainer = document.querySelector('.editor-container');
  const descEditor = document.getElementById('description-editor');
  const descPreview = document.getElementById('description-preview');
  const descEditActions = document.getElementById('description-edit-actions');

  resetMdPreview(descPreview);

  if (enable) {
    titleInput.classList.add('inline-editable');
    titleInput.readOnly = true;
    descContainer.classList.add('inline-editable');
    descEditor.classList.add('hidden');
    descPreview.classList.remove('hidden');
    descEditActions.classList.add('hidden');
  } else {
    titleInput.classList.remove('inline-editable');
    titleInput.readOnly = false;
    descContainer.classList.remove('inline-editable');
    descEditor.classList.remove('hidden');
    descPreview.classList.add('hidden');
    descEditActions.classList.add('hidden');
  }
}

function renderTimestampEntry(container, dateStr, user) {
  if (!dateStr) {
    container.textContent = '-';
    return;
  }
  container.innerHTML = '';
  const dateText = formatDateTime(dateStr);

  const dateSpan = document.createElement('span');
  dateSpan.textContent = dateText;
  container.appendChild(dateSpan);

  if (user) {
    const bySpan = document.createElement('span');
    bySpan.textContent = 'by';
    container.appendChild(bySpan);

    const badge = document.createElement('div');
    badge.className = 'user-badge small';
    badge.textContent = getUserInitials(user);
    badge.title = `${user.first_name} ${user.last_name}`;
    badge.style.display = 'inline-flex';
    container.appendChild(badge);
  }
}

function renderModalTimestamps(issue) {
  const timestampContainer = document.getElementById('timestamp-container');
  const createdAtDisplay = document.getElementById('created-at-display');
  const updatedAtDisplay = document.getElementById('updated-at-display');

  if (!timestampContainer || !createdAtDisplay || !updatedAtDisplay) return;

  renderTimestampEntry(createdAtDisplay, issue.created_at, issue.creator);
  renderTimestampEntry(updatedAtDisplay, issue.updated_at, issue.updater);

  timestampContainer.classList.remove('hidden');
}

export function closeModal() {
  document.getElementById('issue-modal').classList.add('hidden');
  document.querySelectorAll('.custom-date-input, .custom-select-trigger').forEach(el => {
    el.style.pointerEvents = '';
    el.style.opacity = '';
  });
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
  resetTaskForm();
  if (refreshAppCallback) refreshAppCallback();
}

/**
 * Helper function to save issue with conflict detection.
 * Returns true if save succeeded, false if conflict occurred.
 */
async function saveIssueWithConflictCheck(issue, successMessage) {
  const result = await updateIssue(issue.project_id, issue, currentEtag);

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
    return false;
  }

  // Update stored ETag with new value
  currentEtag = result.etag;
  hasSavedDuringSession = true;
  if (successMessage) showNotification(successMessage);
  if (rerenderViewsCallback) rerenderViewsCallback();
  return true;
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

async function handleIssueSubmit(e) {
  e.preventDefault();

  const issueData = getIssueDataFromForm();
  if (!validateIssueForm(issueData.title, issueData.description)) return;

  try {
    if (state.currentIssue) {
      if (!userCan(state.currentUser, ACTION_UPDATE_ISSUE)) return;
      issueData.id = state.currentIssue.id;
      const result = await updateIssue(issueData.project_id, issueData, currentEtag);
      if (result.conflict) {
        await saveIssueWithConflictCheck(issueData, 'Issue updated');
      }
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
  if (await showConfirm('Delete Issue', `Delete "${state.currentIssue.title}"?`, 'Delete')) {
    try {
      await deleteIssue(state.currentIssue.project_id, state.currentIssue.id);
      closeModal();
      showNotification('Issue deleted');
    } catch (err) {
      showNotification(err.message, 'error');
    }
  }
}

async function handleArchiveIssue() {
  if (!state.currentIssue) return;
  if (!userCan(state.currentUser, ACTION_ARCHIVE_ISSUE)) return;

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
      addUnloadListener();
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
    checkRemoveUnloadListener();
  };

  const saveTitle = async () => {
    const newTitle = titleInput.value.trim();
    if (!newTitle) {
      cancelTitle(); // Revert to original if empty
      return;
    }
    if (newTitle !== state.currentIssue.title) {
      // Create a copy to avoid mutating state before save succeeds
      const updatedIssue = { ...state.currentIssue, title: newTitle };
      try {
        const saved = await saveIssueWithConflictCheck(updatedIssue, 'Title updated');
        if (!saved) return; // Conflict occurred - stay in edit mode

        // Fetch fresh copy to ensure frontend model exactly matches backend 
        // sanitization (e.g. stripped HTML tags / null bytes in Title).
        const { issue: freshIssue } = await fetchIssueById(state.currentIssue.project_id, state.currentIssue.id);
        if (freshIssue) {
          state.currentIssue.title = freshIssue.title;
          if (titleInput.value !== freshIssue.title) {
            titleInput.value = freshIssue.title;
            showNotification('Unsupported HTML tags are not rendered for security.', 'error');
          }
        }
      } catch (err) {
        showNotification(err.message, 'error');
        return; // Keep edit mode
      }
    }
    titleInput.classList.add('inline-editable');
    titleInput.classList.remove('inline-editing');
    titleInput.readOnly = true;
    titleCounter.hide();
    checkRemoveUnloadListener();
  };

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
      addUnloadListener();
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
    checkRemoveUnloadListener();
  };

  const saveDesc = async () => {
    const newDesc = descEditor.value;
    if (newDesc !== state.currentIssue.description) {
      const updatedIssue = { ...state.currentIssue, description: newDesc };
      try {
        const saved = await saveIssueWithConflictCheck(updatedIssue, 'Description updated');
        if (!saved) return;
        if (state.currentIssue) state.currentIssue.description = newDesc;
      } catch (err) {
        showNotification(err.message, 'error');
        return;
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
    checkRemoveUnloadListener();
  };

  descCancelBtn.addEventListener('mousedown', (e) => { e.preventDefault(); cancelDesc(); });
  descSaveBtn.addEventListener('mousedown', (e) => { e.preventDefault(); saveDesc(); });
}

async function handleDone() {
  const titleInput = document.getElementById('title');
  const descEditor = document.getElementById('description-editor');

  // Title: auto-save (or revert if empty), then check if conflict kept us in edit mode
  if (titleInput.classList.contains('inline-editing')) {
    await _saveTitleFn();
    if (titleInput.classList.contains('inline-editing')) return; // Conflict - don't close
  }

  // Description: keep explicit prompt behavior
  if (document.querySelector('.editor-container').classList.contains('inline-editing')) {
    await processFieldOnDone(
      descEditor.value,
      originalDesc,
      'Description',
      'desc-save-btn',
      'desc-cancel-btn'
    );
  }

  // Tasks: trigger blur to auto-save any currently editing task input
  const editingTask = document.querySelector('.task-item.editing');
  if (editingTask) {
    editingTask.querySelector('.task-title-input').blur();
  }

  const showUpdatedNotification = state.currentIssue && hasSavedDuringSession;
  closeModal();
  if (showUpdatedNotification) {
    showNotification('Issue updated');
  }
}

async function processFieldOnDone(currentValue, originalValue, fieldName, saveBtnId, cancelBtnId) {
  if (currentValue === originalValue) {
    document.getElementById(cancelBtnId).dispatchEvent(new MouseEvent('mousedown'));
    return;
  }

  if (await showConfirm('Unsaved Changes', `Save ${fieldName}?`, 'Save', 'Discard', 'primary')) {
    document.getElementById(saveBtnId).dispatchEvent(new MouseEvent('mousedown'));
  } else {
    document.getElementById(cancelBtnId).dispatchEvent(new MouseEvent('mousedown'));
  }
}

export function preventNavigation(e) {
  e.preventDefault();
  e.returnValue = '';
}

function addUnloadListener() {
  window.addEventListener('beforeunload', preventNavigation);
}

function removeUnloadListener() {
  window.removeEventListener('beforeunload', preventNavigation);
}

function checkRemoveUnloadListener() {
  const titleEditing = document.getElementById('title').classList.contains('inline-editing');
  const descEditing = document.querySelector('.editor-container').classList.contains('inline-editing');
  const taskEditing = document.querySelector('.task-item.editing') !== null;
  if (!titleEditing && !descEditing && !taskEditing) {
    removeUnloadListener();
  }
}

async function handleDeadlineChange(rawValue) {
  if (!state.currentIssue) return;
  const dateVal = rawValue ? new Date(rawValue + 'T12:00:00') : null;
  const updatedIssue = { ...state.currentIssue, deadline: dateVal };
  try {
    const saved = await saveIssueWithConflictCheck(updatedIssue, null);
    if (!saved) return;
    state.currentIssue.deadline = dateVal;
    const dlStatus = getDeadlineStatus({ deadline: dateVal, release: state.currentIssue.release });
    document.getElementById('deadline-display')?.classList.toggle('overdue', dlStatus.late);
    const lateTaskCount = refreshTaskDeadlineStyles();
    const taskSuffix = lateTaskCount === 1 ? '' : 's';
    const taskWarning = lateTaskCount > 0 ? ` — ${lateTaskCount} task${taskSuffix} past deadline` : '';
    showNotification(
      dlStatus.late ? `Deadline updated — ${dlStatus.reason}${taskWarning}` : `Deadline updated${taskWarning}`,
      dlStatus.late || lateTaskCount > 0 ? 'warning' : 'success'
    );
  } catch (err) {
    showNotification(err.message, 'error');
  }
}

function setupSidebarImmediateSave() {

  const deadlineInput = document.getElementById('deadline');

  const statusSelect = document.getElementById('status');
  const labelSelect = document.getElementById('label-select');
  const prioritySelect = document.getElementById('priority');
  const assigneeSelect = document.getElementById('assignee-select');

  prioritySelect.addEventListener('change', async () => {
    if (state.currentIssue) {
      const updatedIssue = { ...state.currentIssue, priority: prioritySelect.value };
      try {
        const saved = await saveIssueWithConflictCheck(updatedIssue, 'Priority updated');
        if (saved) state.currentIssue.priority = prioritySelect.value;
      } catch (err) {
        showNotification(err.message, 'error');
        // Revert UI? Ideally yes, but tricky without knowing prev value. 
        // For now, at least user sees error.
      }
    }
  });

  statusSelect.addEventListener('change', async () => {
    if (state.currentIssue) {
      const updatedIssue = { ...state.currentIssue, status: statusSelect.value };
      try {
        const saved = await saveIssueWithConflictCheck(updatedIssue, 'Status updated');
        if (saved) state.currentIssue.status = statusSelect.value;
      } catch (err) {
        showNotification(err.message, 'error');
      }
    }
  });

  if (assigneeSelect) {
    assigneeSelect.addEventListener('change', async () => {
      if (state.currentIssue) {
        const val = assigneeSelect.value;
        const assigneeID = val ? Number.parseInt(val) : null;
        const updatedIssue = { ...state.currentIssue, assignee_id: assigneeID };
        try {
          const saved = await saveIssueWithConflictCheck(updatedIssue, 'Assignee updated');
          if (saved) {
            state.currentIssue.assignee_id = assigneeID;
            // Re-fetch issue to get the populated assignee object for UI
            const { issue: freshIssue } = await fetchIssueById(state.currentIssue.project_id, state.currentIssue.id);
            if (freshIssue) state.currentIssue.assignee = freshIssue.assignee;
          }
        } catch (err) {
          showNotification(err.message, 'error');
        }
      }
    });
  }

  deadlineInput.addEventListener('change', () => handleDeadlineChange(deadlineInput.value));
  if (labelSelect) {
    labelSelect.addEventListener('change', async () => {
      if (state.currentIssue) {
        const val = labelSelect.value;
        const labelVal = val ? { id: Number.parseInt(val) } : null;
        const updatedIssue = { ...state.currentIssue, label: labelVal };
        try {
          const saved = await saveIssueWithConflictCheck(updatedIssue, 'Label updated');
          if (saved) state.currentIssue.label = labelVal;
        } catch (err) {
          showNotification(err.message, 'error');
        }
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
        const updatedIssue = { ...state.currentIssue, release_id: releaseId, release };
        try {
          const saved = await saveIssueWithConflictCheck(updatedIssue, 'Release updated');
          if (saved) {
            state.currentIssue.release_id = releaseId;
            state.currentIssue.release = release;
            const dlStatus = getDeadlineStatus(state.currentIssue);
            document.getElementById('deadline-display')?.classList.toggle('overdue', dlStatus.late);
            if (dlStatus.late) showNotification(`Release updated — deadline is ${dlStatus.reason}`, 'warning');
          }
        } catch (err) {
          showNotification(err.message, 'error');
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
        const confirmed = await showConfirm(
          'Move Issue to another Project',
          'Moving this issue will reset its label, release, and status. These fields are project-specific and cannot be preserved across projects. Do you want to continue?',
          'Move Issue',
          'Cancel',
          'primary'
        );
        if (!confirmed) {
          projectSelect.value = state.currentIssue.project_id;
          document.getElementById('project-text').textContent = state.currentIssue.project?.name ?? '';
          return;
        }
        try {
          const { issue: updated, etag } = await moveIssue(state.currentIssue.project_id, state.currentIssue.id, projectId);
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
        } catch (err) {
          showNotification(err.message, 'error');
        }
      } else {
        localStorage.setItem('wuflow_selectedProjectId', String(projectId));
      }
    });
  }
}

function needsLeadingNewline(value, pos) {
  return pos > 0 && value[pos - 1] !== '\n';
}

function setupEditorToolbar() {
  const editor = document.getElementById('description-editor');
  const preview = document.getElementById('description-preview');

  function handleEnterKey(e) {
    const start = editor.selectionStart;
    const value = editor.value;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const currentLine = value.substring(lineStart, start);

    const bulletMatch = currentLine.match(/^(\s*)([-*+]) (.*)$/);
    const numberedMatch = currentLine.match(/^(\s*)(\d+)\. (.*)$/);
    if (!bulletMatch && !numberedMatch) return;

    e.preventDefault();
    const [, indent, marker, content] = bulletMatch ?? numberedMatch;
    const isBullet = !!bulletMatch;

    if (content === '') {
      // Empty list item: remove marker, stop list
      editor.value = value.substring(0, lineStart) + value.substring(start);
      editor.selectionStart = editor.selectionEnd = lineStart;
    } else {
      // Continue list
      const nextPrefix = isBullet
        ? `\n${indent}${marker} `
        : `\n${indent}${Number.parseInt(marker, 10) + 1}. `;
      editor.value = value.substring(0, start) + nextPrefix + value.substring(start);
      editor.selectionStart = editor.selectionEnd = start + nextPrefix.length;
    }
    editor.dispatchEvent(new Event('input'));
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
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) handleEnterKey(e);
    if (e.key === 'Tab') handleTabKey(e);
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

async function handleTaskSubmit(e) {
  if (!state.currentIssue) return;
  if (!userCan(state.currentUser, ACTION_CREATE_TASK)) return;
  const titleInput = document.getElementById('new-task-title');
  const deadlineInput = document.getElementById('new-task-deadline');
  if (!titleInput.value.trim()) return;
  if (countCodepoints(titleInput.value) > MAX_TITLE_LENGTH) {
    showNotification(`Task title must not exceed ${MAX_TITLE_LENGTH} characters.`, 'error');
    return;
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
    renderTasks(state.currentIssue.tasks, document.getElementById('task-list'), state.currentIssue, {
      onTaskUpdate: () => rerenderViewsCallback?.(),
      onTaskOrderSave: () => saveTaskOrder(state.currentIssue),
      onTaskEditStart: () => addUnloadListener(),
      onTaskEditEnd: () => checkRemoveUnloadListener()
    });
    resetTaskForm();
    const taskDlStatus = getTaskDeadlineStatus(taskData.deadline, state.currentIssue);
    showNotification(taskDlStatus.late ? `Task created — ${taskDlStatus.reason}` : 'Task created', taskDlStatus.late ? 'warning' : 'success');
    if (rerenderViewsCallback) rerenderViewsCallback();
  } catch (err) {
    showNotification(err.message, 'error');
  }
}

async function saveTaskOrder(issue) {
  if (!userCan(state.currentUser, ACTION_UPDATE_TASK)) return;
  const taskItems = [...document.querySelectorAll('#task-list .task-item')];
  const updates = [];
  taskItems.forEach((item, index) => {
    const id = Number.parseInt(item.dataset.id);
    const task = issue.tasks.find(t => t.id === id);
    if (task && task.position !== index) {
      task.position = index;
      updates.push(updateTask(issue.project_id, issue.id, task));
    }
  });

  if (updates.length > 0) {
    try {
      await Promise.all(updates);
      issue.tasks.sort((a, b) => a.position - b.position);
    } catch (err) {
      showNotification(err.message, 'error');
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

async function addPlannedDate(dateStr) {
  // If editing existing issue
  if (state.currentIssue) {
    const currentDates = state.currentIssue.planned_dates || [];
    if (!currentDates.includes(dateStr)) {
      const newDates = [...currentDates, dateStr].sort((a, b) => a.localeCompare(b));
      const updatedIssue = { ...state.currentIssue, planned_dates: newDates };
      try {
        const saved = await saveIssueWithConflictCheck(updatedIssue, 'Date added');
        if (saved) {
          state.currentIssue.planned_dates = newDates;
          renderPlannedDateChips(state.currentIssue);
        }
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
      const newDates = state.currentIssue.planned_dates.filter(d => d !== dateStr);
      const updatedIssue = { ...state.currentIssue, planned_dates: newDates };
      try {
        const saved = await saveIssueWithConflictCheck(updatedIssue, 'Date removed');
        if (saved) {
          state.currentIssue.planned_dates = newDates;
          renderPlannedDateChips(state.currentIssue);
        }
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
