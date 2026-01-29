
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  getDraggedTask: vi.fn(),
  setDraggedTask: vi.fn()
}));

describe('Modal Component', () => {
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

    // Mock JSDOM missing functions
    document.queryCommandState = vi.fn();
    document.execCommand = vi.fn();
    HTMLElement.prototype.scrollIntoView = vi.fn();
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
  it('should drag and drop task', async () => {
    // Mock drag utils
    const mockTask = document.createElement('div');
    mockTask.className = 'task-item';

    // Import drag mock to set return values if needed, or use the vi.mocked helper if available. 
    // Since we mocked the module, we can access the mock functions.
    // However, we didn't import the mock functions in this test file directly from the mocked module instance.
    // But we did: `import * as tasks from ...` but drag is mocked separate.
    // We need to import the mocked module to manipulate it?
    // Actually we can just rely on the event listeners calling the global mock.

    const dragModule = await import('../drag.js');
    dragModule.getDraggedTask.mockReturnValue(mockTask);
    dragModule.getDragAfterTaskElement.mockReturnValue(null); // Append to end

    const taskList = document.getElementById('task-list');

    // Simulate dragover
    const dragEvent = new Event('dragover');
    Object.defineProperty(dragEvent, 'clientY', { value: 100 });
    taskList.dispatchEvent(dragEvent);

    expect(dragModule.getDraggedTask).toHaveBeenCalled();
    expect(taskList.contains(mockTask)).toBe(true);
  });

  it('should handle dropdown interaction', async () => {
    openModal(null);

    // Simulate clicking the status trigger to open dropdown
    const statusTrigger = document.getElementById('status-trigger');
    const statusOptions = document.getElementById('status-options');
    statusTrigger.click();
    expect(statusOptions.classList.contains('hidden')).toBe(false);

    // Click an option (e.g. 'Working')
    // We need to find the element containing 'Working' - it's dynamically rendered
    // renderStatusOptions is called in openModal
    const option = Array.from(statusOptions.children).find(c => c.textContent === 'Working');
    expect(option).toBeTruthy();

    option.click();

    const statusInput = document.getElementById('status');
    const statusText = document.getElementById('status-text');

    expect(statusInput.value).toBe('Working');
    expect(statusText.textContent).toBe('Working');
    expect(statusOptions.classList.contains('hidden')).toBe(true);
  });

  it('should handle inline title editing keys', async () => {
    const issue = { id: 1, title: 'Original', status: 'Open' };
    openModal(issue);

    const titleInput = document.getElementById('title');
    // Enter edit mode
    titleInput.click();
    expect(titleInput.classList.contains('inline-editing')).toBe(true);

    // Change value
    titleInput.value = 'New Title';

    // Press Enter
    titleInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    await new Promise(process.nextTick);

    expect(api.updateIssue).toHaveBeenCalledWith(expect.objectContaining({
      title: 'New Title'
    }));
    expect(titleInput.classList.contains('inline-editing')).toBe(false);
  });

  it('should handle inline description markdown auto-list', async () => {
    openModal(null);
    const editor = document.getElementById('description-editor');

    // Mock execCommand
    document.execCommand = vi.fn();
    const textNode = document.createTextNode('* ');
    globalThis.getSelection = vi.fn().mockReturnValue({
      isCollapsed: true,
      anchorNode: textNode,
      anchorOffset: 2,
      removeAllRanges: vi.fn(),
      addRange: vi.fn()
    });

    editor.dispatchEvent(new InputEvent('input', { data: ' ' }));

    expect(document.execCommand).toHaveBeenCalledWith('insertUnorderedList');
  });

  it('should handle toolbar button click', async () => {
    openModal(null);

    document.execCommand = vi.fn();
    document.queryCommandState = vi.fn();
    globalThis.getSelection = vi.fn().mockReturnValue({
      rangeCount: 0,
      toString: () => ''
    });

    const boldBtn = document.querySelector('.editor-btn[data-cmd="bold"]');
    boldBtn.click();

    expect(document.execCommand).toHaveBeenCalledWith('bold', false, null);
  });

  it('should handle custom date input click', () => {
    openModal(null);

    const plannedDate = document.getElementById('planned-date');
    // Mock showPicker if it exists (it might not in JSDOM)
    plannedDate.showPicker = vi.fn();

    // wrapper logic: .custom-date-input click -> input.showPicker() or click()
    // We need to construct the DOM structure that matches what setupModal expects for this test?
    // setupModal does: document.querySelectorAll('.custom-date-input').forEach...
    // The test DOM in `beforeEach` has `<input id="planned-date">` but DOES NOT have the wrapper `.custom-date-input`.
    // We need to check expected DOM. 
    // Checking `modal.js`: `document.querySelectorAll('.custom-date-input').forEach...`
    // Checking `modal.test.js` HTML: ` <input id="planned-date" type="date">` without wrapper.
    // So that part of `setupModal` likely runs on nothing in the test currently.
    // I should update the DOM setup in the test to include the wrapper to test this.
    // But for now, let's skip this specific test or update DOM in this test block manually if possible, or assume it's low priority.
    // I will update the DOM in this test case.

    const wrapper = document.createElement('div');
    wrapper.className = 'custom-date-input';
    const input = document.createElement('input');
    input.type = 'date';
    input.showPicker = vi.fn();
    wrapper.appendChild(input);
    document.body.appendChild(wrapper);

    // Re-run setup to attach listeners to new elements
    setupModal(); // Re-binding: might duplicate listeners on old elements but we focus on new one

    wrapper.click();
    expect(input.showPicker).toHaveBeenCalled();
  });

  describe('Helper Functions Coverage', () => {
    it('should render modal dropdowns with issue data', async () => {
      const issue = {
        id: 1,
        status: 'Working',
        priority: 'High',
        label: { id: 2, name: 'Feature' }
      };

      openModal(issue);

      // Wait for fetchLabels promise
      await new Promise(process.nextTick);

      expect(document.getElementById('status').value).toBe('Working');
      expect(document.getElementById('status-text').textContent).toBe('Working');
      expect(document.getElementById('priority').value).toBe('High');
      expect(document.getElementById('priority-text').textContent).toBe('High');
      expect(document.getElementById('label-select').value).toBe('2');
      expect(document.getElementById('label-text').textContent).toBe('Feature');
    });

    it('should render modal dropdowns with defaults for new issue', async () => {
      openModal(null);

      await new Promise(process.nextTick);

      expect(document.getElementById('status').value).toBe('Open');
      expect(document.getElementById('status-text').textContent).toBe('Open');
      expect(document.getElementById('priority').value).toBe('Normal');
      expect(document.getElementById('priority-text').textContent).toBe('Normal');
      expect(document.getElementById('label-select').value).toBe('');
      expect(document.getElementById('label-text').textContent).toBe('No Label');
    });

    it('should setup edit modal with timestamps', () => {
      const issue = {
        id: 5,
        title: 'Edit Test',
        description: 'Edit Desc',
        status: 'Todo',
        tasks: [],
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-16T15:30:00Z'
      };

      openModal(issue);

      expect(document.getElementById('modal-title').textContent).toBe('Edit Issue #5');
      expect(document.getElementById('delete-issue-btn').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('done-btn').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('save-issue-btn').classList.contains('hidden')).toBe(true);

      // Check timestamps are rendered
      const createdDisplay = document.getElementById('created-at-display');
      const updatedDisplay = document.getElementById('updated-at-display');
      expect(createdDisplay.textContent).not.toBe('');
      expect(updatedDisplay.textContent).not.toBe('');
    });

    it('should setup new modal with correct button visibility', () => {
      openModal(null);

      expect(document.getElementById('modal-title').textContent).toBe('New Issue');
      expect(document.getElementById('delete-issue-btn').classList.contains('hidden')).toBe(true);
      expect(document.getElementById('save-issue-btn').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('done-btn').classList.contains('hidden')).toBe(true);
      expect(document.getElementById('tasks-section').classList.contains('hidden')).toBe(true);
    });

    it('should toggle inline edit mode on', () => {
      const issue = { id: 1, title: 'Test', status: 'Todo', tasks: [] };
      openModal(issue);

      const titleInput = document.getElementById('title');
      const descEditor = document.getElementById('description-editor');
      const descContainer = document.querySelector('.editor-container');

      expect(titleInput.classList.contains('inline-editable')).toBe(true);
      expect(titleInput.readOnly).toBe(true);
      expect(descContainer.classList.contains('inline-editable')).toBe(true);
      expect(descEditor.contentEditable).toBe('false');
    });

    it('should toggle inline edit mode off', () => {
      openModal(null);

      const titleInput = document.getElementById('title');
      const descEditor = document.getElementById('description-editor');
      const descContainer = document.querySelector('.editor-container');

      expect(titleInput.classList.contains('inline-editable')).toBe(false);
      expect(titleInput.readOnly).toBe(false);
      expect(descContainer.classList.contains('inline-editable')).toBe(false);
      expect(descEditor.contentEditable).toBe('true');
    });

    it('should render timestamps with missing data gracefully', () => {
      const issue = {
        id: 6,
        title: 'No Timestamps',
        status: 'Todo',
        tasks: []
      };

      openModal(issue);

      const createdDisplay = document.getElementById('created-at-display');
      const updatedDisplay = document.getElementById('updated-at-display');

      expect(createdDisplay.textContent).toBe('-');
      expect(updatedDisplay.textContent).toBe('-');
    });

    it('should handle issue with null priority gracefully', async () => {
      const issue = {
        id: 7,
        title: 'No Priority',
        status: 'Todo',
        priority: null,
        tasks: []
      };

      openModal(issue);
      await new Promise(process.nextTick);

      expect(document.getElementById('priority').value).toBe('Normal');
      expect(document.getElementById('priority-text').textContent).toBe('Normal');
    });

    it('should handle issue with null label gracefully', async () => {
      const issue = {
        id: 8,
        title: 'No Label',
        status: 'Todo',
        label: null,
        tasks: []
      };

      openModal(issue);
      await new Promise(process.nextTick);

      expect(document.getElementById('label-select').value).toBe('');
      expect(document.getElementById('label-text').textContent).toBe('No Label');
    });

    it('should render tasks section for edit modal', () => {
      const issue = {
        id: 9,
        title: 'With Tasks',
        status: 'Todo',
        tasks: [{ id: 1, title: 'Task 1', done: false }]
      };

      openModal(issue);

      expect(document.getElementById('tasks-section').classList.contains('hidden')).toBe(false);
      expect(tasks.renderTasks).toHaveBeenCalledWith(
        issue.tasks,
        expect.any(Object),
        issue,
        expect.objectContaining({
          onTaskUpdate: expect.any(Function),
          onTaskOrderSave: expect.any(Function)
        })
      );
    });

    it('should set planned_date and deadline for edit modal', () => {
      const issue = {
        id: 10,
        title: 'With Dates',
        status: 'Todo',
        tasks: [],
        planned_date: '2024-02-01T12:00:00Z',
        deadline: '2024-02-15T12:00:00Z'
      };

      openModal(issue);

      expect(document.getElementById('planned-date').value).toBe('2024-02-01');
      expect(document.getElementById('deadline').value).toBe('2024-02-15');
      expect(utils.updateDateInputStyle).toHaveBeenCalled();
    });
  });

});

