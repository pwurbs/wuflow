import { state, setCurrentIssue } from '../state.js';
import { createIssue, updateIssue, createTask, updateTask, fetchLabels, fetchIssueById } from '../api.js';
import { showNotification, showModalNotification, showConfirm, updateDateInputStyle, canArchive } from '../utils.js';
import { renderTasks } from './tasks.js';
import { getDragAfterTaskElement, getDraggedTask } from '../drag.js';

let refreshAppCallback = null;
let previousActiveNavBtn = null;
let currentEtag = null; // Stores ETag for conflict detection

export function setupModal(refreshApp) {
  refreshAppCallback = refreshApp;
  const form = document.getElementById('issue-form');

  // Global checking of state is tricky if we don't have reference to 'currentIssue' variable in app.js
  // We use state.currentIssue.

  document.getElementById('cancel-btn').addEventListener('click', closeModal);
  document.getElementById('cancel-btn').addEventListener('click', closeModal);
  document.getElementById('done-btn').addEventListener('click', handleDone);
  form.addEventListener('submit', handleIssueSubmit);
  form.addEventListener('submit', handleIssueSubmit);

  document.getElementById('delete-issue-btn').addEventListener('click', handleDeleteIssue);
  document.getElementById('archive-issue-btn').addEventListener('click', handleArchiveIssue);
  document.getElementById('unarchive-issue-btn').addEventListener('click', handleUnarchiveIssue);

  setupInlineEditing();
  setupEditorToolbar();
  setupSidebarImmediateSave();

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

  // Close dropdowns on outside click
  document.addEventListener('click', (e) => {
    ['status-dropdown', 'label-dropdown', 'priority-dropdown'].forEach(id => {
      const container = document.getElementById(id);
      if (container && !container.contains(e.target)) {
        container.querySelector('.custom-select-options').classList.add('hidden');
      }
    });
  });
}

export async function openModal(issue = null) {
  const modal = document.getElementById('issue-modal');
  modal.classList.remove('hidden');

  if (issue) {
    // Show loading state to prevent interaction while fetching fresh data
    const modalContent = modal.querySelector('.modal-content');
    modalContent.classList.add('loading-state');

    // Fetch fresh data from server to ensure we have latest version
    try {
      const { issue: freshIssue, etag } = await fetchIssueById(issue.id);

      modalContent.classList.remove('loading-state');

      if (!freshIssue) {
        showModalNotification('Issue not found or was deleted');
        modal.classList.add('hidden');
        if (refreshAppCallback) refreshAppCallback();
        return;
      }
      currentEtag = etag;
      setCurrentIssue(freshIssue);
      renderModalDropdowns(freshIssue);
      setupEditModal(freshIssue);
    } catch (e) {
      modalContent.classList.remove('loading-state');
      console.error(e);
      showModalNotification('Failed to load issue');
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

function renderModalDropdowns(issue) {
  // Status Dropdown
  const statusInput = document.getElementById('status');
  statusInput.value = issue?.status ?? 'Open';
  document.getElementById('status-text').textContent = issue?.status ?? 'Open';
  renderStatusOptions();

  // Priority Dropdown
  const priorityInput = document.getElementById('priority');
  priorityInput.value = issue?.priority ?? 'Normal';
  document.getElementById('priority-text').textContent = issue?.priority ?? 'Normal';
  renderPriorityOptions();

  // Label Dropdown
  const labelInput = document.getElementById('label-select');
  const labelText = document.getElementById('label-text');
  labelInput.value = issue?.label?.id ?? '';
  labelText.textContent = issue?.label?.name ?? 'No Label';

  fetchLabels().then(labels => {
    renderLabelOptions(labels);
    if (issue?.label) {
      const found = labels.find(l => l.id === issue.label.id);
      if (found) labelText.textContent = found.name;
    }
  }).catch(err => console.error('Failed to load labels', err));
}

function setupEditModal(issue) {
  const isArchived = issue.status === 'Archive';
  document.getElementById('modal-title').textContent = isArchived ? `Archived Issue #${issue.id}` : `Edit Issue #${issue.id}`;
  document.getElementById('issue-id').value = issue.id;
  document.getElementById('title').value = issue.title;
  document.getElementById('description-editor').innerHTML = issue.description || '';

  // Planned Date Chip Logic
  renderPlannedDateChips(issue);

  document.getElementById('deadline').value = issue.deadline ? new Date(issue.deadline).toISOString().slice(0, 10) : '';

  updateDateInputStyle(document.getElementById('deadline'));

  document.getElementById('tasks-section').classList.remove('hidden');
  document.getElementById('task-form-container').classList.toggle('hidden', isArchived);

  renderTasks(issue.tasks || [], document.getElementById('task-list'), issue, {
    readOnly: isArchived,
    onTaskUpdate: () => refreshAppCallback?.(),
    onTaskOrderSave: async () => {
      await saveTaskOrder(issue);
    },
    onTaskEditStart: () => addUnloadListener(),
    onTaskEditEnd: () => checkRemoveUnloadListener()
  });
  document.getElementById('delete-issue-btn').classList.remove('hidden');
  if (isArchived) {
    document.getElementById('archive-issue-btn').classList.add('hidden');
    document.getElementById('unarchive-issue-btn').classList.remove('hidden');
  } else {
    document.getElementById('archive-issue-btn').classList.remove('hidden');
    document.getElementById('unarchive-issue-btn').classList.add('hidden');
  }

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
  document.getElementById('description-editor').innerHTML = '';
  document.getElementById('issue-id').value = '';

  renderPlannedDateChips(null);

  updateDateInputStyle(document.getElementById('deadline'));

  document.getElementById('tasks-section').classList.add('hidden');
  document.getElementById('delete-issue-btn').classList.add('hidden');
  document.getElementById('archive-issue-btn').classList.add('hidden');
  document.getElementById('unarchive-issue-btn').classList.add('hidden');
  document.getElementById('timestamp-container')?.classList.add('hidden');

  toggleInlineEditMode(false);

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

function toggleInlineEditMode(enable) {
  const titleInput = document.getElementById('title');
  const descContainer = document.querySelector('.editor-container');
  const descEditor = document.getElementById('description-editor');
  const titleEditActions = document.getElementById('title-edit-actions');
  const descEditActions = document.getElementById('description-edit-actions');

  if (enable) {
    titleInput.classList.add('inline-editable');
    titleInput.readOnly = true;
    descContainer.classList.add('inline-editable');
    descEditor.contentEditable = "false";
    titleEditActions.classList.add('hidden');
    descEditActions.classList.add('hidden');
  } else {
    titleInput.classList.remove('inline-editable');
    titleInput.readOnly = false;
    descContainer.classList.remove('inline-editable');
    descEditor.contentEditable = "true";
    titleEditActions.classList.add('hidden');
    descEditActions.classList.add('hidden');
  }
}

function renderModalTimestamps(issue) {
  const timestampContainer = document.getElementById('timestamp-container');
  const createdAtDisplay = document.getElementById('created-at-display');
  const updatedAtDisplay = document.getElementById('updated-at-display');

  if (timestampContainer && createdAtDisplay && updatedAtDisplay) {
    if (issue.created_at) {
      const createdDate = new Date(issue.created_at);
      createdAtDisplay.textContent = createdDate.toLocaleDateString(navigator.language) + ' / ' + createdDate.toLocaleTimeString(navigator.language, { hour: '2-digit', minute: '2-digit' });
    } else {
      createdAtDisplay.textContent = '-';
    }

    if (issue.updated_at) {
      const updatedDate = new Date(issue.updated_at);
      updatedAtDisplay.textContent = updatedDate.toLocaleDateString(navigator.language) + ' / ' + updatedDate.toLocaleTimeString(navigator.language, { hour: '2-digit', minute: '2-digit' });
    } else {
      updatedAtDisplay.textContent = '-';
    }
    timestampContainer.classList.remove('hidden');
  }
}

export function closeModal() {
  document.getElementById('issue-modal').classList.add('hidden');
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
}

/**
 * Helper function to save issue with conflict detection.
 * Returns true if save succeeded, false if conflict occurred.
 */
async function saveIssueWithConflictCheck(issue, successMessage) {
  const result = await updateIssue(issue, currentEtag);

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
      const { issue: freshIssue, etag } = await fetchIssueById(issue.id);
      if (freshIssue) {
        currentEtag = etag;
        setCurrentIssue(freshIssue);
        renderModalDropdowns(freshIssue);
        setupEditModal(freshIssue);
        showModalNotification('Reloaded with latest data');
      }
    }
    // If Cancel clicked, do nothing - keep modal open with current data
    return false;
  }

  // Update stored ETag with new value
  currentEtag = result.etag;
  showModalNotification(successMessage);
  if (refreshAppCallback) refreshAppCallback();
  return true;
}

async function handleIssueSubmit(e) {
  e.preventDefault();
  const statusInput = document.getElementById('status');
  const issueData = {
    title: document.getElementById('title').value,
    description: document.getElementById('description-editor').innerHTML,
    deadline: document.getElementById('deadline').value ? new Date(document.getElementById('deadline').value + 'T12:00:00') : null,
    // planned_dates is handled by saving state.currentIssue instantly or by reading chips if new? 
    // Actually, for NEW issues, we need to grab the dates from state or DOM.
    // Let's assume for new issues we rely on the DOM container we built.
    planned_dates: getPlannedDatesFromDOM(),
    status: statusInput.value,
    priority: document.getElementById('priority').value,
    position: state.currentIssue ? state.currentIssue.position : 0
  };

  const labelId = document.getElementById('label-select').value;
  if (labelId) {
    issueData.label = { id: Number.parseInt(labelId) };
  } else {
    issueData.label = null;
  }

  if (state.currentIssue) {
    issueData.id = state.currentIssue.id;
    await updateIssue(issueData);
  } else {
    const newIssue = await createIssue(issueData);
    showNotification(`Issue #${newIssue.id} created successfully`);
  }
  closeModal();
  if (refreshAppCallback) refreshAppCallback();
}

async function handleDeleteIssue() {
  if (!state.currentIssue) return;
  if (await showConfirm('Delete Issue', `Delete "${state.currentIssue.title}"?`, 'Delete')) {
    await import('../api.js').then(m => m.deleteIssue(state.currentIssue.id));
    closeModal();
    if (refreshAppCallback) refreshAppCallback();
  }
}

async function handleArchiveIssue() {
  if (!state.currentIssue) return;

  const check = canArchive(state.currentIssue);
  if (!check.allowed) {
    await showConfirm('Cannot Archive', check.reason, 'OK', null, 'primary');
    return;
  }

  if (await showConfirm('Archive Issue', `Archive "${state.currentIssue.title}"?`, 'Archive', 'Cancel', 'primary')) {
    state.currentIssue.status = 'Archive';
    const success = await saveIssueWithConflictCheck(state.currentIssue, 'Issue archived');
    if (success) {
      closeModal();
    }
  }
}

async function handleUnarchiveIssue() {
  if (!state.currentIssue) return;
  if (await showConfirm('Unarchive Issue', `Move "${state.currentIssue.title}" back to specific status?`, 'Move to Done', 'Cancel', 'primary')) {
    state.currentIssue.status = 'Done';
    const success = await saveIssueWithConflictCheck(state.currentIssue, 'Issue unarchived');
    if (success) {
      closeModal();
    }
  }
}

// Inline Editing
let originalTitle = '';
let originalDesc = '';

function setupInlineEditing() {
  const titleInput = document.getElementById('title');
  const titleEditActions = document.getElementById('title-edit-actions');
  const titleCancelBtn = document.getElementById('title-cancel-btn');
  const titleSaveBtn = document.getElementById('title-save-btn');

  const descEditor = document.getElementById('description-editor');
  const descContainer = document.querySelector('.editor-container');
  const descEditActions = document.getElementById('description-edit-actions');
  const descCancelBtn = document.getElementById('desc-cancel-btn');
  const descSaveBtn = document.getElementById('desc-save-btn');

  // Title
  titleInput.addEventListener('click', () => {
    if (state.currentIssue?.status === 'Archive') return;
    if (titleInput.classList.contains('inline-editable')) {
      originalTitle = titleInput.value;
      titleInput.classList.remove('inline-editable');
      titleInput.classList.add('inline-editing');
      titleInput.readOnly = false;
      titleEditActions.classList.remove('hidden');
      titleInput.focus();
      addUnloadListener();
    }
  });

  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && titleInput.classList.contains('inline-editing')) {
      e.preventDefault();
      saveTitle();
    }
  });

  const cancelTitle = () => {
    titleInput.value = originalTitle;
    titleInput.classList.add('inline-editable');
    titleInput.classList.remove('inline-editing');
    titleInput.readOnly = true;
    titleEditActions.classList.add('hidden');
    checkRemoveUnloadListener();
  };

  const saveTitle = async () => {
    const newTitle = titleInput.value.trim();
    if (!newTitle) { cancelTitle(); return; }
    if (newTitle !== state.currentIssue.title) {
      // Create a copy to avoid mutating state before save succeeds
      const updatedIssue = { ...state.currentIssue, title: newTitle };
      const saved = await saveIssueWithConflictCheck(updatedIssue, 'Title updated');
      if (!saved) return; // Conflict occurred - state not updated, user can try again
      // Only update state after successful save (check for null in case modal closed during save)
      if (state.currentIssue) state.currentIssue.title = newTitle;
    }
    titleInput.classList.add('inline-editable');
    titleInput.classList.remove('inline-editing');
    titleInput.readOnly = true;
    titleEditActions.classList.add('hidden');
    checkRemoveUnloadListener();
  };

  titleCancelBtn.addEventListener('mousedown', (e) => { e.preventDefault(); cancelTitle(); });
  titleSaveBtn.addEventListener('mousedown', (e) => { e.preventDefault(); saveTitle(); });
  // Blur logic removed to prevent popup on click outside.
  // We now only check for changes when clicking Done or attempting to leave the page.


  // Description
  descEditor.addEventListener('click', (e) => {
    if (state.currentIssue?.status === 'Archive') return;
    let node = e.target;
    while (node && node !== descEditor) {
      if (node.tagName === 'A') {
        if (descContainer.classList.contains('inline-editable')) return;
        globalThis.open(node.href, '_blank');
        return;
      }
      node = node.parentNode;
    }
    if (descContainer.classList.contains('inline-editable')) {
      originalDesc = descEditor.innerHTML;
      descContainer.classList.remove('inline-editable');
      descContainer.classList.add('inline-editing');
      descEditor.contentEditable = "true";
      descEditActions.classList.remove('hidden');
      descEditor.focus();
      addUnloadListener();
    }
  });

  const cancelDesc = () => {
    descEditor.innerHTML = originalDesc;
    descContainer.classList.add('inline-editable');
    descContainer.classList.remove('inline-editing');
    descEditor.contentEditable = "false";
    descEditActions.classList.add('hidden');
    checkRemoveUnloadListener();
  };

  const saveDesc = async () => {
    const newDesc = descEditor.innerHTML;
    if (newDesc !== state.currentIssue.description) {
      // Create a copy to avoid mutating state before save succeeds
      const updatedIssue = { ...state.currentIssue, description: newDesc };
      const saved = await saveIssueWithConflictCheck(updatedIssue, 'Description updated');
      if (!saved) return; // Conflict occurred - state not updated, user can try again
      // Only update state after successful save (check for null in case modal closed during save)
      if (state.currentIssue) state.currentIssue.description = newDesc;
    }
    descContainer.classList.add('inline-editable');
    descContainer.classList.remove('inline-editing');
    descEditor.contentEditable = "false";
    descEditActions.classList.add('hidden');
    checkRemoveUnloadListener();
  };

  descCancelBtn.addEventListener('mousedown', (e) => { e.preventDefault(); cancelDesc(); });
  descSaveBtn.addEventListener('mousedown', (e) => { e.preventDefault(); saveDesc(); });
  // Blur logic removed.
}

async function handleDone() {
  const titleInput = document.getElementById('title');
  const descEditor = document.getElementById('description-editor');

  // Check Title
  if (titleInput.classList.contains('inline-editing')) {
    await processFieldOnDone(
      titleInput.value.trim(),
      originalTitle,
      'Title',
      'title-save-btn',
      'title-cancel-btn'
    );
  }

  // Check Description
  if (document.querySelector('.editor-container').classList.contains('inline-editing')) {
    await processFieldOnDone(
      descEditor.innerHTML,
      originalDesc,
      'Description',
      'desc-save-btn',
      'desc-cancel-btn'
    );
  }

  // Check Tasks
  const editingTasks = document.querySelectorAll('.task-item.editing');
  for (const taskItem of editingTasks) {
    const input = taskItem.querySelector('.task-title-input');
    const original = input.dataset.originalTitle;

    // If original is undefined, we still need to prompt
    if (!original || input.value.trim() !== original) {
      if (await showConfirm('Unsaved Changes', 'Save Task?', 'Save', 'Discard', 'primary')) {
        taskItem.querySelector('.inline-save-btn').dispatchEvent(new MouseEvent('mousedown'));
      } else {
        taskItem.querySelector('.inline-cancel-btn').dispatchEvent(new MouseEvent('mousedown'));
      }
    } else {
      taskItem.querySelector('.inline-cancel-btn').dispatchEvent(new MouseEvent('mousedown'));
    }
  }

  closeModal();
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

function preventNavigation(e) {
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

function setupSidebarImmediateSave() {

  const deadlineInput = document.getElementById('deadline');

  const statusSelect = document.getElementById('status');
  const labelSelect = document.getElementById('label-select');
  const prioritySelect = document.getElementById('priority');

  prioritySelect.addEventListener('change', async () => {
    if (state.currentIssue) {
      const updatedIssue = { ...state.currentIssue, priority: prioritySelect.value };
      const saved = await saveIssueWithConflictCheck(updatedIssue, 'Priority updated');
      if (saved) state.currentIssue.priority = prioritySelect.value;
    }
  });

  statusSelect.addEventListener('change', async () => {
    if (state.currentIssue) {
      const updatedIssue = { ...state.currentIssue, status: statusSelect.value };
      const saved = await saveIssueWithConflictCheck(updatedIssue, 'Status updated');
      if (saved) state.currentIssue.status = statusSelect.value;
    }
  });

  // Planned Date Input Listener REMOVED (Replaced by Chip Logic)
  deadlineInput.addEventListener('change', async () => {
    if (state.currentIssue) {
      const dateVal = deadlineInput.value ? new Date(deadlineInput.value + 'T12:00:00') : null;
      const updatedIssue = { ...state.currentIssue, deadline: dateVal };
      const saved = await saveIssueWithConflictCheck(updatedIssue, 'Deadline updated');
      if (saved) state.currentIssue.deadline = dateVal;
    }
  });
  if (labelSelect) {
    labelSelect.addEventListener('change', async () => {
      if (state.currentIssue) {
        const val = labelSelect.value;
        const labelVal = val ? { id: Number.parseInt(val) } : null;
        const updatedIssue = { ...state.currentIssue, label: labelVal };
        const saved = await saveIssueWithConflictCheck(updatedIssue, 'Label updated');
        if (saved) state.currentIssue.label = labelVal;
      }
    });
  }
}

function setupEditorToolbar() {
  const editor = document.getElementById('description-editor');
  const toolbarBtns = document.querySelectorAll('.editor-btn');

  function updateToolbarState() {
    // Implementation from app.js
    const selection = globalThis.getSelection();
    let inLink = false;
    if (selection.rangeCount > 0) {
      let node = selection.anchorNode;
      while (node && node !== editor && node !== document.body) {
        if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'A') {
          inLink = true;
          break;
        }
        node = node.parentNode;
      }
    }
    toolbarBtns.forEach(btn => {
      const cmd = btn.dataset.cmd;
      if (cmd === 'createLink') {
        btn.classList.toggle('active', inLink);
      } else if (cmd === 'underline') {
        // queryCommandState is deprecated but required for lightweight rich text editing
        btn.classList.toggle('active', !inLink && document.queryCommandState(cmd)); // NOSONAR
      } else {
        // queryCommandState is deprecated but required for lightweight rich text editing
        btn.classList.toggle('active', document.queryCommandState(cmd)); // NOSONAR
      }
    });
  }

  toolbarBtns.forEach(btn => {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const cmd = e.currentTarget.dataset.cmd;
      if (cmd === 'createLink') {
        const selection = globalThis.getSelection();
        let url = selection.toString().trim();
        if (url) {
          if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
          // execCommand is deprecated but required for lightweight rich text editing
          document.execCommand(cmd, false, url); // NOSONAR
          // Force target _blank
          let anchor = selection.anchorNode.parentElement?.tagName === 'A' ? selection.anchorNode.parentElement : null; // simplified finding
          if (anchor) anchor.target = '_blank';
        }
      } else {
        // execCommand is deprecated but required for lightweight rich text editing
        document.execCommand(cmd, false, null); // NOSONAR
      }
      editor.focus();
      updateToolbarState();
    });
  });

  if (editor) {
    editor.addEventListener('keyup', updateToolbarState);
    editor.addEventListener('mouseup', updateToolbarState);
    editor.addEventListener('input', (e) => {
      updateToolbarState();
      // Auto List Logic
      if (e.data === ' ') {
        const sel = globalThis.getSelection();
        if (sel.isCollapsed && sel.anchorNode.nodeType === Node.TEXT_NODE) {
          const anchorNode = sel.anchorNode;
          const offset = sel.anchorOffset;
          const text = anchorNode.textContent.slice(0, offset);

          if (/^[*|-]\s$/.test(text)) {
            const range = document.createRange();
            range.setStart(anchorNode, 0);
            range.setEnd(anchorNode, offset);
            sel.removeAllRanges();
            sel.addRange(range);
            // execCommand is deprecated but required for lightweight rich text editing
            document.execCommand('delete'); // NOSONAR
            // execCommand is deprecated but required for lightweight rich text editing
            document.execCommand('insertUnorderedList'); // NOSONAR
          } else if (/^1\.\s$/.test(text)) {
            const range = document.createRange();
            range.setStart(anchorNode, 0);
            range.setEnd(anchorNode, offset);
            sel.removeAllRanges();
            sel.addRange(range);
            // execCommand is deprecated but required for lightweight rich text editing
            document.execCommand('delete'); // NOSONAR
            // execCommand is deprecated but required for lightweight rich text editing
            document.execCommand('insertOrderedList'); // NOSONAR
          }
        }
      }
    });
  }
}

// Task Logic Helpers
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
  const titleInput = document.getElementById('new-task-title');
  const deadlineInput = document.getElementById('new-task-deadline');
  if (!titleInput.value.trim()) return;

  const taskData = {
    issue_id: state.currentIssue.id,
    title: titleInput.value,
    done: false,
    deadline: deadlineInput.value ? new Date(deadlineInput.value + 'T12:00:00') : null,
    position: state.currentIssue.tasks ? state.currentIssue.tasks.length : 0
  };

  const newTask = await createTask(taskData);
  if (!state.currentIssue.tasks) state.currentIssue.tasks = [];
  state.currentIssue.tasks.push(newTask);
  renderTasks(state.currentIssue.tasks, document.getElementById('task-list'), state.currentIssue, {
    onTaskUpdate: () => refreshAppCallback?.(),
    onTaskOrderSave: () => saveTaskOrder(state.currentIssue),
    onTaskEditStart: () => addUnloadListener(),
    onTaskEditEnd: () => checkRemoveUnloadListener()
  });
  resetTaskForm();
  if (refreshAppCallback) refreshAppCallback();
}

async function saveTaskOrder(issue) {
  const taskItems = [...document.querySelectorAll('#task-list .task-item')];
  const updates = [];
  taskItems.forEach((item, index) => {
    const id = Number.parseInt(item.dataset.id);
    const task = issue.tasks.find(t => t.id === id);
    if (task && task.position !== index) {
      task.position = index;
      updates.push(updateTask(task));
    }
  });

  if (updates.length > 0) {
    await Promise.all(updates);
    issue.tasks.sort((a, b) => a.position - b.position);
  }
}



// Custom Dropdown Split
function setupCustomDropdown(wrapperId, triggerId, optionsId, inputId, textId) {
  const trigger = document.getElementById(triggerId);
  const options = document.getElementById(optionsId);

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();

    if (state.currentIssue?.status === 'Archive') return;

    const wasHidden = options.classList.contains('hidden');

    // Close others
    ['status-dropdown', 'label-dropdown', 'priority-dropdown'].forEach(id => {
      if (id !== wrapperId) {
        document.getElementById(id).querySelector('.custom-select-options').classList.add('hidden');
      }
    });

    if (wasHidden) {
      options.classList.remove('hidden');

      // Auto-scroll to make visible
      setTimeout(() => {
        options.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 50);
    } else {
      options.classList.add('hidden');
    }
  });
}

function renderStatusOptions() {
  const optionsContainer = document.getElementById('status-options');
  optionsContainer.innerHTML = '';
  const statuses = ['Open', 'Todo', 'Pending', 'Working', 'Done'];

  statuses.forEach(status => {
    const div = document.createElement('div');
    div.className = 'custom-option';
    div.textContent = status;
    div.addEventListener('click', () => {
      selectOption('status', 'status-text', 'status-options', status, status);
    });
    optionsContainer.appendChild(div);
  });
}

function renderPriorityOptions() {
  const optionsContainer = document.getElementById('priority-options');
  optionsContainer.innerHTML = '';
  const priorities = ['Normal', 'High'];

  priorities.forEach(prio => {
    const div = document.createElement('div');
    div.className = 'custom-option';
    div.textContent = prio;
    div.addEventListener('click', () => {
      selectOption('priority', 'priority-text', 'priority-options', prio, prio);
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

  const dates = (issue && issue.planned_dates) ? [...issue.planned_dates] : [];
  dates.sort();

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
      const newDates = [...currentDates, dateStr].sort();
      const updatedIssue = { ...state.currentIssue, planned_dates: newDates };
      const saved = await saveIssueWithConflictCheck(updatedIssue, 'Date added');
      if (saved) {
        state.currentIssue.planned_dates = newDates;
        renderPlannedDateChips(state.currentIssue);
      }
    }
  } else {
    // New Issue mode
    const dates = getPlannedDatesFromDOM();
    // Check dupe
    if (!dates.includes(dateStr)) {
      dates.push(dateStr);
      dates.sort();
      renderPlannedDateChips({ planned_dates: dates });
    }
  }
}

async function removePlannedDate(dateStr) {
  if (state.currentIssue) {
    if (state.currentIssue.planned_dates) {
      const newDates = state.currentIssue.planned_dates.filter(d => d !== dateStr);
      const updatedIssue = { ...state.currentIssue, planned_dates: newDates };
      const saved = await saveIssueWithConflictCheck(updatedIssue, 'Date removed');
      if (saved) {
        state.currentIssue.planned_dates = newDates;
        renderPlannedDateChips(state.currentIssue);
      }
    }
  } else {
    // New Issue mode
    const container = document.getElementById('planned-dates-container');
    const chip = container.querySelector(`.date-chip[data-date="${dateStr}"]`);
    if (chip) chip.remove();
  }
}
