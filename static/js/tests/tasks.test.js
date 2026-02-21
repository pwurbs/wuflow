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
  showNotification: vi.fn(),
  showModalNotification: vi.fn(),
  showConfirm: vi.fn(),
  escapeHtml: vi.fn(s => s),
  initCharCounter: vi.fn(() => ({ show: vi.fn(), hide: vi.fn() })),
  countCodepoints: vi.fn(s => [...s].length)
}));

vi.mock('../drag.js', () => ({
  setDraggedTask: vi.fn(),
  getDraggedTask: vi.fn()
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

  it('should handle readOnly mode', () => {
    callbacks.readOnly = true;
    renderTasks(issue.tasks, container, issue, callbacks);

    const item = container.querySelector('.task-item');
    const checkbox = item.querySelector('input[type="checkbox"]');
    expect(checkbox.disabled).toBe(true);
    expect(item.draggable).toBe(false);
    expect(item.querySelector('.delete-task-btn').classList.contains('hidden')).toBe(true);
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

    // Enter edit mode
    input.click();
    expect(item.classList.contains('editing')).toBe(true);

    // Change value and save via Enter key
    input.value = 'Updated Task';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await new Promise(process.nextTick);

    expect(api.updateTask).toHaveBeenCalledWith(expect.objectContaining({
      id: 10,
      title: 'Updated Task'
    }));
    expect(item.classList.contains('editing')).toBe(false);
  });

  it('should cancel edit on empty title', async () => {
    renderTasks(issue.tasks, container, issue, callbacks);
    const item = container.querySelector('.task-item');
    const input = item.querySelector('.task-title-input');

    input.click();
    input.value = '';
    input.dispatchEvent(new Event('blur'));

    await new Promise(process.nextTick);

    expect(item.classList.contains('editing')).toBe(false);
    expect(input.value).toBe('Task A'); // Reverted
  });

  it('should update task deadline', async () => {
    renderTasks(issue.tasks, container, issue, callbacks);

    const deadlineInput = container.querySelector('.task-deadline-input');
    deadlineInput.value = '2023-10-10';
    deadlineInput.dispatchEvent(new Event('change'));

    await new Promise(process.nextTick);

    expect(api.updateTask).toHaveBeenCalled();
    expect(callbacks.onTaskUpdate).toHaveBeenCalled();
  });

  it('should handle keyboard navigation in edit mode', async () => {
    renderTasks(issue.tasks, container, issue, callbacks);
    const item = container.querySelector('.task-item');
    const input = item.querySelector('.task-title-input');

    input.click();
    input.value = 'Keyboard Update';

    // Enter to save
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(process.nextTick);
    expect(api.updateTask).toHaveBeenCalled();

    // Enter again (should be out of edit mode now, but let's re-enter)
    input.click();
    input.value = 'Discarded';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(item.classList.contains('editing')).toBe(false);
    expect(input.value).toBe('Keyboard Update');
  });

  it('should handle drag events', () => {
    renderTasks(issue.tasks, container, issue, callbacks);
    const item = container.querySelector('.task-item');

    const dragStartEvent = new Event('dragstart');
    dragStartEvent.dataTransfer = { effectAllowed: '' };
    item.dispatchEvent(dragStartEvent);
    expect(item.classList.contains('dragging')).toBe(true);

    item.dispatchEvent(new Event('dragend'));
    expect(item.classList.contains('dragging')).toBe(false);
    expect(callbacks.onTaskOrderSave).toHaveBeenCalled();
  });

  it('should call onTaskEditStart when entering edit mode', () => {
    callbacks.onTaskEditStart = vi.fn();
    renderTasks(issue.tasks, container, issue, callbacks);

    const item = container.querySelector('.task-item');
    const input = item.querySelector('.task-title-input');

    // Enter edit mode
    input.click();

    expect(callbacks.onTaskEditStart).toHaveBeenCalled();
  });

  it('should call onTaskEditEnd when exiting edit mode via Escape key', () => {
    callbacks.onTaskEditEnd = vi.fn();
    renderTasks(issue.tasks, container, issue, callbacks);

    const item = container.querySelector('.task-item');
    const input = item.querySelector('.task-title-input');

    // Enter edit mode
    input.click();

    // Cancel via Escape
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(callbacks.onTaskEditEnd).toHaveBeenCalled();
  });

  it('should call onTaskEditEnd when exiting edit mode via Enter key', async () => {
    callbacks.onTaskEditEnd = vi.fn();
    renderTasks(issue.tasks, container, issue, callbacks);

    const item = container.querySelector('.task-item');
    const input = item.querySelector('.task-title-input');

    // Enter edit mode
    input.click();
    input.value = 'New Title';

    // Save via Enter
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await new Promise(process.nextTick);

    expect(callbacks.onTaskEditEnd).toHaveBeenCalled();
  });

  it('should expose originalTitle in dataset when entering edit mode', () => {
    renderTasks(issue.tasks, container, issue, callbacks);

    const item = container.querySelector('.task-item');
    const input = item.querySelector('.task-title-input');

    // Should not have dataset before edit mode
    expect(input.dataset.originalTitle).toBeUndefined();

    // Enter edit mode
    input.click();

    // Should expose originalTitle
    expect(input.dataset.originalTitle).toBe('Task A');
  });

  it('should remove originalTitle from dataset when exiting edit mode', () => {
    renderTasks(issue.tasks, container, issue, callbacks);

    const item = container.querySelector('.task-item');
    const input = item.querySelector('.task-title-input');

    // Enter edit mode
    input.click();
    expect(input.dataset.originalTitle).toBe('Task A');

    // Exit via Escape
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    // Should remove originalTitle
    expect(input.dataset.originalTitle).toBeUndefined();
  });

  it('should auto-save on blur when value changed', async () => {
    renderTasks(issue.tasks, container, issue, callbacks);

    const item = container.querySelector('.task-item');
    const input = item.querySelector('.task-title-input');

    // Enter edit mode
    input.click();
    input.value = 'Changed Value';

    // Trigger blur
    input.dispatchEvent(new Event('blur'));

    await new Promise(process.nextTick);

    // Should save and exit edit mode
    expect(api.updateTask).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Changed Value'
    }));
    expect(item.classList.contains('editing')).toBe(false);
  });

  it('should exit edit mode on blur if value unchanged', () => {
    renderTasks(issue.tasks, container, issue, callbacks);

    const item = container.querySelector('.task-item');
    const input = item.querySelector('.task-title-input');

    // Enter edit mode
    input.click();
    expect(item.classList.contains('editing')).toBe(true);

    // Don't change value

    // Trigger blur
    input.dispatchEvent(new Event('blur'));

    // Should exit edit mode
    expect(item.classList.contains('editing')).toBe(false);
  });
});
