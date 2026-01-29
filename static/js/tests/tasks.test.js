
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderTasks } from '../components/tasks.js';
import * as api from '../api.js';
import * as utils from '../utils.js';

vi.mock('../api.js', () => ({
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  createTask: vi.fn()
}));

vi.mock('../utils.js', () => ({
  showModalNotification: vi.fn(),
  showConfirm: vi.fn(),
  escapeHtml: vi.fn(s => s)
}));

vi.mock('../drag.js', () => ({
  setDraggedTask: vi.fn(),
  draggedTask: null
}));

describe('Tasks Component', () => {
  let container;
  let issue;
  let callbacks;

  beforeEach(() => {
    container = document.createElement('ul');
    issue = {
      id: 1,
      tasks: [
        { id: 10, title: 'Task A', done: false, position: 0 },
        { id: 11, title: 'Task B', done: true, position: 1 }
      ]
    };
    callbacks = {
      onTaskUpdate: vi.fn(),
      onTaskOrderSave: vi.fn()
    };
    vi.clearAllMocks();
  });

  it('should render tasks sorted by position', () => {
    // Swap positions to test sorting
    issue.tasks[0].position = 1;
    issue.tasks[1].position = 0;

    renderTasks(issue.tasks, container, issue, callbacks);

    const items = container.querySelectorAll('.task-item');
    expect(items.length).toBe(2);

    // Task B should be first (pos 0)
    expect(items[0].querySelector('.task-title-input').value).toBe('Task B');
    expect(items[0].classList.contains('done')).toBe(true);
    expect(items[0].querySelector('input[type="checkbox"]').checked).toBe(true);

    // Task A should be second (pos 1)
    expect(items[1].querySelector('.task-title-input').value).toBe('Task A');
    expect(items[1].classList.contains('done')).toBe(false);
  });

  it('should toggle task status', async () => {
    renderTasks(issue.tasks, container, issue, callbacks);

    const checkbox = container.querySelector('input[type="checkbox"]');
    checkbox.checked = !checkbox.checked;
    checkbox.dispatchEvent(new Event('change'));

    await new Promise(process.nextTick);

    expect(api.updateTask).toHaveBeenCalledWith(expect.objectContaining({
      id: 10,
      done: true
    }));

    expect(callbacks.onTaskUpdate).toHaveBeenCalled();
  });

  it('should delete task', async () => {
    renderTasks(issue.tasks, container, issue, callbacks);

    utils.showConfirm.mockResolvedValue(true);

    const deleteBtn = container.querySelector('.delete-task-btn');
    deleteBtn.click();

    await new Promise(process.nextTick);

    expect(api.deleteTask).toHaveBeenCalledWith(10);
    expect(issue.tasks.length).toBe(1); // Should be removed from local array
    expect(callbacks.onTaskUpdate).toHaveBeenCalled();
  });

  it('should edit task title inline', async () => {
    renderTasks(issue.tasks, container, issue, callbacks);

    const item = container.querySelector('.task-item');
    const input = item.querySelector('.task-title-input');
    const saveBtn = item.querySelector('.inline-save-btn');

    // Enter edit mode
    input.click();
    expect(item.classList.contains('editing')).toBe(true);

    // Change value
    input.value = 'Updated Task';

    // Save
    saveBtn.dispatchEvent(new Event('mousedown')); // use dispatchEvent because logic prevents default

    await new Promise(process.nextTick);

    expect(api.updateTask).toHaveBeenCalledWith(expect.objectContaining({
      id: 10,
      title: 'Updated Task'
    }));
    expect(item.classList.contains('editing')).toBe(false);
  });

  it('should update task deadline', async () => {
    renderTasks(issue.tasks, container, issue, callbacks);

    const deadlineInput = container.querySelector('.task-deadline-input');
    deadlineInput.value = '2023-10-10';
    deadlineInput.dispatchEvent(new Event('change'));

    await new Promise(process.nextTick);

    expect(api.updateTask).toHaveBeenCalledWith(expect.objectContaining({
      id: 10,
      deadline: expect.any(Date)
    }));
    expect(callbacks.onTaskUpdate).toHaveBeenCalled();
  });
});
