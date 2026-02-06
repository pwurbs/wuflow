import { escapeHtml, showModalNotification, showConfirm } from '../utils.js';
import { updateTask, deleteTask } from '../api.js'; // Ensure createTask is imported
import { setDraggedTask } from '../drag.js';

export function renderTasks(tasks, container, currentIssue, callbacks = {}) {
  container.innerHTML = '';

  // Sort tasks by position
  const sortedTasks = [...tasks].sort((a, b) => a.position - b.position);

  sortedTasks.forEach(task => {
    const li = document.createElement('li');
    li.className = `task-item ${task.done ? 'done' : ''}`;
    li.draggable = true;
    li.dataset.id = task.id;

    li.innerHTML = `
            <span class="task-drag-handle">⋮⋮</span>
            <input type="checkbox" id="task-check-${task.id}" name="task_check_${task.id}" ${task.done ? 'checked' : ''}>
            <div class="task-info">
                <input type="text" id="task-title-${task.id}" name="task_title_${task.id}" class="task-title-input" value="${escapeHtml(task.title)}" title="${escapeHtml(task.title)}" readonly>
                <div class="inline-edit-actions hidden">
                    <button type="button" id="task-cancel-${task.id}" class="inline-edit-btn inline-cancel-btn" title="Cancel">✕</button>
                    <button type="button" id="task-save-${task.id}" class="inline-edit-btn inline-save-btn" title="Save">✓</button>
                </div>
                <div class="task-actions">
                    <div class="task-deadline-container ${task.deadline ? '' : 'no-deadline'}" title="Set Deadline">
                        <span class="task-deadline task-deadline-display">
                            ${task.deadline ? `📅 ${new Date(task.deadline).toLocaleDateString(navigator.language, { month: 'short', day: 'numeric' })}` : '📅'}
                        </span>
                        <input type="date" id="task-deadline-${task.id}" name="task_deadline_${task.id}" class="task-deadline-input" value="${task.deadline ? new Date(task.deadline).toISOString().slice(0, 10) : ''}">
                    </div>
                    <div class="delete-task-btn" title="Delete Task">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </div>
                </div>
            </div>
        `;

    // Checkbox Logic
    const checkbox = li.querySelector('input[type="checkbox"]');
    if (callbacks.readOnly) {
      checkbox.disabled = true;
      li.draggable = false;
      li.querySelector('.task-drag-handle').style.opacity = '0.3';
      li.querySelector('.task-drag-handle').style.cursor = 'default';
      li.querySelector('.delete-task-btn').classList.add('hidden');
      li.querySelector('.task-deadline-container').style.pointerEvents = 'none';
    } else {
      checkbox.addEventListener('change', async () => {
        task.done = checkbox.checked;
        await updateTask(task);
        li.className = `task-item ${task.done ? 'done' : ''}`;
        if (callbacks.onTaskUpdate) callbacks.onTaskUpdate();
      });

      // Delete Logic
      const deleteBtn = li.querySelector('.delete-task-btn');
      deleteBtn.addEventListener('click', async () => {
        if (await showConfirm('Delete Task', `Delete "${task.title}"?`, 'Delete')) {
          await deleteTask(task.id);
          // Remove from local array to update UI immediately if needed
          const index = currentIssue.tasks.findIndex(t => t.id === task.id);
          if (index > -1) currentIssue.tasks.splice(index, 1);

          renderTasks(currentIssue.tasks, container, currentIssue, callbacks);
          if (callbacks.onTaskUpdate) callbacks.onTaskUpdate();
        }
      });

      // Drag Events
      li.addEventListener('dragstart', (e) => {
        setDraggedTask(li);
        li.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      li.addEventListener('dragend', () => {
        li.classList.remove('dragging');
        setDraggedTask(null);
        if (callbacks.onTaskOrderSave) callbacks.onTaskOrderSave();
      });
    }

    // Edit Mode Logic
    const titleInput = li.querySelector('.task-title-input');

    if (!callbacks.readOnly) {
      const editActions = li.querySelector('.inline-edit-actions');
      const cancelBtn = li.querySelector('.inline-cancel-btn');
      const saveBtn = li.querySelector('.inline-save-btn');
      let originalTitle = task.title;

      const enterEditMode = () => {
        li.classList.add('editing');
        li.draggable = false;
        titleInput.readOnly = false;
        editActions.classList.remove('hidden');
        originalTitle = task.title;
        titleInput.dataset.originalTitle = task.title; // Expose for modal.js
        titleInput.focus();
        if (callbacks.onTaskEditStart) callbacks.onTaskEditStart();
      };

      const exitEditMode = () => {
        li.classList.remove('editing');
        li.draggable = true;
        titleInput.readOnly = true;
        editActions.classList.add('hidden');
        delete titleInput.dataset.originalTitle;
        if (callbacks.onTaskEditEnd) callbacks.onTaskEditEnd();
      };

      const cancelEdit = () => {
        titleInput.value = originalTitle;
        exitEditMode();
      };

      const saveTask = async () => {
        const newTitle = titleInput.value.trim();
        if (!newTitle) {
          cancelEdit();
          return;
        }
        if (newTitle !== task.title) {
          task.title = newTitle;
          await updateTask(task);
          showModalNotification('Task updated');
          if (callbacks.onTaskUpdate) callbacks.onTaskUpdate();
        }
        exitEditMode();
      };

      titleInput.addEventListener('click', () => {
        if (!li.classList.contains('editing')) enterEditMode();
      });

      cancelBtn.addEventListener('mousedown', (e) => { e.preventDefault(); cancelEdit(); });
      saveBtn.addEventListener('mousedown', (e) => { e.preventDefault(); saveTask(); });
      titleInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); saveTask(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
      });
      titleInput.addEventListener('blur', () => {
        // Only cancel if NO changes. If changes, stay in edit mode (no popup).
        if (titleInput.value.trim() === originalTitle) {
          cancelEdit();
        }
      });

      // Deadline Logic (Interactive)
      const deadlineContainer = li.querySelector('.task-deadline-container');
      const deadlineInput = li.querySelector('.task-deadline-input');
      deadlineContainer.addEventListener('click', () => deadlineInput.showPicker());
      deadlineInput.addEventListener('change', async () => {
        const newDate = deadlineInput.value ? new Date(deadlineInput.value + 'T12:00:00') : null;
        task.deadline = newDate;
        await updateTask(task);
        showModalNotification('Task deadline updated');

        const display = li.querySelector('.task-deadline-display');
        display.innerHTML = task.deadline ? `📅 ${new Date(task.deadline).toLocaleDateString(navigator.language, { month: 'short', day: 'numeric' })}` : '📅';
        deadlineContainer.classList.toggle('no-deadline', !task.deadline);
        if (callbacks.onTaskUpdate) callbacks.onTaskUpdate();
      });
    }

    container.appendChild(li);
  });
}
