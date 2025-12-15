import { state, setCurrentIssue } from '../state.js';
import { createIssue, updateIssue, createTask, updateTask, fetchLabels } from '../api.js';
import { showNotification, showModalNotification, showConfirm, updateDateInputStyle, stripHtml, escapeHtml } from '../utils.js';
import { renderTasks } from './tasks.js';
import { getDragAfterTaskElement, draggedTask } from '../drag.js';

let refreshAppCallback = null;
let previousActiveNavBtn = null;

export function setupModal(refreshApp) {
  refreshAppCallback = refreshApp;
  const modal = document.getElementById('issue-modal');
  const form = document.getElementById('issue-form');

  // Global checking of state is tricky if we don't have reference to 'currentIssue' variable in app.js
  // We use state.currentIssue.

  document.getElementById('cancel-btn').addEventListener('click', closeModal);
  document.getElementById('done-btn').addEventListener('click', closeModal);
  form.addEventListener('submit', handleIssueSubmit);

  document.getElementById('delete-issue-btn').addEventListener('click', handleDeleteIssue);

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
    if (!draggedTask) return;
    const afterElement = getDragAfterTaskElement(taskList, e.clientY);
    if (afterElement == null) {
      taskList.appendChild(draggedTask);
    } else {
      taskList.insertBefore(draggedTask, afterElement);
    }
  });

  // Custom Date Input Click Handling
  document.querySelectorAll('.custom-date-input').forEach(container => {
    container.addEventListener('click', () => {
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

export function openModal(issue = null) {
  setCurrentIssue(issue);
  const modal = document.getElementById('issue-modal');
  modal.classList.remove('hidden');



  /* const statusSelect = document.getElementById('status'); -- Removed as part of custom dropdown refactor */

  const tasksSection = document.getElementById('tasks-section');
  const deleteIssueBtn = document.getElementById('delete-issue-btn');
  const titleInput = document.getElementById('title');
  const descEditor = document.getElementById('description-editor');
  const descContainer = document.querySelector('.editor-container');
  const titleEditActions = document.getElementById('title-edit-actions');
  const descEditActions = document.getElementById('description-edit-actions');

  if (issue) {
    document.getElementById('modal-title').textContent = `Edit Issue #${issue.id}`;
    document.getElementById('issue-id').value = issue.id;
    titleInput.value = issue.title;
    descEditor.innerHTML = issue.description || '';
    document.getElementById('planned-date').value = issue.planned_date ? new Date(issue.planned_date).toISOString().slice(0, 10) : '';
    document.getElementById('deadline').value = issue.deadline ? new Date(issue.deadline).toISOString().slice(0, 10) : '';
    document.getElementById('planned-date').value = issue.planned_date ? new Date(issue.planned_date).toISOString().slice(0, 10) : '';
    document.getElementById('deadline').value = issue.deadline ? new Date(issue.deadline).toISOString().slice(0, 10) : '';

    // Status Dropdown
    const statusInput = document.getElementById('status');
    statusInput.value = issue.status;
    document.getElementById('status-text').textContent = issue.status;
    renderStatusOptions();

    // Priority Dropdown
    const priorityInput = document.getElementById('priority');
    priorityInput.value = issue.priority || 'Normal';
    document.getElementById('priority-text').textContent = issue.priority || 'Normal';
    renderPriorityOptions();

    // Label Dropdown
    const labelInput = document.getElementById('label-select');
    const labelText = document.getElementById('label-text');
    labelInput.value = issue.label ? issue.label.id : '';
    labelText.textContent = issue.label ? issue.label.name : 'No Label';

    fetchLabels().then(labels => {
      renderLabelOptions(labels);
      // Re-verify text in case ID match needed (already set above if object, but good for consistency)
      if (issue.label) {
        const found = labels.find(l => l.id === issue.label.id);
        if (found) labelText.textContent = found.name;
      }
    }).catch(err => console.error('Failed to load labels', err));

    updateDateInputStyle(document.getElementById('planned-date'));
    updateDateInputStyle(document.getElementById('deadline'));

    tasksSection.classList.remove('hidden');
    renderTasks(issue.tasks || [], document.getElementById('task-list'), issue, {
      onTaskUpdate: () => refreshAppCallback && refreshAppCallback(),
      onTaskOrderSave: async () => {
        // Logic to save task order is in tasks.js drag handlers? 
        // Wait, tasks.js has `setDraggedTask`, but logic for saving order was in app.js `handleTaskDragEnd` -> `saveTaskOrder`.
        // We need to implement `saveTaskOrder` logic here or pass it.
        // Actually tasks.js render implementation I wrote handles updates but drag end reordering logic might need help.
        // Let's implement `saveTaskOrder` logic here or imports.
        await saveTaskOrder(issue);
      }
    });
    deleteIssueBtn.classList.remove('hidden');



    // Timestamps
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

    // Enable inline edit mode
    titleInput.classList.add('inline-editable');
    titleInput.readOnly = true;

    descContainer.classList.add('inline-editable');
    descEditor.contentEditable = "false";

    titleEditActions.classList.add('hidden');
    descEditActions.classList.add('hidden');

    document.getElementById('save-issue-btn').classList.add('hidden');
    document.getElementById('cancel-btn').classList.add('hidden');
    document.getElementById('done-btn').classList.remove('hidden');

  } else {
    document.getElementById('modal-title').textContent = 'New Issue';
    document.getElementById('issue-form').reset();
    descEditor.innerHTML = '';
    document.getElementById('issue-id').value = '';
    document.getElementById('issue-id').value = '';
    document.getElementById('issue-id').value = '';

    // Status Dropdown Default
    document.getElementById('status').value = 'Open';
    document.getElementById('status-text').textContent = 'Open';
    renderStatusOptions();

    // Priority Dropdown Default
    document.getElementById('priority').value = 'Normal';
    document.getElementById('priority-text').textContent = 'Normal';
    renderPriorityOptions();

    // Label Dropdown Default
    document.getElementById('label-select').value = '';
    document.getElementById('label-text').textContent = 'No Label';
    fetchLabels().then(labels => {
      renderLabelOptions(labels);
    }).catch(err => console.error('Failed to load labels', err));

    updateDateInputStyle(document.getElementById('planned-date'));
    updateDateInputStyle(document.getElementById('deadline'));

    tasksSection.classList.add('hidden');
    deleteIssueBtn.classList.add('hidden');



    // Hide Timestamps
    const timestampContainer = document.getElementById('timestamp-container');
    if (timestampContainer) {
      timestampContainer.classList.add('hidden');
    }

    titleInput.classList.remove('inline-editable');
    titleInput.readOnly = false;
    descContainer.classList.remove('inline-editable');
    descEditor.contentEditable = "true";
    titleEditActions.classList.add('hidden');
    descEditActions.classList.add('hidden');

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
  resetTaskForm();
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
  resetTaskForm();
}

async function handleIssueSubmit(e) {
  e.preventDefault();
  const statusInput = document.getElementById('status');
  const issueData = {
    title: document.getElementById('title').value,
    description: document.getElementById('description-editor').innerHTML,
    deadline: document.getElementById('deadline').value ? new Date(document.getElementById('deadline').value + 'T12:00:00') : null,
    planned_date: document.getElementById('planned-date').value ? new Date(document.getElementById('planned-date').value + 'T12:00:00') : null,
    status: statusInput.value,
    priority: document.getElementById('priority').value,
    position: state.currentIssue ? state.currentIssue.position : 0
  };

  const labelId = document.getElementById('label-select').value;
  if (labelId) {
    issueData.label = { id: parseInt(labelId) };
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
    if (titleInput.classList.contains('inline-editable')) {
      originalTitle = titleInput.value;
      titleInput.classList.remove('inline-editable');
      titleInput.classList.add('inline-editing');
      titleInput.readOnly = false;
      titleEditActions.classList.remove('hidden');
      titleInput.focus();
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
  };

  const saveTitle = async () => {
    const newTitle = titleInput.value.trim();
    if (!newTitle) { cancelTitle(); return; }
    if (newTitle !== state.currentIssue.title) {
      state.currentIssue.title = newTitle;
      await updateIssue(state.currentIssue);
      showModalNotification('Title updated');
      if (refreshAppCallback) refreshAppCallback();
    }
    titleInput.classList.add('inline-editable');
    titleInput.classList.remove('inline-editing');
    titleInput.readOnly = true;
    titleEditActions.classList.add('hidden');
  };

  titleCancelBtn.addEventListener('mousedown', (e) => { e.preventDefault(); cancelTitle(); });
  titleSaveBtn.addEventListener('mousedown', (e) => { e.preventDefault(); saveTitle(); });
  // Blur logic omitted for brevity/reliability, relying on buttons/keys, or add simple blur
  titleInput.addEventListener('blur', async (e) => {
    if (titleInput.classList.contains('inline-editing')) {
      const currentVal = titleInput.value.trim();
      if (currentVal !== originalTitle) {
        if (await showConfirm('Unsaved Changes', 'Save title?', 'Save', 'Discard', 'primary')) {
          saveTitle();
        } else {
          cancelTitle();
        }
      } else {
        cancelTitle();
      }
    }
  });


  // Description
  descEditor.addEventListener('click', (e) => {
    let node = e.target;
    while (node && node !== descEditor) {
      if (node.tagName === 'A') {
        if (descContainer.classList.contains('inline-editable')) return;
        window.open(node.href, '_blank');
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
    }
  });

  const cancelDesc = () => {
    descEditor.innerHTML = originalDesc;
    descContainer.classList.add('inline-editable');
    descContainer.classList.remove('inline-editing');
    descEditor.contentEditable = "false";
    descEditActions.classList.add('hidden');
  };

  const saveDesc = async () => {
    const newDesc = descEditor.innerHTML;
    if (newDesc !== state.currentIssue.description) {
      state.currentIssue.description = newDesc;
      await updateIssue(state.currentIssue);
      showModalNotification('Description updated');
      if (refreshAppCallback) refreshAppCallback();
    }
    descContainer.classList.add('inline-editable');
    descContainer.classList.remove('inline-editing');
    descEditor.contentEditable = "false";
    descEditActions.classList.add('hidden');
  };

  descCancelBtn.addEventListener('mousedown', (e) => { e.preventDefault(); cancelDesc(); });
  descSaveBtn.addEventListener('mousedown', (e) => { e.preventDefault(); saveDesc(); });
  descEditor.addEventListener('blur', async () => {
    if (descContainer.classList.contains('inline-editing')) {
      const currentVal = descEditor.innerHTML;
      if (currentVal !== originalDesc) {
        if (await showConfirm('Unsaved Changes', 'Save description?', 'Save', 'Discard', 'primary')) {
          saveDesc();
        } else {
          cancelDesc();
        }
      } else {
        cancelDesc();
      }
    }
  });
}
function setupSidebarImmediateSave() {
  const plannedDateInput = document.getElementById('planned-date');
  const deadlineInput = document.getElementById('deadline');

  const statusSelect = document.getElementById('status');
  const labelSelect = document.getElementById('label-select');
  const prioritySelect = document.getElementById('priority');

  prioritySelect.addEventListener('change', async () => {
    if (state.currentIssue) {
      state.currentIssue.priority = prioritySelect.value;
      await updateIssue(state.currentIssue);
      showModalNotification('Priority updated');
      if (refreshAppCallback) refreshAppCallback();
    }
  });

  statusSelect.addEventListener('change', async () => {
    if (state.currentIssue) {
      state.currentIssue.status = statusSelect.value;
      await updateIssue(state.currentIssue);
      showModalNotification('Status updated');
      if (refreshAppCallback) refreshAppCallback();
    }
  });
  plannedDateInput.addEventListener('change', async () => {
    if (state.currentIssue) {
      const dateVal = plannedDateInput.value ? new Date(plannedDateInput.value + 'T12:00:00') : null;
      state.currentIssue.planned_date = dateVal;
      await updateIssue(state.currentIssue);
      showModalNotification('Planned date updated');
      if (refreshAppCallback) refreshAppCallback();
    }
  });
  deadlineInput.addEventListener('change', async () => {
    if (state.currentIssue) {
      const dateVal = deadlineInput.value ? new Date(deadlineInput.value + 'T12:00:00') : null;
      state.currentIssue.deadline = dateVal;
      await updateIssue(state.currentIssue);
      showModalNotification('Deadline updated');
      if (refreshAppCallback) refreshAppCallback();
    }
  });
  if (refreshAppCallback) refreshAppCallback();
  if (labelSelect) {
    labelSelect.addEventListener('change', async () => {
      if (state.currentIssue) {
        const val = labelSelect.value;
        state.currentIssue.label = val ? { id: parseInt(val) } : null;
        await updateIssue(state.currentIssue);
        showModalNotification('Label updated');
        if (refreshAppCallback) refreshAppCallback();
      }
    });
  }
}

function setupEditorToolbar() {
  const editor = document.getElementById('description-editor');
  const toolbarBtns = document.querySelectorAll('.editor-btn');

  function updateToolbarState() {
    // Implementation from app.js
    const selection = window.getSelection();
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
        btn.classList.toggle('active', !inLink && document.queryCommandState(cmd));
      } else {
        btn.classList.toggle('active', document.queryCommandState(cmd));
      }
    });
  }

  toolbarBtns.forEach(btn => {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const cmd = e.currentTarget.dataset.cmd;
      if (cmd === 'createLink') {
        const selection = window.getSelection();
        let url = selection.toString().trim();
        if (url) {
          if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
          document.execCommand(cmd, false, url);
          // Force target _blank
          let anchor = selection.anchorNode.parentElement?.tagName === 'A' ? selection.anchorNode.parentElement : null; // simplified finding
          if (anchor) anchor.target = '_blank';
        }
      } else {
        document.execCommand(cmd, false, null);
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
        const sel = window.getSelection();
        if (sel.isCollapsed && sel.anchorNode.nodeType === Node.TEXT_NODE) {
          const anchorNode = sel.anchorNode;
          const offset = sel.anchorOffset;
          const text = anchorNode.textContent.slice(0, offset);

          if (/^(\*|-)\s$/.test(text)) {
            const range = document.createRange();
            range.setStart(anchorNode, 0);
            range.setEnd(anchorNode, offset);
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand('delete');
            document.execCommand('insertUnorderedList');
          } else if (/^1\.\s$/.test(text)) {
            const range = document.createRange();
            range.setStart(anchorNode, 0);
            range.setEnd(anchorNode, offset);
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand('delete');
            document.execCommand('insertOrderedList');
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
    onTaskUpdate: () => refreshAppCallback && refreshAppCallback(),
    onTaskOrderSave: () => saveTaskOrder(state.currentIssue)
  });
  resetTaskForm();
  if (refreshAppCallback) refreshAppCallback();
}

async function saveTaskOrder(issue) {
  const taskItems = [...document.querySelectorAll('#task-list .task-item')];
  const updates = [];
  taskItems.forEach((item, index) => {
    const id = parseInt(item.dataset.id);
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
  const wrapper = document.getElementById(wrapperId);

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();

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
