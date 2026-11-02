import { escapeHtml, showNotification, showConfirm, initCharCounter, getTaskDeadlineStatus, toDateInputValue, guardSubmit, bySelector } from '../utils.ts';
import { MAX_TITLE_LENGTH } from '../validation-config.ts';
import { updateTask, deleteTask } from '../api.ts'; // Ensure createTask is imported
import { setDraggedTask } from '../drag.ts';
import { userCan, ACTION_UPDATE_TASK, ACTION_DELETE_TASK } from '../permissions.ts';
import { state } from '../state.ts';
import type { Issue, Task } from '../models.ts';

// Calendar icon plus the short date; without a deadline the icon alone opens the date picker.
function taskDeadlineHTML(deadline: string | null) {
  const date = deadline ? new Date(deadline).toLocaleDateString(navigator.language, { month: 'short', day: 'numeric' }) : '';
  return `<span class="icon-calendar" aria-hidden="true"></span>${date}`;
}

export interface TaskCallbacks {
  readOnly?: boolean;
  onTaskUpdate?: () => void;
  onTaskOrderSave?: () => unknown;
  onTaskEditStart?: (saveTask: () => unknown) => void;
  onTaskEditEnd?: () => void;
}

export function renderTasks(tasks: Task[], container: HTMLElement, currentIssue: Issue, callbacks: TaskCallbacks = {}) {
  container.innerHTML = '';

  // Sort tasks by position
  const sortedTasks = [...tasks].sort((a, b) => a.position - b.position);

  sortedTasks.forEach(task => {
    const li = document.createElement('li');
    li.className = `task-item ${task.done ? 'done' : ''}`;
    li.draggable = true;
    li.dataset.id = String(task.id);

    // Coerce task.id to a safe integer before embedding in HTML attributes
    const taskId = Number.isInteger(task.id) ? task.id : Math.trunc(Number(task.id));
    const dlStatus = getTaskDeadlineStatus(task.deadline, currentIssue);
    li.innerHTML = `
            <span class="task-drag-handle">⋮⋮</span>
            <input type="checkbox" id="task-check-${taskId}" name="task_check_${taskId}" ${task.done ? 'checked' : ''}>
            <div class="task-info">
                <input type="text" id="task-title-${taskId}" name="task_title_${taskId}" class="task-title-input" value="${escapeHtml(task.title)}" title="${escapeHtml(task.title)}" readonly>
                <div class="task-actions">
                    <div class="task-deadline-container ${task.deadline ? '' : 'no-deadline'}" title="${dlStatus.late ? dlStatus.reason : 'Set Deadline'}">
                        <span class="task-deadline task-deadline-display${dlStatus.late ? ' overdue' : ''}">${taskDeadlineHTML(task.deadline)}</span>
                        <input type="date" id="task-deadline-${taskId}" name="task_deadline_${taskId}" class="task-deadline-input" value="${toDateInputValue(task.deadline)}">
                    </div>
                    <div class="delete-task-btn" title="Delete Task">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </div>
                </div>
            </div>
        `;

    // Checkbox Logic
    const checkbox = bySelector(li, 'input[type="checkbox"]', HTMLInputElement);
    if (callbacks.readOnly) {
      checkbox.disabled = true;
      li.draggable = false;
      bySelector(li, '.task-drag-handle').classList.add('hidden');
      bySelector(li, '.delete-task-btn').classList.add('hidden');
      bySelector(li, '.task-deadline-container').setAttribute('aria-disabled', 'true');
    } else {
      checkbox.addEventListener('change', async () => {
        if (!userCan(state.currentUser, ACTION_UPDATE_TASK)) { checkbox.checked = !checkbox.checked; return; }
        task.done = checkbox.checked;
        try {
          await updateTask(currentIssue.project_id, currentIssue.id, task);
          li.className = `task-item ${task.done ? 'done' : ''}`;
          showNotification(task.done ? 'Task marked as done' : 'Task marked as not done');
          if (callbacks.onTaskUpdate) callbacks.onTaskUpdate();
        } catch (err) {
          task.done = !checkbox.checked; // revert local state
          checkbox.checked = !checkbox.checked;
          showNotification(err.message, 'error');
        }
      });

      // Delete Logic
      const deleteBtn = bySelector(li, '.delete-task-btn');
      deleteBtn.addEventListener('click', async () => {
        if (!userCan(state.currentUser, ACTION_DELETE_TASK)) return;
        if (await showConfirm('Delete Task', `Delete "${task.title}"?`, 'Delete')) {
          try {
            await deleteTask(currentIssue.project_id, currentIssue.id, task.id);
            // Remove from local array to update UI immediately if needed
            const tasks = currentIssue.tasks ?? [];
            const index = tasks.findIndex(t => t.id === task.id);
            if (index > -1) tasks.splice(index, 1);

            renderTasks(tasks, container, currentIssue, callbacks);
            showNotification('Task deleted');
            if (callbacks.onTaskUpdate) callbacks.onTaskUpdate();
          } catch (err) {
            showNotification(err.message, 'error');
          }
        }
      });

      // Drag Events
      li.addEventListener('dragstart', (e) => {
        setDraggedTask(li);
        li.classList.add('dragging');
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      });
      li.addEventListener('dragend', () => {
        li.classList.remove('dragging');
        setDraggedTask(null);
        if (callbacks.onTaskOrderSave) callbacks.onTaskOrderSave();
      });
    }

    // Edit Mode Logic
    const titleInput = bySelector(li, '.task-title-input', HTMLInputElement);

    if (!callbacks.readOnly) {
      let originalTitle = task.title;

      const titleCounter = initCharCounter(titleInput, MAX_TITLE_LENGTH, { manual: true });

      const enterEditMode = () => {
        li.classList.add('editing');
        li.draggable = false;
        titleInput.readOnly = false;
        originalTitle = task.title;
        titleInput.dataset.originalTitle = task.title; // Expose for modal.ts
        titleInput.focus();
        titleCounter.show();
        if (callbacks.onTaskEditStart) callbacks.onTaskEditStart(saveTask);
      };

      const exitEditMode = () => {
        li.classList.remove('editing');
        li.draggable = true;
        titleInput.readOnly = true;
        delete titleInput.dataset.originalTitle;
        titleCounter.hide();
        if (callbacks.onTaskEditEnd) callbacks.onTaskEditEnd();
      };

      const cancelEdit = () => {
        titleInput.value = originalTitle;
        exitEditMode();
      };

      // Returns false if the title could not be saved (edit mode and typed text are kept).
      const doSaveTask = async () => {
        const newTitle = titleInput.value.trim();
        if (!newTitle) {
          cancelEdit();
          return true;
        }
        if (newTitle !== task.title) {
          if (!userCan(state.currentUser, ACTION_UPDATE_TASK)) { cancelEdit(); return true; }
          task.title = newTitle;
          try {
            await updateTask(currentIssue.project_id, currentIssue.id, task);
            showNotification('Task updated');
            if (callbacks.onTaskUpdate) callbacks.onTaskUpdate();
          } catch (err) {
            task.title = originalTitle; // revert local state, keep the typed text in the input
            showNotification(err.message, 'error');
            return false; // keep edit mode so user can retry
          }
        }
        exitEditMode();
        return true;
      };

      // Blur (e.g. when clicking Done) and the modal's Done handler may both trigger a
      // save; they share the in-flight one so Done sees its real outcome.
      const saveTask = guardSubmit(doSaveTask, { field: li });

      titleInput.addEventListener('click', () => {
        if (!li.classList.contains('editing')) enterEditMode();
      });

      titleInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); void saveTask(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
      });
      titleInput.addEventListener('blur', async () => {
        if (!li.classList.contains('editing')) return;
        await saveTask(); // saveTask handles empty → cancelEdit automatically
      });

      // Deadline Logic (Interactive)
      const deadlineContainer = bySelector(li, '.task-deadline-container');
      const deadlineInput = bySelector(li, '.task-deadline-input', HTMLInputElement);
      deadlineContainer.addEventListener('click', () => deadlineInput.showPicker());
      deadlineInput.addEventListener('change', async () => {
        if (!userCan(state.currentUser, ACTION_UPDATE_TASK)) return;
        const prevDeadline = task.deadline;
        task.deadline = deadlineInput.value ? new Date(deadlineInput.value + 'T12:00:00').toISOString() : null;
        try {
          await updateTask(currentIssue.project_id, currentIssue.id, task);
          const display = bySelector(li, '.task-deadline-display');
          display.innerHTML = taskDeadlineHTML(task.deadline);
          deadlineContainer.classList.toggle('no-deadline', !task.deadline);
          const updatedStatus = getTaskDeadlineStatus(task.deadline, currentIssue);
          display.classList.toggle('overdue', updatedStatus.late);
          deadlineContainer.title = updatedStatus.late ? updatedStatus.reason : 'Set Deadline';
          showNotification(updatedStatus.late ? `Task deadline updated — ${updatedStatus.reason}` : 'Task deadline updated', updatedStatus.late ? 'warning' : 'success');
          if (callbacks.onTaskUpdate) callbacks.onTaskUpdate();
        } catch (err) {
          task.deadline = prevDeadline; // revert local state
          deadlineInput.value = toDateInputValue(prevDeadline);
          showNotification(err.message, 'error');
        }
      });
    }

    container.appendChild(li);
  });
}
