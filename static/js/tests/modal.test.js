
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupModal, openModal, closeModal } from '../components/modal.js';
import * as api from '../api.js';
import * as state from '../state.js';
import * as utils from '../utils.js';
import * as tasks from '../components/tasks.js';

// Mock dependencies
vi.mock('../api.js', () => ({
  createIssue: vi.fn(),
  updateIssue: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteIssue: vi.fn(),
  fetchLabels: vi.fn()
}));

vi.mock('../state.js', () => ({
  state: {
    issues: [],
    currentIssue: null
  },
  setCurrentIssue: vi.fn((issue) => {
    // Manually update the mocked state for tests to see the change
    // Note: In a real ES module mock, we might need a getter/setter on the mock object itself 
    // if the module exports a live binding, but here we are mocking the module object.
    // However, the SUT imports 'state' directly.
    // To make 'state' updateable in SUT, we rely on the fact that SUT imports the object.
  })
}));

vi.mock('../utils.js', () => ({
  showNotification: vi.fn(),
  showModalNotification: vi.fn(),
  showConfirm: vi.fn(),
  updateDateInputStyle: vi.fn(),
  stripHtml: vi.fn(s => s),
  escapeHtml: vi.fn(s => s)
}));

vi.mock('../components/tasks.js', () => ({
  renderTasks: vi.fn()
}));

vi.mock('../drag.js', () => ({
  getDragAfterTaskElement: vi.fn(),
  draggedTask: null
}));

describe('Modal Component', () => {
  let modal, form, cancelBtn, doneBtn, deleteBtn, addTaskBtn, newTaskTitle, taskList;
  let titleInput, descEditor, plannedDate, deadline, statusInput, priorityInput, labelInput;

  beforeEach(() => {
    // Setup DOM
    document.body.innerHTML = `
      <div id="issue-modal" class="hidden">
        <h2 id="modal-title"></h2>
        <form id="issue-form">
            <input id="issue-id" type="hidden">
            <input id="title" type="text" value="">
            <div id="title-edit-actions" class="hidden">
                <button id="title-cancel-btn"></button>
                <button id="title-save-btn"></button>
            </div>
            <div class="editor-container">
                <div id="description-editor" contenteditable="true"></div>
                <div id="description-edit-actions" class="hidden">
                     <button id="desc-cancel-btn"></button>
                     <button id="desc-save-btn"></button>
                </div>
            </div>
            <input id="planned-date" type="date">
            <input id="deadline" type="date">

            <!-- Custom Dropdowns -->
            <div id="status-dropdown"><div id="status-trigger"><span id="status-text"></span></div><div id="status-options" class="custom-select-options hidden"></div><input type="hidden" id="status"></div>
            <div id="priority-dropdown"><div id="priority-trigger"><span id="priority-text"></span></div><div id="priority-options" class="custom-select-options hidden"></div><input type="hidden" id="priority"></div>
            <div id="label-dropdown"><div id="label-trigger"><span id="label-text"></span></div><div id="label-options" class="custom-select-options hidden"></div><input type="hidden" id="label-select"></div>
            
            <div id="tasks-section">
                <input id="new-task-title" type="text">
                <input id="new-task-deadline" type="date">
                <button id="add-task-btn" type="button"></button>
                 <ul id="task-list"></ul>
            </div>

            <button id="delete-issue-btn" type="button"></button>
            <div id="timestamp-container">
                 <span id="created-at-display"></span>
                 <span id="updated-at-display"></span>
            </div>
            
            <button id="cancel-btn" type="button"></button>
            <button id="save-issue-btn" type="submit"></button>
            <button id="done-btn" type="button"></button>
            
             <!-- Left nav for active state check -->
            <div class="left-menu">
                <div id="add-issue-btn" class="menu-btn"></div>
                <div id="nav-board" class="menu-btn"></div>
            </div>
            
             <!-- Editor toolbar btns for setup -->
            <button class="editor-btn" data-cmd="bold"></button>
            <button class="editor-btn" data-cmd="createLink"></button>
        </form>
      </div>
    `;

    // Reset mocks
    vi.clearAllMocks();

    // Default mock returns
    api.fetchLabels.mockResolvedValue([{ id: 1, name: 'Bug' }, { id: 2, name: 'Feature' }]);
    state.state.currentIssue = null;
    state.setCurrentIssue.mockImplementation((val) => { state.state.currentIssue = val; });

    // Initialize module
    setupModal(vi.fn());
  });

  it('should open modal for new issue', async () => {
    openModal(null);
    expect(document.getElementById('issue-modal').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('modal-title').textContent).toBe('New Issue');
    expect(document.getElementById('save-issue-btn').classList.contains('hidden')).toBe(false);
    expect(state.setCurrentIssue).toHaveBeenCalledWith(null);
  });

  it('should open modal for existing issue', async () => {
    const issue = {
      id: 123,
      title: 'Test Issue',
      description: 'Test Desc',
      status: 'Doing',
      priority: 'High',
      label: { id: 1, name: 'Bug' },
      tasks: []
    };

    openModal(issue);

    expect(document.getElementById('issue-modal').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('modal-title').textContent).toBe('Edit Issue #123');
    expect(document.getElementById('title').value).toBe('Test Issue');
    expect(document.getElementById('description-editor').innerHTML).toBe('Test Desc');
    expect(state.setCurrentIssue).toHaveBeenCalledWith(issue);
    expect(api.fetchLabels).toHaveBeenCalled(); // labels fetched to render options
  });

  it('should close modal and reset state', () => {
    openModal(null);
    closeModal();

    expect(document.getElementById('issue-modal').classList.contains('hidden')).toBe(true);
    expect(state.setCurrentIssue).toHaveBeenCalledWith(null);
  });

  it('should create new issue on submit', async () => {
    openModal(null);

    // Fill form
    document.getElementById('title').value = 'New Title';
    document.getElementById('description-editor').innerHTML = 'New Desc';
    document.getElementById('status').value = 'Todo';
    document.getElementById('priority').value = 'Normal';

    // Mock create response
    api.createIssue.mockResolvedValue({ id: 99, title: 'New Title' });

    // Trigger submit
    const form = document.getElementById('issue-form');
    form.dispatchEvent(new Event('submit'));

    // Wait for async
    await new Promise(process.nextTick);

    expect(api.createIssue).toHaveBeenCalledWith(expect.objectContaining({
      title: 'New Title',
      description: 'New Desc',
      status: 'Todo',
      priority: 'Normal'
    }));

    expect(document.getElementById('issue-modal').classList.contains('hidden')).toBe(true); // Should close
  });

  it('should update existing issue on status change (inline save)', async () => {
    const issue = { id: 1, title: 'Old', status: 'Open' };
    openModal(issue);

    // Simulate status change
    const statusSelect = document.getElementById('status');
    statusSelect.value = 'Done';
    statusSelect.dispatchEvent(new Event('change'));

    await new Promise(process.nextTick);

    expect(api.updateIssue).toHaveBeenCalledWith(expect.objectContaining({
      id: 1,
      status: 'Done'
    }));
    expect(utils.showModalNotification).toHaveBeenCalled();
  });

  it('should handle task creation', async () => {
    const issue = { id: 1, title: 'Task Parent', tasks: [] };
    openModal(issue);

    document.getElementById('new-task-title').value = 'Subtask 1';

    api.createTask.mockResolvedValue({ id: 101, title: 'Subtask 1', done: false });

    // Click add
    document.getElementById('add-task-btn').click();

    await new Promise(process.nextTick);

    expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Subtask 1',
      issue_id: 1
    }));
    expect(tasks.renderTasks).toHaveBeenCalled();
  });

  it('should delete issue after confirmation', async () => {
    const issue = { id: 99, title: 'To Delete' };
    openModal(issue);

    utils.showConfirm.mockResolvedValue(true);

    document.getElementById('delete-issue-btn').click();
    await new Promise(process.nextTick);

    expect(utils.showConfirm).toHaveBeenCalled();
    expect(api.deleteIssue).toHaveBeenCalledWith(99);
    expect(document.getElementById('issue-modal').classList.contains('hidden')).toBe(true);
  });
});
