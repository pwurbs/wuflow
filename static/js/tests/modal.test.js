import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupModal, openModal, closeModal, preventNavigation } from '../components/modal.js';
import * as api from '../api.js';
import { state, setCurrentIssue } from '../state.js';
import * as utils from '../utils.js';
import * as tasks from '../components/tasks.js';

// Mock dependencies
vi.mock('../api.js', () => ({
  createIssue: vi.fn(),
  updateIssue: vi.fn().mockResolvedValue({ issue: {}, etag: '"test-etag"', conflict: false }),
  archiveIssue: vi.fn().mockResolvedValue({ id: 100, status: 'Archive' }),
  unarchiveIssue: vi.fn().mockResolvedValue({ id: 101, status: 'Done' }),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteIssue: vi.fn(),
  fetchLabels: vi.fn(),
  fetchUsers: vi.fn(),
  fetchIssueById: vi.fn()
}));

vi.mock('../state.js', () => ({
  state: {
    issues: [],
    currentIssue: null,
    currentUser: { role: 'admin' }
  },
  setCurrentIssue: vi.fn()
}));

vi.mock('../utils.js', () => ({
  showNotification: vi.fn(),
  showConfirm: vi.fn(),
  updateDateInputStyle: vi.fn(),
  stripHtml: vi.fn(s => s),
  escapeHtml: vi.fn(s => s),
  canArchive: vi.fn().mockReturnValue({ allowed: true }),
  sanitizeDescription: vi.fn(s => s),
  initCharCounter: vi.fn(() => ({ show: vi.fn(), hide: vi.fn() })),
  countCodepoints: vi.fn(s => [...s].length),
  getUserInitials: vi.fn(user => {
    if (!user) return '??';
    return ((user.first_name?.[0] || '') + (user.last_name?.[0] || '')).toUpperCase() || '??';
  })
}));

vi.mock('../components/tasks.js', () => ({
  renderTasks: vi.fn()
}));

vi.mock('../drag.js', () => ({
  getDragAfterTaskElement: vi.fn(),
  getDraggedTask: vi.fn(),
  setDraggedTask: vi.fn()
}));

// Helper function to open modal with proper mocking for existing issues
async function openModalWithMock(issue) {
  if (issue) {
    api.fetchIssueById.mockResolvedValue({ issue, etag: '"test-etag"' });
  }
  await openModal(issue);
}

describe('Modal Component', () => {
  beforeEach(() => {
    // Setup DOM
    document.body.innerHTML = `
      <div id="issue-modal" class="hidden">
        <div class="modal-content">
          <h2 id="modal-title"></h2>
          <form id="issue-form">
            <input id="issue-id" type="hidden">
            <input id="title" type="text" value="">
            <div class="editor-container">
              <div id="description-editor" contenteditable="true"></div>
              <div id="description-edit-actions" class="hidden">
                <button id="desc-cancel-btn"></button>
                <button id="desc-save-btn"></button>
              </div>
            </div>
            <div id="planned-dates-container"></div>
            <input id="deadline" type="date" class="custom-date-input">

            <!-- Custom Dropdowns -->
            <div id="status-dropdown">
              <div id="status-trigger" class="custom-select-trigger"><span id="status-text"></span></div>
              <div id="status-options" class="custom-select-options hidden"></div>
              <input type="hidden" id="status">
            </div>
            <div id="priority-dropdown">
              <div id="priority-trigger" class="custom-select-trigger"><span id="priority-text"></span></div>
              <div id="priority-options" class="custom-select-options hidden"></div>
              <input type="hidden" id="priority">
            </div>
            <div id="label-dropdown">
              <div id="label-trigger" class="custom-select-trigger"><span id="label-text"></span></div>
              <div id="label-options" class="custom-select-options hidden"></div>
              <input type="hidden" id="label-select">
            </div>
            <div id="assignee-dropdown">
              <div id="assignee-trigger" class="custom-select-trigger"><span id="assignee-text"></span></div>
              <div id="assignee-options" class="custom-select-options hidden"></div>
              <input type="hidden" id="assignee-select">
            </div>

            <div id="tasks-section">
              <div id="task-form-container">
                <input id="new-task-title" type="text">
                <input id="new-task-deadline" type="date">
                <button id="add-task-btn" type="button"></button>
              </div>
              <ul id="task-list"></ul>
            </div>

            <button id="delete-issue-btn" type="button"></button>
            <button id="archive-issue-btn" type="button"></button>
            <button id="unarchive-issue-btn" type="button"></button>
            <div id="timestamp-container" class="hidden">
                 <div class="timestamp-item"><span id="created-at-display"></span></div>
                 <div class="timestamp-item"><span id="updated-at-display"></span></div>
            </div>
            
            <button id="cancel-btn" type="button"></button>
            <button id="save-issue-btn" type="submit"></button>
            <button id="done-btn" type="button"></button>

            <!-- Editor toolbar btns for setup -->
            <button class="editor-btn" data-cmd="bold"></button>
            <button class="editor-btn" data-cmd="underline"></button>
            <button class="editor-btn" data-cmd="italic"></button>
            <button class="editor-btn" data-cmd="createLink"></button>
          </form>
        </div>
      </div>

      <!-- Left nav for active state check -->
      <div class="left-menu">
        <div id="add-issue-btn" class="menu-btn"></div>
        <div id="nav-board" class="menu-btn"></div>
      </div>
    `;

    // Reset mocks
    vi.clearAllMocks();

    // Default mock returns
    api.fetchLabels.mockResolvedValue([{ id: 1, name: 'Bug' }, { id: 2, name: 'Feature' }]);
    api.fetchUsers.mockResolvedValue([{ id: 1, first_name: 'Test', last_name: 'User', active: true }]);
    api.updateIssue.mockResolvedValue({ issue: {}, etag: '"updated-etag"', conflict: false });
    state.currentIssue = null;
    state.currentUser = { role: 'admin' };
    setCurrentIssue.mockImplementation((val) => { state.currentIssue = val; });

    // Mock JSDOM missing functions BEFORE setupModal so execCommand is available at init
    document.execCommand = vi.fn();
    document.queryCommandState = vi.fn();
    HTMLElement.prototype.scrollIntoView = vi.fn();
    HTMLInputElement.prototype.reportValidity = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => { });

    // Initialize module
    setupModal(vi.fn());
  });
  it('should open modal for new issue', async () => {
    openModal(null);
    expect(document.getElementById('issue-modal').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('modal-title').textContent).toBe('New Issue');
    expect(document.getElementById('save-issue-btn').classList.contains('hidden')).toBe(false);
    expect(setCurrentIssue).toHaveBeenCalledWith(null);
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

    // Mock fetchIssueById to return this specific issue
    api.fetchIssueById.mockResolvedValue({ issue, etag: '"test-etag"' });

    await openModal(issue);

    expect(document.getElementById('issue-modal').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('modal-title').textContent).toBe('Edit Issue #123');
    expect(document.getElementById('title').value).toBe('Test Issue');
    expect(document.getElementById('description-editor').innerHTML).toBe('Test Desc');
    expect(setCurrentIssue).toHaveBeenCalledWith(issue);
    expect(api.fetchLabels).toHaveBeenCalled(); // labels fetched to render options
  });

  it('should close modal and reset state', () => {
    openModal(null);
    closeModal();

    expect(document.getElementById('issue-modal').classList.contains('hidden')).toBe(true);
    expect(setCurrentIssue).toHaveBeenCalledWith(null);
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
    await openModalWithMock(issue);

    // Simulate status change
    const statusSelect = document.getElementById('status');
    statusSelect.value = 'Done';
    statusSelect.dispatchEvent(new Event('change'));

    await new Promise(process.nextTick);

    expect(api.updateIssue).toHaveBeenCalledWith(expect.objectContaining({
      id: 1,
      status: 'Done'
    }), expect.any(String));
    expect(utils.showNotification).toHaveBeenCalled();
  });

  it('should handle task creation', async () => {
    const issue = { id: 1, title: 'Task Parent', tasks: [] };
    await openModalWithMock(issue);

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
    await openModalWithMock(issue);

    utils.showConfirm.mockResolvedValue(true);

    document.getElementById('delete-issue-btn').click();
    await new Promise(process.nextTick);

    expect(utils.showConfirm).toHaveBeenCalled();
    expect(api.deleteIssue).toHaveBeenCalledWith(99);
    expect(document.getElementById('issue-modal').classList.contains('hidden')).toBe(true);
  });

  it('should archive issue after confirmation', async () => {
    const issue = { id: 100, title: 'To Archive', status: 'Open' };
    await openModalWithMock(issue);

    utils.showConfirm.mockResolvedValue(true);

    document.getElementById('archive-issue-btn').click();
    await new Promise(process.nextTick);

    expect(utils.showConfirm).toHaveBeenCalled();
    expect(api.archiveIssue).toHaveBeenCalledWith(100);
    expect(utils.showNotification).toHaveBeenCalledWith('Issue archived');
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
    await openModalWithMock(issue);

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
    }), expect.any(String));
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

    const wrapper = document.createElement('div');
    wrapper.className = 'custom-date-input';
    const input = document.createElement('input');
    input.type = 'date';
    input.showPicker = vi.fn();
    wrapper.appendChild(input);
    document.body.appendChild(wrapper);

    // Re-run setup to attach listeners to new elements
    setupModal();

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

      await openModalWithMock(issue);

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

    it('should setup edit modal with timestamps', async () => {
      const issue = {
        id: 5,
        title: 'Edit Test',
        description: 'Edit Desc',
        status: 'Todo',
        tasks: [],
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-16T15:30:00Z'
      };

      await openModalWithMock(issue);

      expect(document.getElementById('modal-title').textContent).toBe('Edit Issue #5');
      expect(document.getElementById('delete-issue-btn').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('done-btn').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('save-issue-btn').classList.contains('hidden')).toBe(true);
      expect(document.getElementById('archive-issue-btn').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('unarchive-issue-btn').classList.contains('hidden')).toBe(true);

      // Check timestamps are rendered
      const createdDisplay = document.getElementById('created-at-display');
      const updatedDisplay = document.getElementById('updated-at-display');
      expect(createdDisplay.textContent).not.toBe('');
      expect(updatedDisplay.textContent).not.toBe('');
    });

    it('should show unarchive button when issue is already archived', async () => {
      const issue = {
        id: 99,
        title: 'Archived',
        status: 'Archive',
        tasks: []
      };

      await openModalWithMock(issue);

      expect(document.getElementById('archive-issue-btn').classList.contains('hidden')).toBe(true);
      expect(document.getElementById('unarchive-issue-btn').classList.contains('hidden')).toBe(false);
    });

    it('should unarchive issue after confirmation', async () => {
      const issue = { id: 101, title: 'To Unarchive', status: 'Archive' };
      await openModalWithMock(issue);

      utils.showConfirm.mockResolvedValue(true);

      document.getElementById('unarchive-issue-btn').click();
      await new Promise(process.nextTick);

      expect(utils.showConfirm).toHaveBeenCalled();
      expect(api.unarchiveIssue).toHaveBeenCalledWith(101);
      expect(utils.showNotification).toHaveBeenCalledWith('Issue unarchived');
      expect(document.getElementById('issue-modal').classList.contains('hidden')).toBe(true);
    });

    it('should set read-only mode for archived issues', async () => {
      const issue = {
        id: 102,
        title: 'Read Only',
        status: 'Archive',
        tasks: []
      };

      await openModalWithMock(issue);

      expect(document.getElementById('modal-title').textContent).toBe('Archived Issue #102');

      const titleInput = document.getElementById('title');
      const descEditor = document.getElementById('description-editor');
      const taskForm = document.getElementById('task-form-container');

      // Attempt to Enter Title Edit
      titleInput.click();
      expect(titleInput.classList.contains('inline-editing')).toBe(false);

      // Attempt to Enter Desc Edit
      descEditor.click();
      const descContainer = document.querySelector('.editor-container');
      expect(descContainer.classList.contains('inline-editing')).toBe(false);

      // Task Form Hidden
      expect(taskForm.classList.contains('hidden')).toBe(true);

      // Date Inputs Pointer Events
      const dateInputs = document.querySelectorAll('.custom-date-input');
      expect(dateInputs[0].style.pointerEvents).toBe('none');

      // Dropdown Triggers Disabled
      const triggers = document.querySelectorAll('.custom-select-trigger');
      expect(triggers[0].style.pointerEvents).toBe('none');
    });

    it('should setup new modal with correct button visibility', () => {
      openModal(null);

      expect(document.getElementById('modal-title').textContent).toBe('New Issue');
      expect(document.getElementById('delete-issue-btn').classList.contains('hidden')).toBe(true);
      expect(document.getElementById('save-issue-btn').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('done-btn').classList.contains('hidden')).toBe(true);
      expect(document.getElementById('tasks-section').classList.contains('hidden')).toBe(true);
    });

    it('should toggle inline edit mode on', async () => {
      const issue = { id: 1, title: 'Test', status: 'Todo', tasks: [] };
      await openModalWithMock(issue);

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

    it('should render timestamps with missing data gracefully', async () => {
      const issue = {
        id: 6,
        title: 'No Timestamps',
        status: 'Todo',
        tasks: []
      };

      await openModalWithMock(issue);

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

      await openModalWithMock(issue);

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

      await openModalWithMock(issue);

      expect(document.getElementById('label-select').value).toBe('');
      expect(document.getElementById('label-text').textContent).toBe('No Label');
    });

    it('should render tasks section for edit modal', async () => {
      const issue = {
        id: 9,
        title: 'With Tasks',
        status: 'Todo',
        tasks: [{ id: 1, title: 'Task 1', done: false }]
      };

      await openModalWithMock(issue);

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

    it('should set planned_date and deadline for edit modal', async () => {
      const issue = {
        id: 10,
        title: 'With Dates',
        status: 'Todo',
        tasks: [],
        planned_dates: ['2024-02-01'],
        deadline: '2024-02-15T12:00:00Z'
      };

      await openModalWithMock(issue);

      const container = document.getElementById('planned-dates-container');
      expect(container.querySelectorAll('.date-chip').length).toBe(1);
      expect(container.querySelector('.date-chip').dataset.date).toBe('2024-02-01');
      expect(document.getElementById('deadline').value).toBe('2024-02-15');
      expect(utils.updateDateInputStyle).toHaveBeenCalled();
    });
  });

  describe('Sidebar Immediate Save', () => {
    it('should update priority immediately on change', async () => {
      const issue = { id: 1, priority: 'Normal' };
      await openModalWithMock(issue);

      const prioritySelect = document.getElementById('priority');
      prioritySelect.value = 'High';
      prioritySelect.dispatchEvent(new Event('change'));

      await new Promise(process.nextTick);

      expect(api.updateIssue).toHaveBeenCalledWith(expect.objectContaining({
        id: 1,
        priority: 'High'
      }), expect.any(String));
    });

    it('should update planned_dates immediately on change via picker', async () => {
      const issue = { id: 1, planned_dates: [] };
      await openModalWithMock(issue);

      const picker = document.getElementById('planned-date-picker');
      picker.value = '2025-01-01';
      picker.dispatchEvent(new Event('change'));

      await new Promise(process.nextTick);

      expect(api.updateIssue).toHaveBeenCalledWith(expect.objectContaining({
        id: 1,
        planned_dates: ['2025-01-01']
      }), expect.any(String));
    });

    it('should update deadline immediately on change', async () => {
      const issue = { id: 1 };
      await openModalWithMock(issue);

      const input = document.getElementById('deadline');
      input.value = '2025-12-31';
      input.dispatchEvent(new Event('change'));

      await new Promise(process.nextTick);

      expect(api.updateIssue).toHaveBeenCalledWith(expect.objectContaining({
        id: 1,
        deadline: new Date('2025-12-31T12:00:00')
      }), expect.any(String));
    });

    it('should update label immediately on change', async () => {
      const issue = { id: 1, label: null };
      await openModalWithMock(issue);

      const select = document.getElementById('label-select');
      select.value = '2'; // ID 2
      select.dispatchEvent(new Event('change'));

      await new Promise(process.nextTick);

      expect(api.updateIssue).toHaveBeenCalledWith(expect.objectContaining({
        id: 1,
        label: { id: 2 }
      }), expect.any(String));
    });
  });

  describe('Unload Listeners', () => {
    it('should add unload listener when entering inline edit', async () => {
      const addSpy = vi.spyOn(globalThis, 'addEventListener');
      const issue = { id: 1, title: 'Test' };
      await openModalWithMock(issue);

      const titleInput = document.getElementById('title');
      titleInput.click();

      expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    });

    it('should remove unload listener when canceling edit', async () => {
      const removeSpy = vi.spyOn(globalThis, 'removeEventListener');
      const issue = { id: 1, title: 'Test' };
      await openModalWithMock(issue);

      const titleInput = document.getElementById('title');
      titleInput.click();

      titleInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(removeSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    });
  });

  describe('Inline Editing Features', () => {
    it('should cancel inline title edit on Escape key', async () => {
      const issue = { id: 1, title: 'Original' };
      await openModalWithMock(issue);

      const titleInput = document.getElementById('title');
      titleInput.click(); // Enter edit
      titleInput.value = 'Changed';

      titleInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(titleInput.value).toBe('Original');
      expect(titleInput.readOnly).toBe(true);
    });

    it('should revert to original on empty title blur', async () => {
      const issue = { id: 1, title: 'Original' };
      await openModalWithMock(issue);

      const titleInput = document.getElementById('title');
      titleInput.click();
      titleInput.value = ''; // Clear title

      titleInput.dispatchEvent(new Event('blur'));

      await new Promise(process.nextTick);

      expect(titleInput.value).toBe('Original'); // Reverted
      expect(api.updateIssue).not.toHaveBeenCalled();
      expect(titleInput.classList.contains('inline-editing')).toBe(false);
    });

    it('should revert title and close modal on Done with empty title', async () => {
      const issue = { id: 1, title: 'Original' };
      await openModalWithMock(issue);
      const titleInput = document.getElementById('title');
      titleInput.click();
      titleInput.value = '';

      const doneBtn = document.getElementById('done-btn');
      doneBtn.click();

      await new Promise(process.nextTick);

      expect(titleInput.value).toBe('Original'); // Reverted
      expect(api.updateIssue).not.toHaveBeenCalled();
      // Modal should close after revert
      expect(document.getElementById('issue-modal').classList.contains('hidden')).toBe(true);
    });

    it('should auto-save title on blur', async () => {
      const issue = { id: 1, title: 'Original' };
      await openModalWithMock(issue);

      const titleInput = document.getElementById('title');
      titleInput.click();
      titleInput.value = 'Saved Title';

      titleInput.dispatchEvent(new Event('blur'));

      await new Promise(process.nextTick);

      expect(api.updateIssue).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Saved Title'
      }), expect.any(String));
      expect(titleInput.readOnly).toBe(true);
    });

    it('should auto-save title on Done click with changes', async () => {
      const issue = { id: 1, title: 'Original' };
      await openModalWithMock(issue);

      const titleInput = document.getElementById('title');
      titleInput.click();
      titleInput.value = 'Changed';

      const doneBtn = document.getElementById('done-btn');
      doneBtn.click();

      await new Promise(process.nextTick);

      expect(utils.showConfirm).not.toHaveBeenCalled();
      expect(api.updateIssue).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Changed'
      }), expect.any(String));
    });

    it('should prompt save on done button click with description changes - save path', async () => {
      const issue = { id: 1, description: 'Original' };
      await openModalWithMock(issue);

      // Enter description edit
      const descEditor = document.getElementById('description-editor');
      descEditor.click();
      descEditor.innerHTML = 'Changed Desc';

      utils.showConfirm.mockResolvedValue(true);

      const doneBtn = document.getElementById('done-btn');
      doneBtn.click();

      await new Promise(process.nextTick);

      expect(utils.showConfirm).toHaveBeenCalled();

      await new Promise(process.nextTick);
      expect(api.updateIssue).toHaveBeenCalledWith(expect.objectContaining({
        description: 'Changed Desc'
      }), expect.any(String));
    });

    it('should auto-save title on Enter key', async () => {
      const issue = { id: 1, title: 'Original' };
      await openModalWithMock(issue);

      const titleInput = document.getElementById('title');
      titleInput.click();
      titleInput.value = 'Changed';

      titleInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      await new Promise(process.nextTick);

      expect(api.updateIssue).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Changed'
      }), expect.any(String));
      expect(titleInput.readOnly).toBe(true);
    });

    it('should NOT call updateIssue and close modal when Done clicked with no changes', async () => {
      const issue = { id: 1, title: 'Original', description: 'Desc' };
      await openModalWithMock(issue);

      // Enter edit mode but don't change anything
      document.getElementById('title').click();

      const doneBtn = document.getElementById('done-btn');
      doneBtn.click();

      await new Promise(process.nextTick);

      expect(utils.showConfirm).not.toHaveBeenCalled();
      expect(api.updateIssue).not.toHaveBeenCalled();
      expect(document.getElementById('issue-modal').classList.contains('hidden')).toBe(true);
    });
    it('should enter description inline edit on click', async () => {
      const issue = { id: 1, description: 'Desc' };
      await openModalWithMock(issue);

      const descContainer = document.querySelector('.editor-container');
      const descEditor = document.getElementById('description-editor');

      descEditor.click();

      expect(descContainer.classList.contains('inline-editing')).toBe(true);
      expect(descEditor.contentEditable).toBe('true');
    });
  });
  describe('Multi-Day Date Management', () => {
    it('should add a date via the picker in existing issue mode', async () => {
      const issue = { id: 1, planned_dates: [] };
      await openModalWithMock(issue);

      const picker = document.getElementById('planned-date-picker');
      picker.value = '2025-05-20';
      picker.dispatchEvent(new Event('change'));

      await new Promise(process.nextTick);

      expect(issue.planned_dates).toContain('2025-05-20');
      expect(api.updateIssue).toHaveBeenCalled();

      const container = document.getElementById('planned-dates-container');
      expect(container.querySelectorAll('.date-chip').length).toBe(1);
    });

    it('should remove a date via chip in existing issue mode', async () => {
      const issue = { id: 1, planned_dates: ['2025-05-20'] };
      await openModalWithMock(issue);

      const container = document.getElementById('planned-dates-container');
      const chip = container.querySelector('.date-chip');
      const removeBtn = chip.querySelector('.remove');

      await removeBtn.click();
      await new Promise(process.nextTick);

      expect(issue.planned_dates).not.toContain('2025-05-20');
      expect(api.updateIssue).toHaveBeenCalled();
      expect(container.querySelectorAll('.date-chip').length).toBe(0);
    });

    it('should add/remove dates in New Issue mode (state-less)', async () => {
      openModal(null);

      const picker = document.getElementById('planned-date-picker');
      picker.value = '2025-06-01';
      picker.dispatchEvent(new Event('change'));

      const container = document.getElementById('planned-dates-container');
      expect(container.querySelectorAll('.date-chip').length).toBe(1);

      const chip = container.querySelector('.date-chip');
      expect(chip.dataset.date).toBe('2025-06-01');

      const removeBtn = chip.querySelector('.remove');
      await removeBtn.click();

      expect(container.querySelectorAll('.date-chip').length).toBe(0);
      expect(api.updateIssue).not.toHaveBeenCalled();
    });
  });

  describe('Conflict Handling', () => {
    it('should show conflict dialog when updateIssue returns conflict', async () => {
      const issue = { id: 1, title: 'Original', status: 'Todo' };
      await openModalWithMock(issue);

      // Mock updateIssue to return conflict
      api.updateIssue.mockResolvedValue({ issue: null, etag: null, conflict: true });

      // Mock showConfirm to simulate user clicking Reload
      utils.showConfirm.mockResolvedValue(true);

      // Trigger a save (e.g., change status)
      const statusSelect = document.getElementById('status');
      statusSelect.value = 'Done';
      statusSelect.dispatchEvent(new Event('change'));

      await new Promise(process.nextTick);

      // Verify conflict dialog was shown
      expect(utils.showConfirm).toHaveBeenCalledWith(
        'Conflict Detected',
        expect.stringContaining('modified by another user'),
        'Reload',
        'Cancel',
        'primary'
      );

      // Modal should stay open after reload
      expect(document.getElementById('issue-modal').classList.contains('hidden')).toBe(false);

      // Verify fresh data was fetched and modal was updated
      expect(api.fetchIssueById).toHaveBeenCalledWith(1);
      expect(utils.showNotification).toHaveBeenCalledWith('Reloaded with latest data');
    });

    it('should keep modal open when user cancels conflict reload', async () => {
      const issue = { id: 1, title: 'Original', status: 'Todo' };
      await openModalWithMock(issue);

      api.updateIssue.mockResolvedValue({ issue: null, etag: null, conflict: true });
      utils.showConfirm.mockResolvedValue(false); // User cancels

      const statusSelect = document.getElementById('status');
      statusSelect.value = 'Done';
      statusSelect.dispatchEvent(new Event('change'));

      await new Promise(process.nextTick);

      expect(utils.showConfirm).toHaveBeenCalled();
      // Modal stays open when user cancels
      expect(document.getElementById('issue-modal').classList.contains('hidden')).toBe(false);
    });
  });

  describe('Additional Coverage Improvements', () => {
    it('should handle creator display in new modal', () => {
      state.currentUser = { first_name: 'John', last_name: 'Doe' };
      openModal(null);
      // New modal should not display creator name in timestamps (hidden)
      const timestampContainer = document.getElementById('timestamp-container');
      expect(timestampContainer.classList.contains('hidden')).toBe(true);
      // And element #creator-display should not exist or be empty if we removed it
      const creatorDisplay = document.getElementById('creator-display');
      expect(creatorDisplay).toBeNull();
    });

    it('should handle creator display in edit modal', async () => {
      const issue = {
        id: 1,
        title: 'Test',
        creator: { first_name: 'Jane', last_name: 'Smith' },
        created_at: '2023-01-01T12:00:00Z'
      };
      await openModalWithMock(issue);
      const createdAtDisplay = document.getElementById('created-at-display');
      expect(createdAtDisplay.textContent).toContain('by');
      const badge = createdAtDisplay.querySelector('.user-badge');
      expect(badge).toBeTruthy();
      expect(badge.textContent).toBe('JS');
      expect(badge.title).toBe('Jane Smith');
    });

    it('should handle updater display in edit modal', async () => {
      const issue = {
        id: 1,
        title: 'Test',
        updater: { first_name: 'Bob', last_name: 'Jones' },
        updated_at: '2023-01-02T12:00:00Z'
      };
      await openModalWithMock(issue);
      const updatedAtDisplay = document.getElementById('updated-at-display');
      expect(updatedAtDisplay.textContent).toContain('by');
      const badge = updatedAtDisplay.querySelector('.user-badge');
      expect(badge).toBeTruthy();
      expect(badge.textContent).toBe('BJ');
      expect(badge.title).toBe('Bob Jones');
    });

    it('should handle unknown creator in edit modal', async () => {
      const issue = { id: 1, title: 'Test', creator: null, created_at: '2023-01-01T12:00:00Z' };
      await openModalWithMock(issue);
      const createdAtDisplay = document.getElementById('created-at-display');
      expect(createdAtDisplay.textContent).not.toContain('by');
    });

    it('should handle link click in description editor in read-only mode', async () => {
      const issue = { id: 1, description: '<a id="test-link" href="https://example.com">Link</a>' };
      await openModalWithMock(issue);

      const descEditor = document.getElementById('description-editor');
      const link = descEditor.querySelector('a'); // ID might be stripped by sanitizer in real app
      const openSpy = vi.spyOn(globalThis, 'open').mockImplementation(() => ({}));

      // Ensure we are NOT in edit mode yet
      const descContainer = document.querySelector('.editor-container');
      descContainer.classList.add('inline-editable');

      // Prevent JSDOM navigation error by preventing default in the test
      link.addEventListener('click', e => e.preventDefault());

      // Dispatch click on the link itself
      link.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(openSpy).toHaveBeenCalled();
      openSpy.mockRestore();
    });

    it('should handle assignee change and immediate save', async () => {
      const issue = { id: 1, assignee_id: null };
      await openModalWithMock(issue);

      const assigneeSelect = document.getElementById('assignee-select');
      assigneeSelect.value = '1';
      assigneeSelect.dispatchEvent(new Event('change'));

      await new Promise(process.nextTick);

      expect(api.updateIssue).toHaveBeenCalledWith(expect.objectContaining({
        assignee_id: 1
      }), expect.any(String));
      expect(api.fetchIssueById).toHaveBeenCalled();
    });

    it('should blur editing task input on Done click to trigger auto-save', async () => {
      const issue = { id: 1, tasks: [{ id: 101, title: 'Task 1' }] };
      await openModalWithMock(issue);

      // Mock renderTasks to render a task item in editing state
      tasks.renderTasks.mockImplementation((taskList, container) => {
        container.innerHTML = `
          <li class="task-item editing" data-id="101">
            <input class="task-title-input" data-original-title="Task 1" value="Changed Task">
          </li>
        `;
      });
      await openModalWithMock(issue);

      const doneBtn = document.getElementById('done-btn');
      const taskInput = document.querySelector('.task-title-input');
      const blurSpy = vi.spyOn(taskInput, 'blur');

      doneBtn.click();
      await new Promise(process.nextTick);

      expect(utils.showConfirm).not.toHaveBeenCalled();
      expect(blurSpy).toHaveBeenCalled();
    });

    it('should save task order', async () => {
      const issue = {
        id: 1,
        tasks: [
          { id: 101, title: 'T1', position: 0 },
          { id: 102, title: 'T2', position: 1 }
        ]
      };
      await openModalWithMock(issue);

      // Setup DOM as if dragged
      const taskList = document.getElementById('task-list');
      taskList.innerHTML = `
          <li class="task-item" data-id="102"></li>
          <li class="task-item" data-id="101"></li>
          `;

      // We need to trigger the saveTaskOrder somehow. It's internal but used in renderTasks callback
      // We can manually call it if we can access it, or trigger the callback.
      const taskOrderCallback = tasks.renderTasks.mock.calls[0][3].onTaskOrderSave;
      await taskOrderCallback();

      expect(api.updateTask).toHaveBeenCalled();
      expect(issue.tasks[0].id).toBe(102);
    });

    it('should handle ordered list auto-markdown', async () => {
      openModal(null);
      const editor = document.getElementById('description-editor');

      document.execCommand = vi.fn();
      const textNode = document.createTextNode('1. ');
      globalThis.getSelection = vi.fn().mockReturnValue({
        isCollapsed: true,
        anchorNode: textNode,
        anchorOffset: 3,
        removeAllRanges: vi.fn(),
        addRange: vi.fn()
      });

      editor.dispatchEvent(new InputEvent('input', { data: ' ' }));

      expect(document.execCommand).toHaveBeenCalledWith('insertOrderedList');
    });

    it('should create link via toolbar with selection', async () => {
      openModal(null);

      globalThis.getSelection = vi.fn().mockReturnValue({
        toString: () => 'example.com',
        anchorNode: { parentElement: { tagName: 'A', target: '' } }
      });
      document.execCommand = vi.fn();

      const linkBtn = document.querySelector('.editor-btn[data-cmd="createLink"]');
      linkBtn.click();

      expect(document.execCommand).toHaveBeenCalledWith('createLink', false, 'https://example.com');
    });

    it('should reject javascript: URIs in createLink', async () => {
      openModal(null);

      globalThis.getSelection = vi.fn().mockReturnValue({
        toString: () => 'javascript:alert(1)', // NOSONAR
        anchorNode: { parentElement: { tagName: 'A', target: '' } }
      });
      document.execCommand = vi.fn();

      const linkBtn = document.querySelector('.editor-btn[data-cmd="createLink"]');
      linkBtn.click();

      expect(document.execCommand).not.toHaveBeenCalled();
    });

    it('should handle planned date chip add button click', () => {
      openModal(null);
      const addBtn = document.querySelector('.date-chip-add');
      const picker = document.getElementById('planned-date-picker');
      picker.showPicker = vi.fn();

      addBtn.click();
      expect(picker.showPicker).toHaveBeenCalled();
    });

    it('should close other dropdowns when opening one', () => {
      openModal(null);
      const statusTrigger = document.getElementById('status-trigger');
      const priorityOptions = document.getElementById('priority-options');

      // Open priority first
      priorityOptions.classList.remove('hidden');

      // Toggle status
      statusTrigger.click();

      expect(priorityOptions.classList.contains('hidden')).toBe(true);
    });

    it('should handle archive issue failure when not allowed', async () => {
      const issue = { id: 1, status: 'Open' };
      await openModalWithMock(issue);

      utils.canArchive.mockReturnValue({ allowed: false, reason: 'Reason' });
      utils.showConfirm.mockResolvedValue(true);

      const archiveBtn = document.getElementById('archive-issue-btn');
      archiveBtn.click();

      await new Promise(process.nextTick);

      expect(utils.showConfirm).toHaveBeenCalledWith('Cannot Archive', 'Reason', 'OK', null, 'primary');
      expect(api.updateIssue).not.toHaveBeenCalled();
    });

    it('should handle preventNavigation', () => {
      const event = { preventDefault: vi.fn(), returnValue: 'abc' };
      preventNavigation(event);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.returnValue).toBe('');
    });

    it('should handle updateToolbarState for links and underline', async () => {
      openModal(null);
      const editor = document.getElementById('description-editor');

      // Mock selection inside a link
      const anchorNode = document.createElement('a');
      anchorNode.href = 'https://example.com';
      anchorNode.textContent = 'Link';
      editor.appendChild(anchorNode); // Must be child to hit parentNode loop

      globalThis.getSelection = vi.fn().mockReturnValue({
        rangeCount: 1,
        anchorNode: anchorNode
      });
      document.queryCommandState = vi.fn().mockReturnValue(true);

      editor.dispatchEvent(new Event('mouseup')); // Triggers updateToolbarState

      const linkBtn = document.querySelector('.editor-btn[data-cmd="createLink"]');
      const underlineBtn = document.querySelector('.editor-btn[data-cmd="underline"]');

      expect(linkBtn.classList.contains('active')).toBe(true);
      expect(underlineBtn.classList.contains('active')).toBe(false); // Should be false when inLink is true
    });

    it('should handle dropdown option clicks', async () => {
      const issue = { id: 1, label: null, priority: 'Normal' };
      await openModalWithMock(issue);

      // Priority option click
      const priorityOptions = document.getElementById('priority-options');
      const highOption = Array.from(priorityOptions.children).find(c => c.textContent === 'High');
      highOption.click();
      expect(document.getElementById('priority').value).toBe('High');

      // Label "No Label" click
      const labelOptions = document.getElementById('label-options');
      const noLabelOption = Array.from(labelOptions.children).find(c => c.textContent === 'No Label');
      noLabelOption.click();
      expect(document.getElementById('label-select').value).toBe('');

      // Label specific option click
      const bugOption = Array.from(labelOptions.children).find(c => c.textContent === 'Bug');
      bugOption.click();
      expect(document.getElementById('label-select').value).toBe('1');

      // Assignee option clicks
      const assigneeOptions = document.getElementById('assignee-options');
      const unassignedOption = Array.from(assigneeOptions.children).find(c => c.textContent === 'Unassigned');
      unassignedOption.click();
      expect(document.getElementById('assignee-select').value).toBe('');

      const userOption = Array.from(assigneeOptions.children).find(c => c.textContent === 'Test User');
      userOption.click();
      expect(document.getElementById('assignee-select').value).toBe('1');
    });

    it('should handle setupCustomDropdown else branch (closing)', async () => {
      openModal(null);
      const trigger = document.getElementById('status-trigger');
      const options = document.getElementById('status-options');

      trigger.click(); // Open
      trigger.click(); // Close

      expect(options.classList.contains('hidden')).toBe(true);
    });

    it('should handle task title enter keypress', async () => {
      const issue = { id: 1, title: 'Test' };
      await openModalWithMock(issue);

      const input = document.getElementById('new-task-title');
      input.value = 'New Task';

      api.createTask.mockResolvedValue({ id: 999, title: 'New Task' });

      input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter' }));

      await new Promise(process.nextTick);
      expect(api.createTask).toHaveBeenCalled();
    });

    it('should handle modal open failure - issue not found', async () => {
      api.fetchIssueById.mockResolvedValue({ issue: null, etag: null });
      const modal = document.getElementById('issue-modal');

      await openModal({ id: 999 });

      expect(utils.showNotification).toHaveBeenCalledWith('Issue not found or was deleted', 'error');
      expect(modal.classList.contains('hidden')).toBe(true);
    });

    it('should handle modal open failure - fetch error', async () => {
      api.fetchIssueById.mockRejectedValue(new Error('Network Error'));
      const modal = document.getElementById('issue-modal');

      await openModal({ id: 999 });

      expect(utils.showNotification).toHaveBeenCalledWith('Failed to load issue', 'error');
      expect(modal.classList.contains('hidden')).toBe(true);
    });

    it('should handle cancel description edit', async () => {
      const issue = { id: 1, description: 'Original' };
      await openModalWithMock(issue);

      const descEditor = document.getElementById('description-editor');
      const descContainer = document.querySelector('.editor-container');

      descEditor.click(); // Enter edit
      descEditor.innerHTML = 'Changed';

      const cancelBtn = document.getElementById('desc-cancel-btn');
      cancelBtn.dispatchEvent(new MouseEvent('mousedown'));

      expect(descEditor.innerHTML).toBe('Original');
      expect(descContainer.classList.contains('inline-editing')).toBe(false);
    });


    it('should handle link bubble loop (span inside link)', async () => {
      const issue = { id: 1, description: '<a href="https://example.com"><span id="inner">Link</span></a>' };
      await openModalWithMock(issue);

      const descEditor = document.getElementById('description-editor');
      const inner = descEditor.querySelector('span'); // ID might be stripped by sanitizer
      const openSpy = vi.spyOn(globalThis, 'open').mockImplementation(() => ({}));

      inner.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(openSpy).toHaveBeenCalled();
      openSpy.mockRestore();
    });
  });

  describe('Client-side Validation', () => {
    it('should validate title length before submit', async () => {
      await openModalWithMock(null);
      document.getElementById('title').value = 'a'.repeat(101);
      document.getElementById('save-issue-btn').click();

      await new Promise(process.nextTick);

      expect(api.createIssue).not.toHaveBeenCalled();
      expect(utils.showNotification).toHaveBeenCalledWith('Title must not exceed 100 characters.', 'error');
    });

    it('should validate description length before submit', async () => {
      await openModalWithMock(null);
      document.getElementById('title').value = 'Valid Title';
      const longDesc = 'a'.repeat(5001);
      document.getElementById('description-editor').textContent = longDesc;

      document.getElementById('save-issue-btn').click();

      await new Promise(process.nextTick);

      expect(api.createIssue).not.toHaveBeenCalled();
      expect(utils.showNotification).toHaveBeenCalledWith('Description must not exceed 5000 characters.', 'error');
    });

    it('should validate task title length', async () => {
      const issue = { id: 1, tasks: [] };
      await openModalWithMock(issue);
      const titleInput = document.getElementById('new-task-title');
      titleInput.value = 'a'.repeat(101);
      document.getElementById('add-task-btn').click();

      expect(api.createTask).not.toHaveBeenCalled();
      expect(utils.showNotification).toHaveBeenCalledWith('Task title must not exceed 100 characters.', 'error');
    });
  });

  describe('Conflict Handling and Error Paths', () => {
    it('should handle conflict in saveIssueWithConflictCheck and reload', async () => {
      const issue = { id: 1, title: 'Old' };
      await openModalWithMock(issue);

      api.updateIssue.mockResolvedValue({ conflict: true });
      utils.showConfirm.mockResolvedValue(true); // User clicks Reload
      api.fetchIssueById.mockResolvedValue({ issue: { ...issue, title: 'Fresh' }, etag: '"new-etag"' });

      // Trigger a change that calls saveIssueWithConflictCheck (e.g. priority)
      const prioritySelect = document.getElementById('priority');
      prioritySelect.value = 'High';
      prioritySelect.dispatchEvent(new Event('change'));

      await new Promise(process.nextTick);
      await new Promise(process.nextTick); // Extra tick for fetchIssueById

      expect(utils.showConfirm).toHaveBeenCalledWith(
        'Conflict Detected',
        expect.any(String),
        'Reload',
        'Cancel',
        'primary'
      );
      expect(document.getElementById('modal-title').textContent).toContain('Edit Issue #1');
    });

    it('should handle sidebar save failures', async () => {
      const issue = { id: 1, title: 'Test' };
      await openModalWithMock(issue);

      api.updateIssue.mockRejectedValue(new Error('Save Failed'));

      // Test Priority failure
      document.getElementById('priority').dispatchEvent(new Event('change'));
      await new Promise(process.nextTick);
      expect(utils.showNotification).toHaveBeenCalledWith('Save Failed', 'error');

      // Test Status failure
      document.getElementById('status').dispatchEvent(new Event('change'));
      await new Promise(process.nextTick);
      expect(utils.showNotification).toHaveBeenCalledWith('Save Failed', 'error');

      // Test Deadline failure
      document.getElementById('deadline').value = '2023-01-01';
      document.getElementById('deadline').dispatchEvent(new Event('change'));
      await new Promise(process.nextTick);
      expect(utils.showNotification).toHaveBeenCalledWith('Save Failed', 'error');

      // Test Assignee failure
      document.getElementById('assignee-select').dispatchEvent(new Event('change'));
      await new Promise(process.nextTick);
      expect(utils.showNotification).toHaveBeenCalledWith('Save Failed', 'error');

      // Test Label failure
      document.getElementById('label-select').dispatchEvent(new Event('change'));
      await new Promise(process.nextTick);
      expect(utils.showNotification).toHaveBeenCalledWith('Save Failed', 'error');
    });

    it('should handle "Me" assignee selection', async () => {
      const issue = { id: 1, title: 'Test' };
      const meUser = { id: 5, first_name: 'Admin', last_name: 'User' };
      state.currentUser = meUser;

      await openModalWithMock(issue);

      const assigneeOptions = document.getElementById('assignee-options');
      const meOption = [...assigneeOptions.querySelectorAll('.custom-option')].find(o => o.textContent.includes('Me'));

      expect(meOption).toBeDefined();
      meOption.click();

      expect(document.getElementById('assignee-select').value).toBe('5');
    });

    it('should close modal on Done with no title changes', async () => {
      const issue = { id: 1, title: 'Original' };
      await openModalWithMock(issue);

      const titleInput = document.getElementById('title');
      titleInput.click(); // Enter editing (no changes)

      document.getElementById('done-btn').click();
      await new Promise(process.nextTick);

      expect(api.updateIssue).not.toHaveBeenCalled();
      expect(document.getElementById('issue-modal').classList.contains('hidden')).toBe(true);
    });

    it('should handle dropdown trigger click and options click', async () => {
      await openModalWithMock(null);
      const statusTrigger = document.getElementById('status-trigger');
      const statusOptions = document.getElementById('status-options');

      statusTrigger.click();
      expect(statusOptions.classList.contains('hidden')).toBe(false);

      statusTrigger.click(); // Close
      expect(statusOptions.classList.contains('hidden')).toBe(true);
    });
  });
});
