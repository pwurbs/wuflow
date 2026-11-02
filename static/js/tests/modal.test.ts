import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupModal, openModal, closeModal, preventNavigation } from '../components/modal.ts';
import { renderReleaseOptions } from '../components/issue-dropdowns.ts';
import * as api from '../api.ts';
import { state, setCurrentIssue } from '../state.ts';
import { byId } from '../utils.ts';
import * as utils from '../utils.ts';
import * as tasks from '../components/tasks.ts';
import * as activity from '../components/activity.ts';
import type { Issue, Task } from '../models.ts';
import type { IssueWrite } from '../api.ts';

type UpdateIssueResult = Awaited<ReturnType<typeof api.updateIssue>>;
import { makeIssue, makeLabel, makeProject, makeRelease, makeTask, makeUser, makeUserRef, savedIssue } from './fixtures.ts';

// Provide a localStorage stub for the jsdom environment used by vitest.
const _localStore: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (key: string) => _localStore[key] ?? null,
  setItem: (key: string, value: unknown) => { _localStore[key] = String(value); },
  removeItem: (key: string) => { delete _localStore[key]; },
});

// Mock dependencies
vi.mock('../api.ts', () => ({
  createIssue: vi.fn(),
  updateIssue: vi.fn().mockResolvedValue({ issue: {}, etag: '"test-etag"', conflict: false }),
  archiveIssue: vi.fn().mockResolvedValue({ id: 100, status: 'Archive' }),
  unarchiveIssue: vi.fn().mockResolvedValue({ id: 101, status: 'Done' }),
  moveIssue: vi.fn().mockResolvedValue({ issue: { id: 1, project_id: 2, label: null, release_id: null, status: 'Open' }, etag: '"move-etag"' }),
  createTask: vi.fn(),
  updateTaskPositions: vi.fn(),
  deleteIssue: vi.fn(),
  fetchLabelsByProject: vi.fn(),
  fetchReleases: vi.fn().mockResolvedValue([]),
  fetchStatusConfig: vi.fn().mockResolvedValue(null),
  fetchUsers: vi.fn(),
  fetchProjects: vi.fn(),
  fetchIssueById: vi.fn(),
  fetchHistory: vi.fn().mockResolvedValue([]),
  fetchComments: vi.fn().mockResolvedValue([])
}));

vi.mock('../state.ts', () => ({
  state: {
    issues: [],
    releases: [],
    labels: [],
    labelsProjectId: null,
    users: [],
    projects: [],
    currentIssue: null,
    currentUser: { role: 'admin' }
  },
  setCurrentIssue: vi.fn()
}));

vi.mock('../utils.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils.ts')>();
  return {
    byId: actual.byId,
    showNotification: vi.fn(),
    showConfirm: vi.fn(),
    updateDateInputStyle: vi.fn(),
    escapeHtml: vi.fn(s => s),
    canArchive: vi.fn().mockReturnValue({ allowed: true }),
    initCharCounter: vi.fn(() => ({ show: vi.fn(), hide: vi.fn() })),
    countCodepoints: vi.fn(s => [...s].length),
    getUserInitials: vi.fn(user => {
      if (!user) return '??';
      return ((user.first_name?.[0] || '') + (user.last_name?.[0] || '')).toUpperCase() || '??';
    }),
    getDeadlineStatus: vi.fn(() => ({ late: false })),
    getTaskDeadlineStatus: vi.fn(() => ({ late: false })),
    formatDateTime: vi.fn(dateStr => new Date(dateStr).toISOString()),
    // Default: immediately "confirms" with a fixed password by invoking the
    // caller's onConfirm, mirroring the real dialog's happy path. Override with
    // mockResolvedValue(false) to simulate cancellation.
    promptAdminPasswordConfirmation: vi.fn(async (title, message, onConfirm) => {
      await onConfirm('AdminPass123!');
      return true;
    }),
    // Real implementation — the list auto-continue tests assert on its actual behavior.
    continueListOnEnter: actual.continueListOnEnter,
    toDateInputValue: actual.toDateInputValue,
    guardSubmit: actual.guardSubmit,
    markBusy: actual.markBusy,
    setAriaDisabled: actual.setAriaDisabled,
    isErrorToastShown: actual.isErrorToastShown,
    onGuardedSubmit: actual.onGuardedSubmit,
    // Discards without asking; tests that need the question override it.
    confirmDiscard: vi.fn(async () => true)
  };
});

vi.mock('../markdown.ts', () => ({
  renderMarkdown: vi.fn(s => (s ? `<p>${s}</p>` : '')),
  renderMarkdownWithReport: vi.fn(s => ({
    html: s ? `<p>${s}</p>` : '',
    // Let tests mock strippedHTML by throwing something specific in the string, or just default to false
    strippedHTML: s?.includes('<script>') ?? false,
  })),
}));

vi.mock('../components/tasks.ts', () => ({
  renderTasks: vi.fn()
}));

// Real implementations, spied on so tests can reach the callbacks the modal passes in.
vi.mock('../components/activity.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/activity.ts')>();
  return {
    ...actual,
    loadActivity: vi.fn(actual.loadActivity),
    refreshHistory: vi.fn(actual.refreshHistory),
    getOpenCommentDraft: vi.fn(actual.getOpenCommentDraft),
  };
});

vi.mock('../drag.ts', () => ({
  getDragAfterTaskElement: vi.fn(),
  getDraggedTask: vi.fn(),
  setDraggedTask: vi.fn()
}));

// Helper function to open modal with proper mocking for existing issues
async function openModalWithMock(issue: Issue | null) {
  if (issue) {
    vi.mocked(api.fetchIssueById).mockResolvedValue({ issue, etag: '"test-etag"' });
  }
  await openModal(issue);
}

// A save of the open issue that the test answers by hand: answer(etag) lets the server answer
// with the sent fields as the saved issue. It may be called before the save is sent.
function answerByHand() {
  let answer: (etag: string) => void;
  const etag = new Promise<string>(r => { answer = r; });
  const save = async (_projectId: number, sent: IssueWrite & { id: number }): Promise<UpdateIssueResult> =>
    ({ issue: savedIssue(sent), etag: await etag, conflict: false });
  return { save, answer: (value: string) => answer(value) };
}

// Lets chained promise callbacks (save → state update → re-render) settle.
async function flush() {
  for (let i = 0; i < 5; i++) await new Promise(process.nextTick);
}

// jsdom never lays out content, so scrollHeight/clientHeight/scrollTop must be
// stubbed manually to simulate overflow states in the Scroll Cue tests below.
function setScrollMetrics(el: Element, { scrollHeight, clientHeight, scrollTop }: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
  Object.defineProperty(el, 'scrollTop', { value: scrollTop, configurable: true });
}

const rerenderViews = vi.fn();

describe('Modal Component', () => {
  beforeEach(() => {
    // Setup DOM
    document.body.innerHTML = `
      <div id="issue-modal" class="hidden">
        <div class="modal-content">
          <h2 id="modal-title"></h2>
          <form id="issue-form">
            <input id="issue-id" type="hidden">
            <div class="title-input-container">
              <input id="title" type="text" value="">
            </div>
            <div class="editor-container">
              <div class="md-editor-panes">
                <textarea id="description-editor"></textarea>
                <div id="description-preview" class="hidden"></div>
              </div>
              <div id="description-edit-actions" class="hidden">
                <button id="desc-cancel-btn" type="button"></button>
                <button id="desc-save-btn" type="button"></button>
              </div>
            </div>
            <div class="form-group"><div id="planned-dates-container"></div></div>
            <input id="deadline" type="date" class="custom-date-input">

            <!-- Custom Dropdowns -->
            <div class="form-group">
              <div id="status-dropdown">
                <div id="status-trigger" class="custom-select-trigger"><span id="status-text"></span></div>
                <div id="status-options" class="custom-select-options hidden"></div>
                <input type="hidden" id="status">
              </div>
            </div>
            <div class="form-group">
              <div id="priority-dropdown">
                <div id="priority-trigger" class="custom-select-trigger"><span id="priority-text"></span></div>
                <div id="priority-options" class="custom-select-options hidden"></div>
                <input type="hidden" id="priority">
              </div>
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
            <div id="project-dropdown">
              <button type="button" id="project-trigger" class="custom-select-trigger"><span id="project-text"></span></button>
              <div id="project-options" class="custom-select-options hidden"></div>
              <input type="hidden" id="project-select" value="1">
            </div>
            <div id="release-dropdown">
              <div id="release-trigger" class="custom-select-trigger"><span id="release-text"></span></div>
              <div id="release-options" class="custom-select-options hidden"></div>
              <input type="hidden" id="release-select">
            </div>

            <div class="modal-main-scroll">
              <div id="tasks-section">
                <div id="task-form-container">
                  <div class="input-group">
                    <input id="new-task-title" type="text">
                    <input id="new-task-deadline" type="date">
                    <button id="add-task-btn" type="button"></button>
                  </div>
                </div>
                <ul id="task-list"></ul>
              </div>
            </div>
            <button type="button" class="scroll-cue scroll-cue-down"></button>
            <button type="button" class="scroll-cue scroll-cue-up"></button>

            <button id="delete-issue-btn" type="button"></button>
            <button id="archive-issue-btn" type="button"></button>
            <button id="unarchive-issue-btn" type="button"></button>

            <button id="cancel-btn" type="button"></button>
            <button id="save-issue-btn" type="submit"></button>
            <button id="done-btn" type="button"></button>

            <!-- Editor toolbar btns for setup -->
            <button class="editor-btn" data-md="bold" data-prefix="**" data-suffix="**"></button>
            <button class="editor-btn" data-md="italic" data-prefix="*" data-suffix="*"></button>
            <button class="editor-btn" data-md="strike" data-prefix="~~" data-suffix="~~"></button>
            <button class="editor-btn" data-md="h1"></button>
            <button class="editor-btn" data-md="h2"></button>
            <button class="editor-btn" data-md="ul"></button>
            <button class="editor-btn" data-md="ol"></button>
            <button class="editor-btn" data-md="link"></button>
            <button class="editor-btn" data-md="code"></button>
            <button class="editor-btn" data-md="table"></button>
            <button id="md-preview-toggle" class="editor-btn">Preview</button>
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
    vi.mocked(api.fetchLabelsByProject).mockResolvedValue([makeLabel({ id: 1, name: 'Bug' }), makeLabel({ id: 2, name: 'Feature' })]);
    vi.mocked(api.fetchUsers).mockResolvedValue([makeUser({ id: 1, first_name: 'Test', last_name: 'User', active: true })]);
    vi.mocked(api.fetchProjects).mockResolvedValue([makeProject({ id: 1, name: 'default' })]);
    vi.mocked(api.updateIssue).mockImplementation(async (_projectId, sent) => ({ issue: savedIssue(sent), etag: '"updated-etag"', conflict: false }));
    state.currentIssue = null;
    state.currentUser = makeUser({ id: 100, role: 'admin' });
    state.labels = [];
    state.labelsProjectId = null;
    state.users = [];
    state.projects = [];
    vi.mocked(setCurrentIssue).mockImplementation((val) => { state.currentIssue = val; });

    HTMLElement.prototype.scrollIntoView = vi.fn();
    HTMLInputElement.prototype.reportValidity = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => { });

    // Initialize module
    setupModal(vi.fn(), rerenderViews);
  });
  it('should open modal for new issue', async () => {
    openModal(null);
    expect(document.getElementById('issue-modal').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('modal-title').textContent).toBe('New Issue');
    expect(document.getElementById('save-issue-btn').classList.contains('hidden')).toBe(false);
    expect(setCurrentIssue).toHaveBeenCalledWith(null);
  });

  it('should open modal for existing issue', async () => {
    const issue = makeIssue({
      id: 123,
      title: 'Test Issue',
      description: 'Test Desc',
      status: 'Stage1',
      priority: 'High',
      label: makeLabel({ id: 1, name: 'Bug' }),
      tasks: []
    });

    // Mock fetchIssueById to return this specific issue
    vi.mocked(api.fetchIssueById).mockResolvedValue({ issue, etag: '"test-etag"' });

    await openModal(issue);

    expect(document.getElementById('issue-modal').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('modal-title').textContent).toBe('Issue Details #123');
    expect(byId('title', HTMLInputElement).value).toBe('Test Issue');
    expect(byId('description-editor', HTMLTextAreaElement).value).toBe('Test Desc');
    expect(setCurrentIssue).toHaveBeenCalledWith(issue);
    expect(api.fetchLabelsByProject).toHaveBeenCalled(); // labels fetched to render options
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
    byId('title', HTMLInputElement).value = 'New Title';
    byId('description-editor', HTMLTextAreaElement).value = 'New Desc';
    byId('status', HTMLInputElement).value = 'Todo';
    byId('priority', HTMLInputElement).value = 'Normal';

    // Mock create response
    vi.mocked(api.createIssue).mockResolvedValue(makeIssue({ id: 99, title: 'New Title' }));

    // Trigger submit
    const form = document.getElementById('issue-form');
    form.dispatchEvent(new Event('submit'));

    // Wait for async
    await new Promise(process.nextTick);

    expect(api.createIssue).toHaveBeenCalledWith(1, expect.objectContaining({
      title: 'New Title',
      description: 'New Desc',
      status: 'Todo',
      priority: 'Normal'
    }));

    expect(document.getElementById('issue-modal').classList.contains('hidden')).toBe(true); // Should close
  });

  it('creates a new issue only once while the first submit is in flight, with the form greyed out', async () => {
    openModal(null);
    byId('title', HTMLInputElement).value = 'New Title';
    let resolveCreate: (issue: Issue) => void;
    vi.mocked(api.createIssue).mockReturnValue(new Promise(r => { resolveCreate = r; }));

    const form = document.getElementById('issue-form');
    form.dispatchEvent(new Event('submit'));
    expect(form.getAttribute('aria-busy')).toBe('true');
    // A second submit (e.g. Enter) must not create again.
    form.dispatchEvent(new Event('submit'));

    resolveCreate(makeIssue({ id: 99, title: 'New Title' }));
    await new Promise(process.nextTick);

    expect(api.createIssue).toHaveBeenCalledTimes(1);
    expect(form.hasAttribute('aria-busy')).toBe(false);
  });

  it('should update existing issue on status change (inline save)', async () => {
    const issue = makeIssue({ id: 1, title: 'Old', status: 'Open' });
    await openModalWithMock(issue);

    // Simulate status change
    const statusSelect = byId('status', HTMLInputElement);
    statusSelect.value = 'Done';
    statusSelect.dispatchEvent(new Event('change'));

    await new Promise(process.nextTick);

    expect(api.updateIssue).toHaveBeenCalledWith(1, expect.objectContaining({
      id: 1,
      status: 'Done'
    }), expect.any(String));
    expect(utils.showNotification).toHaveBeenCalled();
  });

  it('should handle task creation', async () => {
    const issue = makeIssue({ id: 1, project_id: 7, title: 'Task Parent', tasks: [] });
    await openModalWithMock(issue);

    byId('new-task-title', HTMLInputElement).value = 'Subtask 1';

    vi.mocked(api.createTask).mockResolvedValue(makeTask({ id: 101, title: 'Subtask 1', done: false }));
    const historyCallsBeforeAdd = vi.mocked(api.fetchHistory).mock.calls.length;

    // Click add
    document.getElementById('add-task-btn').click();

    await new Promise(process.nextTick);

    expect(api.createTask).toHaveBeenCalledWith(7, 1, expect.objectContaining({
      title: 'Subtask 1',
      issue_id: 1
    }));
    expect(tasks.renderTasks).toHaveBeenCalled();
    // Adding a task must refresh the History tab immediately, same as every
    // other task/field mutation, instead of only showing up on modal reopen.
    expect(vi.mocked(api.fetchHistory).mock.calls.length).toBeGreaterThan(historyCallsBeforeAdd);
  });

  it('creates a task only once while the first submit is in flight, with the task form greyed out', async () => {
    const issue = makeIssue({ id: 1, project_id: 7, title: 'Task Parent', tasks: [] });
    await openModalWithMock(issue);
    let resolveCreate: (task: Task) => void;
    vi.mocked(api.createTask).mockReturnValue(new Promise(r => { resolveCreate = r; }));

    const titleInput = byId('new-task-title', HTMLInputElement);
    const addBtn = document.getElementById('add-task-btn');
    const group = addBtn.closest('.input-group');
    titleInput.value = 'Subtask 1';
    addBtn.click();
    expect(group.getAttribute('aria-busy')).toBe('true');
    // Enter must not create again.
    titleInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', cancelable: true }));

    resolveCreate(makeTask({ id: 101, title: 'Subtask 1', done: false }));
    await new Promise(process.nextTick);

    expect(api.createTask).toHaveBeenCalledTimes(1);
    expect(group.hasAttribute('aria-busy')).toBe(false);
  });

  it('should delete issue after confirmation', async () => {
    const issue = makeIssue({ id: 99, title: 'To Delete' });
    await openModalWithMock(issue);

    document.getElementById('delete-issue-btn').click();
    await new Promise(process.nextTick);

    expect(utils.promptAdminPasswordConfirmation).toHaveBeenCalled();
    expect(api.deleteIssue).toHaveBeenCalledWith(1, 99, 'AdminPass123!');
    expect(document.getElementById('issue-modal').classList.contains('hidden')).toBe(true);
  });

  it('should archive issue after confirmation', async () => {
    const issue = makeIssue({ id: 100, title: 'To Archive', status: 'Open' });
    await openModalWithMock(issue);

    vi.mocked(utils.showConfirm).mockResolvedValue(true);

    document.getElementById('archive-issue-btn').click();
    await new Promise(process.nextTick);

    expect(utils.showConfirm).toHaveBeenCalled();
    expect(api.archiveIssue).toHaveBeenCalledWith(1, 100);
    expect(utils.showNotification).toHaveBeenCalledWith('Issue archived');
    expect(document.getElementById('issue-modal').classList.contains('hidden')).toBe(true);
  });
  it.each([
    ['archive', { status: 'Done' }, 'archiveIssue'],
    ['unarchive', { status: 'Archive' }, 'unarchiveIssue'],
  ] as const)('should let a queued field save finish before the %s closes the modal', async (action, fields, apiFn) => {
    const issue = makeIssue({ id: 100, title: 'Queued', priority: 'Normal', ...fields });
    await openModalWithMock(issue);
    vi.mocked(utils.canArchive).mockReturnValue({ allowed: true });
    vi.mocked(utils.showConfirm).mockResolvedValue(true);
    vi.mocked(api[apiFn]).mockResolvedValue(makeIssue({ id: 100 }));

    const resolveFieldSave = answerByHand();
    vi.mocked(api.updateIssue).mockImplementationOnce(resolveFieldSave.save);
    const prioritySelect = byId('priority', HTMLInputElement);
    prioritySelect.value = 'High';
    prioritySelect.dispatchEvent(new Event('change'));
    await new Promise(process.nextTick);

    document.getElementById(`${action}-issue-btn`).click();
    await new Promise(process.nextTick);
    expect(api[apiFn]).not.toHaveBeenCalled();

    resolveFieldSave.answer('"e2"');
    await new Promise(process.nextTick);
    await new Promise(process.nextTick);

    expect(api.updateIssue).toHaveBeenCalledWith(1, expect.objectContaining({ id: 100, priority: 'High' }), expect.any(String));
    expect(api[apiFn]).toHaveBeenCalledWith(1, 100);
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

    const dragModule = await import('../drag.ts');
    vi.mocked(dragModule.getDraggedTask).mockReturnValue(mockTask);
    vi.mocked(dragModule.getDragAfterTaskElement).mockReturnValue(null); // Append to end

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
    const option = Array.from(statusOptions.querySelectorAll<HTMLElement>('.custom-option')).find(c => c.textContent === 'Working');
    expect(option).toBeTruthy();

    option.click();

    const statusInput = byId('status', HTMLInputElement);
    const statusText = document.getElementById('status-text');

    expect(statusInput.value).toBe('Stage2');
    expect(statusText.textContent).toBe('Working');
    expect(statusOptions.classList.contains('hidden')).toBe(true);
  });

  it('should handle inline title editing keys', async () => {
    const issue = makeIssue({ id: 1, title: 'Original', status: 'Open' });
    await openModalWithMock(issue);

    const titleInput = byId('title', HTMLInputElement);
    // Enter edit mode
    titleInput.click();
    expect(titleInput.classList.contains('inline-editing')).toBe(true);

    // Change value
    titleInput.value = 'New Title';

    // Press Enter
    titleInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    await new Promise(process.nextTick);

    expect(api.updateIssue).toHaveBeenCalledWith(1, expect.objectContaining({
      title: 'New Title'
    }), expect.any(String));
    expect(titleInput.classList.contains('inline-editing')).toBe(false);
  });

  it('should update description preview on input', () => {
    openModal(null);
    const editor = byId('description-editor', HTMLTextAreaElement);
    const preview = document.getElementById('description-preview');

    editor.value = '**bold text**';
    editor.dispatchEvent(new InputEvent('input'));

    // renderMarkdown is mocked as s => `<p>${s}</p>`
    expect(preview.innerHTML).toBe('<p>**bold text**</p>');
  });

  it('should handle toolbar button click for basic styles', async () => {
    openModal(null);
    const editor = byId('description-editor', HTMLTextAreaElement);

    editor.value = 'hello';
    editor.selectionStart = 0;
    editor.selectionEnd = 5;

    const boldBtn = document.querySelector<HTMLButtonElement>('.editor-btn[data-md="bold"]');
    boldBtn.click();

    expect(editor.value).toBe('**hello**');
  });

  it('should handle toolbar button click for h1 and h2', async () => {
    openModal(null);
    const editor = byId('description-editor', HTMLTextAreaElement);

    // Test H1
    editor.value = 'heading';
    editor.selectionStart = 0;
    editor.selectionEnd = 7;
    const h1Btn = document.querySelector<HTMLElement>('.editor-btn[data-md="h1"]');
    h1Btn.click();
    expect(editor.value).toBe('# heading');

    // Test H2
    editor.value = 'heading';
    editor.selectionStart = 0;
    editor.selectionEnd = 7;
    const h2Btn = document.querySelector<HTMLElement>('.editor-btn[data-md="h2"]');
    h2Btn.click();
    expect(editor.value).toBe('## heading');
  });

  it('should handle toolbar button click for code inline vs block', async () => {
    openModal(null);
    const editor = byId('description-editor', HTMLTextAreaElement);
    const codeBtn = document.querySelector<HTMLElement>('.editor-btn[data-md="code"]');

    // Test inline code
    editor.value = 'let x = 1;';
    editor.selectionStart = 0;
    editor.selectionEnd = 10;
    codeBtn.click();
    expect(editor.value).toBe('`let x = 1;`');

    // Test code block
    editor.value = 'let x = 1;\nlet y = 2;';
    editor.selectionStart = 0;
    editor.selectionEnd = 21;
    codeBtn.click();
    expect(editor.value).toBe('```\nlet x = 1;\nlet y = 2;\n```');
  });

  it('should insert table template at start of empty editor', () => {
    openModal(null);
    const editor = byId('description-editor', HTMLTextAreaElement);
    const tableBtn = document.querySelector<HTMLElement>('.editor-btn[data-md="table"]');

    editor.value = '';
    editor.selectionStart = 0;
    editor.selectionEnd = 0;
    tableBtn.click();

    const expected = '| Header 1 | Header 2 | Header 3 |\n| --- | --- | --- |\n| Cell | Cell | Cell |\n';
    expect(editor.value).toBe(expected);
    // Cursor lands after "| " — position 2
    expect(editor.selectionStart).toBe(2);
    expect(editor.selectionEnd).toBe(2);
  });

  it('should prepend newline when inserting table after non-newline content', () => {
    openModal(null);
    const editor = byId('description-editor', HTMLTextAreaElement);
    const tableBtn = document.querySelector<HTMLElement>('.editor-btn[data-md="table"]');

    editor.value = 'existing text';
    editor.selectionStart = 13;
    editor.selectionEnd = 13;
    tableBtn.click();

    expect(editor.value).toBe('existing text\n| Header 1 | Header 2 | Header 3 |\n| --- | --- | --- |\n| Cell | Cell | Cell |\n');
    // Cursor lands after the injected "\n| " — offset 13 + 1 (prefix) + 2 = 16
    expect(editor.selectionStart).toBe(16);
  });

  it('should not prepend extra newline when cursor is already at a line start', () => {
    openModal(null);
    const editor = byId('description-editor', HTMLTextAreaElement);
    const tableBtn = document.querySelector<HTMLElement>('.editor-btn[data-md="table"]');

    editor.value = 'line one\n';
    editor.selectionStart = 9; // right after the \n
    editor.selectionEnd = 9;
    tableBtn.click();

    expect(editor.value).toBe('line one\n| Header 1 | Header 2 | Header 3 |\n| --- | --- | --- |\n| Cell | Cell | Cell |\n');
    // No extra newline prefix — cursor is 9 + 0 + 2 = 11
    expect(editor.selectionStart).toBe(11);
  });

  it('should update preview after inserting table', () => {
    openModal(null);
    const preview = document.getElementById('description-preview');
    const editor = byId('description-editor', HTMLTextAreaElement);
    const tableBtn = document.querySelector<HTMLElement>('.editor-btn[data-md="table"]');

    editor.value = '';
    editor.selectionStart = 0;
    editor.selectionEnd = 0;
    tableBtn.click();

    // renderMarkdown mock wraps input in <p>…</p>
    expect(preview.innerHTML).not.toBe('');
  });

  it('should toggle edit and preview modes and disable toolbar', () => {
    openModal(null);
    const editor = document.getElementById('description-editor');
    const preview = document.getElementById('description-preview');
    const toggleBtn = document.getElementById('md-preview-toggle');
    const boldBtn = document.querySelector<HTMLButtonElement>('.editor-btn[data-md="bold"]');

    // Initially in edit mode
    expect(preview.classList.contains('hidden')).toBe(true);
    expect(editor.classList.contains('hidden')).toBe(false);
    expect(toggleBtn.classList.contains('active')).toBe(false);
    expect(boldBtn.disabled).toBeFalsy();

    // Switch to preview mode
    toggleBtn.click();

    expect(preview.classList.contains('hidden')).toBe(false);
    expect(editor.classList.contains('hidden')).toBe(true);
    expect(toggleBtn.classList.contains('active')).toBe(true);
    expect(boldBtn.disabled).toBe(true);
    expect(boldBtn.classList.contains('disabled')).toBe(true);

    // Switch back to edit mode
    toggleBtn.click();

    expect(preview.classList.contains('hidden')).toBe(true);
    expect(editor.classList.contains('hidden')).toBe(false);
    expect(toggleBtn.classList.contains('active')).toBe(false);
    expect(boldBtn.disabled).toBe(false);
    expect(boldBtn.classList.contains('disabled')).toBe(false);
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
    setupModal(undefined, undefined);

    wrapper.click();
    expect(input.showPicker).toHaveBeenCalled();
  });

  describe('Helper Functions Coverage', () => {
    it('should render modal dropdowns with issue data', async () => {
      const issue = makeIssue({
        id: 1,
        status: 'Stage2',
        priority: 'High',
        label: makeLabel({ id: 2, name: 'Feature' })
      });

      await openModalWithMock(issue);

      expect(byId('status', HTMLInputElement).value).toBe('Stage2');
      expect(document.getElementById('status-text').textContent).toBe('Working');
      expect(byId('priority', HTMLInputElement).value).toBe('High');
      expect(document.getElementById('priority-text').textContent).toBe('High');
      expect(byId('label-select', HTMLInputElement).value).toBe('2');
      expect(document.getElementById('label-text').textContent).toBe('Feature');
    });

    it('should render modal dropdowns with defaults for new issue', async () => {
      openModal(null);

      await new Promise(process.nextTick);

      expect(byId('status', HTMLInputElement).value).toBe('Open');
      expect(document.getElementById('status-text').textContent).toBe('Open');
      expect(byId('priority', HTMLInputElement).value).toBe('Normal');
      expect(document.getElementById('priority-text').textContent).toBe('Normal');
      expect(byId('label-select', HTMLInputElement).value).toBe('');
      expect(document.getElementById('label-text').textContent).toBe('No Label');
    });

    it('should disable project trigger for RoleUser editing an existing issue', async () => {
      state.currentUser = makeUser({ id: 100, role: 'user' });
      const issue = makeIssue({ id: 1, status: 'Open', priority: 'Normal', label: null });
      await openModalWithMock(issue);
      expect(byId('project-trigger', HTMLButtonElement).disabled).toBe(true);
    });

    it('should enable project trigger for RoleAdmin editing an existing issue', async () => {
      state.currentUser = makeUser({ id: 100, role: 'admin' });
      const issue = makeIssue({ id: 1, status: 'Open', priority: 'Normal', label: null });
      await openModalWithMock(issue);
      expect(byId('project-trigger', HTMLButtonElement).disabled).toBe(false);
    });

    it('should setup edit modal button visibility', async () => {
      const issue = makeIssue({
        id: 5,
        title: 'Edit Test',
        description: 'Edit Desc',
        status: 'Todo',
        tasks: [],
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-16T15:30:00Z'
      });

      await openModalWithMock(issue);

      expect(document.getElementById('modal-title').textContent).toBe('Issue Details #5');
      expect(document.getElementById('delete-issue-btn').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('done-btn').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('save-issue-btn').classList.contains('hidden')).toBe(true);
      expect(document.getElementById('archive-issue-btn').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('unarchive-issue-btn').classList.contains('hidden')).toBe(true);
    });

    it('should show unarchive button when issue is already archived', async () => {
      const issue = makeIssue({
        id: 99,
        title: 'Archived',
        status: 'Archive',
        tasks: []
      });

      await openModalWithMock(issue);

      expect(document.getElementById('archive-issue-btn').classList.contains('hidden')).toBe(true);
      expect(document.getElementById('unarchive-issue-btn').classList.contains('hidden')).toBe(false);
    });

    it('should unarchive issue after confirmation', async () => {
      const issue = makeIssue({ id: 101, title: 'To Unarchive', status: 'Archive' });
      await openModalWithMock(issue);

      vi.mocked(utils.showConfirm).mockResolvedValue(true);

      document.getElementById('unarchive-issue-btn').click();
      await new Promise(process.nextTick);

      expect(utils.showConfirm).toHaveBeenCalled();
      expect(api.unarchiveIssue).toHaveBeenCalledWith(1, 101);
      expect(utils.showNotification).toHaveBeenCalledWith('Issue unarchived');
      expect(document.getElementById('issue-modal').classList.contains('hidden')).toBe(true);
    });

    it('should set read-only mode for archived issues', async () => {
      const issue = makeIssue({
        id: 102,
        title: 'Read Only',
        status: 'Archive',
        tasks: []
      });

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

      // Title and description are greyed out and never get the edit look
      expect(titleInput.classList.contains('read-only-text')).toBe(true);
      expect(titleInput.classList.contains('inline-editable')).toBe(false);
      expect(titleInput.getAttribute('aria-disabled')).toBe('true');
      expect(descContainer.classList.contains('read-only-text')).toBe(true);
      expect(descContainer.getAttribute('aria-disabled')).toBe('true');

      // Dates and dropdowns are inactive
      expect(document.getElementById('deadline').getAttribute('aria-disabled')).toBe('true');
      document.querySelectorAll<HTMLButtonElement>('.custom-select-trigger').forEach(trigger => expect(trigger.disabled).toBe(true));
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
      const issue = makeIssue({ id: 1, title: 'Test', status: 'Todo', tasks: [] });
      await openModalWithMock(issue);

      const titleInput = byId('title', HTMLInputElement);
      const descEditor = document.getElementById('description-editor');
      const descContainer = document.querySelector('.editor-container');

      expect(titleInput.classList.contains('inline-editable')).toBe(true);
      expect(titleInput.readOnly).toBe(true);
      expect(descContainer.classList.contains('inline-editable')).toBe(true);
      expect(descEditor.classList.contains('hidden')).toBe(true);
    });

    it('should toggle inline edit mode off', () => {
      openModal(null);

      const titleInput = byId('title', HTMLInputElement);
      const descEditor = document.getElementById('description-editor');
      const descContainer = document.querySelector('.editor-container');

      expect(titleInput.classList.contains('inline-editable')).toBe(false);
      expect(titleInput.readOnly).toBe(false);
      expect(descContainer.classList.contains('inline-editable')).toBe(false);
      expect(descEditor.classList.contains('hidden')).toBe(false);
    });

    it('should handle issue with null priority gracefully', async () => {
      const issue = makeIssue({
        id: 7,
        title: 'No Priority',
        status: 'Todo',
        priority: null,
        tasks: []
      });

      await openModalWithMock(issue);

      expect(byId('priority', HTMLInputElement).value).toBe('Normal');
      expect(document.getElementById('priority-text').textContent).toBe('Normal');
    });

    it('should handle issue with null label gracefully', async () => {
      const issue = makeIssue({
        id: 8,
        title: 'No Label',
        status: 'Todo',
        label: null,
        tasks: []
      });

      await openModalWithMock(issue);

      expect(byId('label-select', HTMLInputElement).value).toBe('');
      expect(document.getElementById('label-text').textContent).toBe('No Label');
    });

    it('should render tasks section for edit modal', async () => {
      const issue = makeIssue({
        id: 9,
        title: 'With Tasks',
        status: 'Todo',
        tasks: [makeTask({ id: 1, title: 'Task 1', done: false })]
      });

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
      const issue = makeIssue({
        id: 10,
        title: 'With Dates',
        status: 'Todo',
        tasks: [],
        planned_dates: ['2024-02-01'],
        deadline: '2024-02-15T12:00:00Z'
      });

      await openModalWithMock(issue);

      const container = document.getElementById('planned-dates-container');
      expect(container.querySelectorAll('.date-chip')).toHaveLength(1);
      expect(container.querySelector<HTMLElement>('.date-chip').dataset.date).toBe('2024-02-01');
      expect(byId('deadline', HTMLInputElement).value).toBe('2024-02-15');
      expect(utils.updateDateInputStyle).toHaveBeenCalled();
    });
  });

  describe('Sidebar Immediate Save', () => {
    it('should revert the priority control when the save fails', async () => {
      const issue = makeIssue({ id: 1, priority: 'Normal' });
      await openModalWithMock(issue);
      vi.mocked(api.updateIssue).mockRejectedValueOnce(new Error('Connection to the server failed'));

      const prioritySelect = byId('priority', HTMLInputElement);
      prioritySelect.value = 'High';
      prioritySelect.dispatchEvent(new Event('change'));
      await new Promise(process.nextTick);

      expect(utils.showNotification).toHaveBeenCalledWith('Connection to the server failed', 'error');
      expect(prioritySelect.value).toBe('Normal');
      expect(document.getElementById('priority-text').textContent).toBe('Normal');
    });

    it('should revert the status control when the save fails', async () => {
      const issue = makeIssue({ id: 1, status: 'Todo' });
      await openModalWithMock(issue);
      vi.mocked(api.updateIssue).mockRejectedValueOnce(new Error('offline'));

      const statusSelect = byId('status', HTMLInputElement);
      statusSelect.value = 'Done';
      statusSelect.dispatchEvent(new Event('change'));
      await new Promise(process.nextTick);

      expect(statusSelect.value).toBe('Todo');
    });

    it('should update priority immediately on change', async () => {
      const issue = makeIssue({ id: 1, priority: 'Normal' });
      await openModalWithMock(issue);

      const prioritySelect = byId('priority', HTMLInputElement);
      prioritySelect.value = 'High';
      prioritySelect.dispatchEvent(new Event('change'));

      await new Promise(process.nextTick);

      expect(api.updateIssue).toHaveBeenCalledWith(1, expect.objectContaining({
        id: 1,
        priority: 'High'
      }), expect.any(String));
    });

    // On a slow connection a second field change can start before the first save has
    // answered. Sent in parallel, both would carry the same ETag and the second would fail
    // with a false "modified by another user" conflict.
    it('sends overlapping field saves one after another, each with the ETag of the previous save', async () => {
      const issue = makeIssue({ id: 1, priority: 'Normal', status: 'Todo' });
      await openModalWithMock(issue);
      await flush();
      const answerFirst = answerByHand();
      vi.mocked(api.updateIssue).mockClear();
      vi.mocked(api.updateIssue)
        .mockImplementationOnce(answerFirst.save)
        .mockImplementationOnce(async (_projectId, sent) => ({ issue: savedIssue(sent), etag: '"etag-3"', conflict: false }));

      const prioritySelect = byId('priority', HTMLInputElement);
      prioritySelect.value = 'High';
      prioritySelect.dispatchEvent(new Event('change'));
      const statusSelect = byId('status', HTMLInputElement);
      statusSelect.value = 'Done';
      statusSelect.dispatchEvent(new Event('change'));
      await flush();
      expect(api.updateIssue).toHaveBeenCalledTimes(1);

      answerFirst.answer('"etag-2"');
      await flush();
      expect(api.updateIssue).toHaveBeenCalledTimes(2);
      expect(api.updateIssue).toHaveBeenLastCalledWith(1,
        expect.objectContaining({ priority: 'High', status: 'Done' }), '"etag-2"');
      expect(utils.showConfirm).not.toHaveBeenCalled();
      expect(state.currentIssue).toMatchObject({ priority: 'High', status: 'Done' });
    });

    it('keeps both dates when two planned dates are added before the first save answers', async () => {
      await openModalWithMock(makeIssue({ id: 1, planned_dates: [] }));
      await flush();
      const answerFirst = answerByHand();
      vi.mocked(api.updateIssue).mockClear();
      vi.mocked(api.updateIssue).mockImplementationOnce(answerFirst.save);

      const picker = byId('planned-date-picker', HTMLInputElement);
      picker.value = '2025-05-21';
      picker.dispatchEvent(new Event('change'));
      picker.value = '2025-05-20';
      picker.dispatchEvent(new Event('change'));
      await flush();
      answerFirst.answer('"etag-2"');
      await flush();

      expect(api.updateIssue).toHaveBeenLastCalledWith(1,
        expect.objectContaining({ planned_dates: ['2025-05-20', '2025-05-21'] }), '"etag-2"');
      expect(state.currentIssue.planned_dates).toEqual(['2025-05-20', '2025-05-21']);
    });

    it('drops a queued field save when another issue is opened before it runs', async () => {
      await openModalWithMock(makeIssue({ id: 1, priority: 'Normal', status: 'Todo' }));
      await flush();
      const answerFirst = answerByHand();
      vi.mocked(api.updateIssue).mockClear();
      vi.mocked(api.updateIssue).mockImplementationOnce(answerFirst.save);

      const prioritySelect = byId('priority', HTMLInputElement);
      prioritySelect.value = 'High';
      prioritySelect.dispatchEvent(new Event('change'));
      const statusSelect = byId('status', HTMLInputElement);
      statusSelect.value = 'Done';
      statusSelect.dispatchEvent(new Event('change')); // queued behind the priority save
      await flush();

      document.getElementById('cancel-btn').click();
      await openModalWithMock(makeIssue({ id: 2, priority: 'Normal', status: 'Todo' }));
      answerFirst.answer('"etag-2"');
      await flush();

      expect(api.updateIssue).toHaveBeenCalledTimes(1);
      expect(state.currentIssue).toMatchObject({ id: 2, status: 'Todo' });
    });

    it('should update planned_dates immediately on change via picker', async () => {
      const issue = makeIssue({ id: 1, planned_dates: [] });
      await openModalWithMock(issue);

      const picker = byId('planned-date-picker', HTMLInputElement);
      picker.value = '2025-01-01';
      picker.dispatchEvent(new Event('change'));

      await new Promise(process.nextTick);

      expect(api.updateIssue).toHaveBeenCalledWith(1, expect.objectContaining({
        id: 1,
        planned_dates: ['2025-01-01']
      }), expect.any(String));
    });

    it('should update deadline immediately on change', async () => {
      const issue = makeIssue({ id: 1 });
      await openModalWithMock(issue);

      const input = byId('deadline', HTMLInputElement);
      input.value = '2025-12-31';
      input.dispatchEvent(new Event('change'));

      await new Promise(process.nextTick);

      expect(api.updateIssue).toHaveBeenCalledWith(1, expect.objectContaining({
        id: 1,
        deadline: new Date('2025-12-31T12:00:00')
      }), expect.any(String));
    });

    it('should refresh task deadline styles when issue deadline changes', async () => {
      const issue = makeIssue({ id: 1 });
      await openModalWithMock(issue);

      // Seed a task item so refreshTaskDeadlineStyles' forEach has something to iterate.
      const taskList = document.getElementById('task-list');
      taskList.innerHTML = `
        <li class="task-item">
          <div class="task-deadline-container">
            <input class="task-deadline-input" value="2020-01-01">
            <span class="task-deadline-display"></span>
          </div>
        </li>
      `;

      const input = byId('deadline', HTMLInputElement);
      input.value = '2025-12-31';
      input.dispatchEvent(new Event('change'));

      await new Promise(process.nextTick);

      // The forEach reached the task item — its container's title is updated
      // by refreshTaskDeadlineStyles regardless of overdue status.
      const container = taskList.querySelector<HTMLElement>('.task-deadline-container');
      expect(container.title).toBeTruthy();
      expect(api.updateIssue).toHaveBeenCalled();
    });

    it('should update label immediately on change', async () => {
      const issue = makeIssue({ id: 1, label: null });
      await openModalWithMock(issue);

      const select = byId('label-select', HTMLInputElement);
      select.value = '2'; // ID 2
      select.dispatchEvent(new Event('change'));

      await new Promise(process.nextTick);

      expect(api.updateIssue).toHaveBeenCalledWith(1, expect.objectContaining({
        id: 1,
        label: { id: 2 }
      }), expect.any(String));
    });
  });

  describe('Unload Listeners', () => {
    it('should add unload listener when entering inline edit', async () => {
      const addSpy = vi.spyOn(globalThis, 'addEventListener');
      const issue = makeIssue({ id: 1, title: 'Test' });
      await openModalWithMock(issue);

      const titleInput = document.getElementById('title');
      titleInput.click();

      expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    });

    it('should remove unload listener when canceling edit', async () => {
      const removeSpy = vi.spyOn(globalThis, 'removeEventListener');
      const issue = makeIssue({ id: 1, title: 'Test' });
      await openModalWithMock(issue);

      const titleInput = document.getElementById('title');
      titleInput.click();

      titleInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(removeSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    });
  });

  describe('Scroll Cue', () => {
    it('is hidden when the content does not overflow', () => {
      const scrollEl = document.querySelector('.modal-main-scroll');
      const cue = document.querySelector('.scroll-cue-down');
      setScrollMetrics(scrollEl, { scrollHeight: 200, clientHeight: 200, scrollTop: 0 });

      scrollEl.dispatchEvent(new Event('scroll'));

      expect(cue.classList.contains('visible')).toBe(false);
    });

    it('becomes visible once there is more content below the fold', () => {
      const scrollEl = document.querySelector('.modal-main-scroll');
      const cue = document.querySelector('.scroll-cue-down');
      setScrollMetrics(scrollEl, { scrollHeight: 600, clientHeight: 200, scrollTop: 0 });

      scrollEl.dispatchEvent(new Event('scroll'));

      expect(cue.classList.contains('visible')).toBe(true);
    });

    it('hides again once scrolled down to the bottom', () => {
      const scrollEl = document.querySelector('.modal-main-scroll');
      const cue = document.querySelector('.scroll-cue-down');
      setScrollMetrics(scrollEl, { scrollHeight: 600, clientHeight: 200, scrollTop: 0 });
      scrollEl.dispatchEvent(new Event('scroll'));
      expect(cue.classList.contains('visible')).toBe(true);

      setScrollMetrics(scrollEl, { scrollHeight: 600, clientHeight: 200, scrollTop: 400 });
      scrollEl.dispatchEvent(new Event('scroll'));

      expect(cue.classList.contains('visible')).toBe(false);
    });

    it('re-evaluates when content is added dynamically (e.g. a loaded comment)', async () => {
      const scrollEl = document.querySelector('.modal-main-scroll');
      const cue = document.querySelector('.scroll-cue-down');
      setScrollMetrics(scrollEl, { scrollHeight: 200, clientHeight: 200, scrollTop: 0 });
      scrollEl.dispatchEvent(new Event('scroll'));
      expect(cue.classList.contains('visible')).toBe(false);

      setScrollMetrics(scrollEl, { scrollHeight: 600, clientHeight: 200, scrollTop: 0 });
      scrollEl.appendChild(document.createElement('div'));

      // MutationObserver callbacks run as a microtask.
      await Promise.resolve();

      expect(cue.classList.contains('visible')).toBe(true);
    });

    it('is a plain button so clicking it cannot submit the issue form', () => {
      const cue = document.querySelector<HTMLButtonElement>('.scroll-cue-down');

      expect(cue.tagName).toBe('BUTTON');
      expect(cue.type).toBe('button');
    });

    it('jumps to the bottom of the main column when clicked', () => {
      const scrollEl = document.querySelector('.modal-main-scroll');
      const cue = document.querySelector<HTMLButtonElement>('.scroll-cue-down');
      setScrollMetrics(scrollEl, { scrollHeight: 600, clientHeight: 200, scrollTop: 0 });
      // jsdom does not implement scrollTo.
      scrollEl.scrollTo = vi.fn();

      cue.click();

      expect(scrollEl.scrollTo).toHaveBeenCalledWith({ top: 600, behavior: 'smooth' });
    });

    it('top marker is hidden at the top and shown once scrolled down', () => {
      const scrollEl = document.querySelector('.modal-main-scroll');
      const up = document.querySelector('.scroll-cue-up');
      setScrollMetrics(scrollEl, { scrollHeight: 600, clientHeight: 200, scrollTop: 0 });
      scrollEl.dispatchEvent(new Event('scroll'));
      expect(up.classList.contains('visible')).toBe(false);

      setScrollMetrics(scrollEl, { scrollHeight: 600, clientHeight: 200, scrollTop: 150 });
      scrollEl.dispatchEvent(new Event('scroll'));
      expect(up.classList.contains('visible')).toBe(true);
    });

    it('top marker is a plain button and jumps to the top of the main column when clicked', () => {
      const scrollEl = document.querySelector('.modal-main-scroll');
      const up = document.querySelector<HTMLButtonElement>('.scroll-cue-up');
      setScrollMetrics(scrollEl, { scrollHeight: 600, clientHeight: 200, scrollTop: 400 });
      scrollEl.scrollTo = vi.fn();

      up.click();

      expect(up.type).toBe('button');
      expect(scrollEl.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    });

    it('both markers can be visible at the same time in the middle of a long issue', () => {
      const scrollEl = document.querySelector('.modal-main-scroll');
      setScrollMetrics(scrollEl, { scrollHeight: 600, clientHeight: 200, scrollTop: 150 });

      scrollEl.dispatchEvent(new Event('scroll'));

      expect(document.querySelector('.scroll-cue-up').classList.contains('visible')).toBe(true);
      expect(document.querySelector('.scroll-cue-down').classList.contains('visible')).toBe(true);
    });

    it('opening an issue starts at the top, not where the previous issue was left', async () => {
      const scrollEl = document.querySelector('.modal-main-scroll');
      scrollEl.scrollTop = 300;

      await openModalWithMock(makeIssue({ id: 2, title: 'Another long issue' }));

      expect(scrollEl.scrollTop).toBe(0);
    });
  });

  describe('Inline Editing Features', () => {
    it('should cancel inline title edit on Escape key', async () => {
      const issue = makeIssue({ id: 1, title: 'Original' });
      await openModalWithMock(issue);

      const titleInput = byId('title', HTMLInputElement);
      titleInput.click(); // Enter edit
      titleInput.value = 'Changed';

      titleInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(titleInput.value).toBe('Original');
      expect(titleInput.readOnly).toBe(true);
    });

    it('should revert to original on empty title blur', async () => {
      const issue = makeIssue({ id: 1, title: 'Original' });
      await openModalWithMock(issue);

      const titleInput = byId('title', HTMLInputElement);
      titleInput.click();
      titleInput.value = ''; // Clear title

      titleInput.dispatchEvent(new Event('blur'));

      await new Promise(process.nextTick);

      expect(titleInput.value).toBe('Original'); // Reverted
      expect(api.updateIssue).not.toHaveBeenCalled();
      expect(titleInput.classList.contains('inline-editing')).toBe(false);
    });

    it('should revert title and close modal on Done with empty title', async () => {
      const issue = makeIssue({ id: 1, title: 'Original' });
      await openModalWithMock(issue);
      const titleInput = byId('title', HTMLInputElement);
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
      const issue = makeIssue({ id: 1, title: 'Original' });
      await openModalWithMock(issue);

      const titleInput = byId('title', HTMLInputElement);
      titleInput.click();
      titleInput.value = 'Saved Title';

      titleInput.dispatchEvent(new Event('blur'));

      await new Promise(process.nextTick);

      expect(api.updateIssue).toHaveBeenCalledWith(1, expect.objectContaining({
        title: 'Saved Title'
      }), expect.any(String));
      expect(titleInput.readOnly).toBe(true);
    });

    it('should auto-save title on Done click with changes', async () => {
      const issue = makeIssue({ id: 1, title: 'Original' });
      await openModalWithMock(issue);

      const titleInput = byId('title', HTMLInputElement);
      titleInput.click();
      titleInput.value = 'Changed';

      const doneBtn = document.getElementById('done-btn');
      doneBtn.click();

      await new Promise(process.nextTick);

      expect(utils.showConfirm).not.toHaveBeenCalled();
      expect(api.updateIssue).toHaveBeenCalledWith(1, expect.objectContaining({
        title: 'Changed'
      }), expect.any(String));
    });

    describe('Done toast', () => {
      let toast: HTMLDivElement;
      beforeEach(() => {
        toast = document.createElement('div');
        toast.id = 'notification-toast';
        toast.className = 'notification-toast hidden';
        document.body.appendChild(toast);
        vi.mocked(utils.showNotification).mockImplementation((message, type = 'success') => {
          toast.textContent = message;
          toast.className = 'notification-toast ' + type;
        });
      });
      afterEach(() => {
        toast.remove();
        vi.mocked(utils.showNotification).mockImplementation(() => {});
      });

      async function saveTitleWithDone(typed: string, saved: string) {
        await openModalWithMock(makeIssue({ id: 1, title: 'Old' }));
        await flush();
        vi.mocked(api.updateIssue).mockResolvedValueOnce({ issue: makeIssue({ id: 1, title: saved }), etag: '"e2"', conflict: false });
        const title = byId('title', HTMLInputElement);
        title.click();
        title.value = typed;
        document.getElementById('done-btn').click();
        await flush();
      }

      it('keeps the warning that HTML was removed from the title instead of showing "Issue updated"', async () => {
        await saveTitleWithDone('Clean<b>', 'Clean');

        expect(toast.textContent).toBe('Unsupported HTML tags are not rendered for security.');
        expect(utils.showNotification).not.toHaveBeenCalledWith('Issue updated');
      });

      it('shows "Issue updated" after a save without a warning', async () => {
        await saveTitleWithDone('Clean', 'Clean');

        expect(toast.textContent).toBe('Issue updated');
      });
    });

    it('should prompt save on done button click with description changes - save path', async () => {
      const issue = makeIssue({ id: 1, description: 'Original' });
      await openModalWithMock(issue);

      // Enter description edit mode by clicking the preview
      const descEditor = byId('description-editor', HTMLTextAreaElement);
      const descPreview = document.getElementById('description-preview');
      descPreview.click();
      descEditor.value = 'Changed Desc';

      vi.mocked(utils.showConfirm).mockResolvedValue(true);

      const doneBtn = document.getElementById('done-btn');
      doneBtn.click();

      await new Promise(process.nextTick);

      expect(utils.showConfirm).toHaveBeenCalled();

      await new Promise(process.nextTick);
      expect(api.updateIssue).toHaveBeenCalledWith(1, expect.objectContaining({
        description: 'Changed Desc'
      }), expect.any(String));
    });

    it('should keep the modal and the description open on Done when the description save fails', async () => {
      const issue = makeIssue({ id: 1, title: 'T', description: 'Old Desc' });
      await openModalWithMock(issue);
      vi.mocked(api.updateIssue).mockRejectedValueOnce(new Error('Connection to the server failed'));

      document.getElementById('description-preview').click();
      const descEditor = byId('description-editor', HTMLTextAreaElement);
      descEditor.value = 'Typed while offline';
      vi.mocked(utils.showConfirm).mockResolvedValue(true);

      document.getElementById('done-btn').click();
      await flush();

      expect(utils.showNotification).toHaveBeenCalledWith('Connection to the server failed', 'error');
      expect(document.getElementById('issue-modal').classList.contains('hidden')).toBe(false);
      expect(document.querySelector('.editor-container').classList.contains('inline-editing')).toBe(true);
      expect(descEditor.value).toBe('Typed while offline');
    });

    it('should keep the modal and the title open on Done when the title save fails', async () => {
      await openModalWithMock(makeIssue({ id: 1, title: 'Original' }));
      vi.mocked(api.updateIssue).mockRejectedValueOnce(new Error('Connection to the server failed'));

      const titleInput = byId('title', HTMLInputElement);
      titleInput.click();
      titleInput.value = 'Typed while offline';

      document.getElementById('done-btn').click();
      await flush();

      expect(utils.showNotification).toHaveBeenCalledWith('Connection to the server failed', 'error');
      expect(document.getElementById('issue-modal').classList.contains('hidden')).toBe(false);
      expect(titleInput.classList.contains('inline-editing')).toBe(true);
      expect(titleInput.value).toBe('Typed while offline');
    });

    it('should close on Done without asking when the open description is unchanged', async () => {
      await openModalWithMock(makeIssue({ id: 1, title: 'T', description: 'Desc' }));
      document.getElementById('description-preview').click();

      document.getElementById('done-btn').click();
      await flush();

      expect(utils.showConfirm).not.toHaveBeenCalled();
      expect(api.updateIssue).not.toHaveBeenCalled();
      expect(document.getElementById('issue-modal').classList.contains('hidden')).toBe(true);
    });

    it('should discard the description edit and close on Done when the user chooses Discard', async () => {
      await openModalWithMock(makeIssue({ id: 1, title: 'T', description: 'Desc' }));
      document.getElementById('description-preview').click();
      const descEditor = byId('description-editor', HTMLTextAreaElement);
      descEditor.value = 'Changed';
      vi.mocked(utils.showConfirm).mockResolvedValueOnce(false);

      document.getElementById('done-btn').click();
      await flush();

      expect(api.updateIssue).not.toHaveBeenCalled();
      expect(descEditor.value).toBe('Desc');
      expect(document.getElementById('issue-modal').classList.contains('hidden')).toBe(true);
    });

    it('should auto-save title on Enter key', async () => {
      const issue = makeIssue({ id: 1, title: 'Original' });
      await openModalWithMock(issue);

      const titleInput = byId('title', HTMLInputElement);
      titleInput.click();
      titleInput.value = 'Changed';

      titleInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      await new Promise(process.nextTick);

      expect(api.updateIssue).toHaveBeenCalledWith(1, expect.objectContaining({
        title: 'Changed'
      }), expect.any(String));
      expect(titleInput.readOnly).toBe(true);
    });

    it('should send only one title save when blur fires while the Enter save is still pending', async () => {
      const issue = makeIssue({ id: 1, title: 'Original' });
      await openModalWithMock(issue);
      const resolveUpdate = answerByHand();
      vi.mocked(api.updateIssue).mockImplementationOnce(resolveUpdate.save);

      const titleInput = byId('title', HTMLInputElement);
      titleInput.click();
      titleInput.value = 'Changed';
      titleInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      // e.g. the re-login dialog takes focus while the first save waits
      titleInput.dispatchEvent(new FocusEvent('blur'));

      resolveUpdate.answer('"v2"');
      await flush();

      expect(api.updateIssue).toHaveBeenCalledTimes(1);
      expect(titleInput.readOnly).toBe(true);
    });

    it('should NOT call updateIssue and close modal when Done clicked with no changes', async () => {
      const issue = makeIssue({ id: 1, title: 'Original', description: 'Desc' });
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
      const issue = makeIssue({ id: 1, description: 'Desc' });
      await openModalWithMock(issue);

      const descContainer = document.querySelector('.editor-container');
      const descEditor = document.getElementById('description-editor');
      const descPreview = document.getElementById('description-preview');

      descPreview.click();

      expect(descContainer.classList.contains('inline-editing')).toBe(true);
      expect(descEditor.classList.contains('hidden')).toBe(false);
    });

    it('should open link in new tab when clicked in description', async () => {
      const issue = makeIssue({ id: 1, description: '<a href="https://example.com" id="test-link">Link</a>' });
      await openModalWithMock(issue);

      const link = document.getElementById('test-link');

      // Mock globalThis.open
      const openSpy = vi.spyOn(globalThis, 'open').mockImplementation(() => null);

      // Simulate click on the link
      link.click();

      expect(openSpy).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener,noreferrer');
      openSpy.mockRestore();
    });
  });
  describe('Instant render and background revalidation', () => {
    // A promise the test resolves by hand, to control when GET /issues/{id} "returns".
    const deferred = () => {
      let resolve: (value: Awaited<ReturnType<typeof api.fetchIssueById>>) => void;
      const promise = new Promise<Awaited<ReturnType<typeof api.fetchIssueById>>>(r => { resolve = r; });
      return { promise, resolve };
    };
    const changePriority = (value: string) => {
      const prioritySelect = byId('priority', HTMLInputElement);
      prioritySelect.value = value;
      prioritySelect.dispatchEvent(new Event('change'));
    };
    const baseIssue = () => makeIssue({
      id: 5, project_id: 1, title: 'From Board', description: 'Board desc',
      status: 'Stage1', priority: 'Normal', tasks: [], updated_at: '2026-10-08T10:00:00Z'
    });

    it('renders the passed issue before the fetch resolves', () => {
      vi.mocked(api.fetchIssueById).mockReturnValue(new Promise(() => {}));

      openModal(baseIssue());

      expect(byId('title', HTMLInputElement).value).toBe('From Board');
      expect(byId('description-editor', HTMLTextAreaElement).value).toBe('Board desc');
      expect(document.getElementById('modal-title').textContent).toBe('Issue Details #5');
    });

    it('does not mutate the caller\'s issue object', () => {
      vi.mocked(api.fetchIssueById).mockReturnValue(new Promise(() => {}));
      const issue = baseIssue();

      openModal(issue);

      expect(state.currentIssue).not.toBe(issue);
      expect(state.currentIssue).toEqual(issue);
    });

    it('keeps the rendered data and only stores the ETag when updated_at is unchanged', async () => {
      const issue = baseIssue();
      vi.mocked(api.fetchIssueById).mockResolvedValue({ issue: { ...issue }, etag: '"fresh-etag"' });

      openModal(issue);
      await flush();

      expect(setCurrentIssue).toHaveBeenCalledTimes(1);
      changePriority('High');
      await flush();
      expect(api.updateIssue).toHaveBeenCalledWith(1, expect.objectContaining({ priority: 'High' }), '"fresh-etag"');
    });

    it('re-renders with the server copy when it is newer and the user is not editing', async () => {
      const issue = baseIssue();
      vi.mocked(api.fetchIssueById).mockResolvedValue({
        issue: makeIssue({ ...issue, title: 'Changed Elsewhere', updated_at: '2026-10-08T11:00:00Z' }),
        etag: '"newer-etag"'
      });

      openModal(issue);
      await flush();

      expect(byId('title', HTMLInputElement).value).toBe('Changed Elsewhere');
      expect(state.currentIssue.title).toBe('Changed Elsewhere');

      changePriority('High');
      await flush();
      expect(api.updateIssue).toHaveBeenCalledWith(1, expect.objectContaining({ title: 'Changed Elsewhere' }), '"newer-etag"');
    });

    it('keeps in-progress input and forces a conflict on save when a newer copy arrives during editing', async () => {
      const load = deferred();
      vi.mocked(api.fetchIssueById).mockReturnValue(load.promise);
      vi.mocked(api.updateIssue, { partial: true }).mockResolvedValue({ conflict: true });
      vi.mocked(utils.showConfirm).mockResolvedValue(false);

      openModal(baseIssue());
      const titleInput = byId('title', HTMLInputElement);
      titleInput.click(); // enter inline title editing
      titleInput.value = 'My Edit';

      load.resolve({ issue: makeIssue({ ...baseIssue(), title: 'Changed Elsewhere', updated_at: '2026-10-08T11:00:00Z' }), etag: '"newer-etag"' });
      await flush();

      expect(titleInput.value).toBe('My Edit');

      changePriority('High');
      await flush();
      expect(api.updateIssue).toHaveBeenCalledWith(1, expect.any(Object), '"stale"');
      expect(utils.showConfirm).toHaveBeenCalledWith('Conflict Detected', expect.any(String), 'Reload', 'Cancel', 'primary');
    });

    it('waits for the revalidation before saving and sends the fetched ETag', async () => {
      const load = deferred();
      vi.mocked(api.fetchIssueById).mockReturnValue(load.promise);

      openModal(baseIssue());
      changePriority('High');
      await flush();
      expect(api.updateIssue).not.toHaveBeenCalled();

      load.resolve({ issue: baseIssue(), etag: '"fresh-etag"' });
      await flush();
      expect(api.updateIssue).toHaveBeenCalledWith(1, expect.objectContaining({ priority: 'High' }), '"fresh-etag"');
    });

    it('forces a conflict for a save started before the revalidation replaced the issue', async () => {
      const load = deferred();
      vi.mocked(api.fetchIssueById).mockReturnValue(load.promise);
      vi.mocked(api.updateIssue, { partial: true }).mockResolvedValue({ conflict: true });
      vi.mocked(utils.showConfirm).mockResolvedValue(false);

      openModal(baseIssue());
      changePriority('High');
      load.resolve({ issue: makeIssue({ ...baseIssue(), updated_at: '2026-10-08T11:00:00Z' }), etag: '"newer-etag"' });
      await flush();

      expect(api.updateIssue).toHaveBeenCalledWith(1, expect.any(Object), '"stale"');
    });

    it('ignores a late response for a previously opened issue', async () => {
      const loadA = deferred();
      vi.mocked(api.fetchIssueById).mockReturnValueOnce(loadA.promise);
      openModal(makeIssue({ ...baseIssue(), id: 5, title: 'Issue A' }));

      vi.mocked(api.fetchIssueById).mockResolvedValueOnce({ issue: makeIssue({ ...baseIssue(), id: 6, title: 'Issue B' }), etag: '"b"' });
      openModal(makeIssue({ ...baseIssue(), id: 6, title: 'Issue B' }));
      await flush();

      loadA.resolve({ issue: null, etag: null });
      await flush();

      expect(utils.showNotification).not.toHaveBeenCalledWith('Issue not found or was deleted', 'error');
      expect(document.getElementById('issue-modal').classList.contains('hidden')).toBe(false);
      expect(byId('title', HTMLInputElement).value).toBe('Issue B');
    });

    it('ignores a late response after the modal was closed', async () => {
      const load = deferred();
      vi.mocked(api.fetchIssueById).mockReturnValue(load.promise);

      openModal(baseIssue());
      closeModal();
      load.resolve({ issue: null, etag: null });
      await flush();

      expect(utils.showNotification).not.toHaveBeenCalledWith('Issue not found or was deleted', 'error');
    });

    it('renders dropdown options from cached state without refetching', () => {
      vi.mocked(api.fetchIssueById).mockReturnValue(new Promise(() => {}));
      state.labels = [makeLabel({ id: 3, name: 'Cached Label' })];
      state.labelsProjectId = 1;
      state.users = [makeUser({ id: 1, first_name: 'Cached', last_name: 'User', active: true })];
      state.projects = [makeProject({ id: 1, name: 'default' })];

      openModal(baseIssue());

      expect(api.fetchLabelsByProject).not.toHaveBeenCalled();
      expect(api.fetchUsers).not.toHaveBeenCalled();
      expect(api.fetchProjects).not.toHaveBeenCalled();
      expect(document.getElementById('label-options').textContent).toContain('Cached Label');
      expect(document.getElementById('assignee-options').textContent).toContain('Cached User');
    });

    it('fetches labels for an issue from a project other than the cached one', () => {
      vi.mocked(api.fetchIssueById).mockReturnValue(new Promise(() => {}));
      state.labels = [makeLabel({ id: 3, name: 'Cached Label' })];
      state.labelsProjectId = 1;

      openModal(makeIssue({ ...baseIssue(), project_id: 8 }));

      expect(api.fetchLabelsByProject).toHaveBeenCalledWith(8);
    });
  });

  describe('Multi-Day Date Management', () => {
    it('should add a date via the picker in existing issue mode', async () => {
      const issue = makeIssue({ id: 1, planned_dates: [] });
      await openModalWithMock(issue);

      const picker = byId('planned-date-picker', HTMLInputElement);
      picker.value = '2025-05-20';
      picker.dispatchEvent(new Event('change'));

      await new Promise(process.nextTick);

      // The modal works on a copy of the passed issue (state.currentIssue)
      expect(state.currentIssue.planned_dates).toContain('2025-05-20');
      expect(api.updateIssue).toHaveBeenCalled();

      const container = document.getElementById('planned-dates-container');
      expect(container.querySelectorAll('.date-chip')).toHaveLength(1);
    });

    it('should remove a date via chip in existing issue mode', async () => {
      const issue = makeIssue({ id: 1, planned_dates: ['2025-05-20'] });
      await openModalWithMock(issue);

      const container = document.getElementById('planned-dates-container');
      const chip = container.querySelector('.date-chip');
      const removeBtn = chip.querySelector<HTMLElement>('.remove');

      await removeBtn.click();
      await new Promise(process.nextTick);

      expect(state.currentIssue.planned_dates).not.toContain('2025-05-20');
      expect(api.updateIssue).toHaveBeenCalled();
      expect(container.querySelectorAll('.date-chip')).toHaveLength(0);
    });

    it('should add/remove dates in New Issue mode (state-less)', async () => {
      openModal(null);

      const picker = byId('planned-date-picker', HTMLInputElement);
      picker.value = '2025-06-01';
      picker.dispatchEvent(new Event('change'));

      const container = document.getElementById('planned-dates-container');
      expect(container.querySelectorAll('.date-chip')).toHaveLength(1);

      const chip = container.querySelector<HTMLElement>('.date-chip');
      expect(chip.dataset.date).toBe('2025-06-01');

      const removeBtn = chip.querySelector<HTMLElement>('.remove');
      await removeBtn.click();

      expect(container.querySelectorAll('.date-chip')).toHaveLength(0);
      expect(api.updateIssue).not.toHaveBeenCalled();
    });
  });

  describe('Conflict Handling', () => {
    it('should show conflict dialog when updateIssue returns conflict', async () => {
      const issue = makeIssue({ id: 1, title: 'Original', status: 'Todo' });
      await openModalWithMock(issue);

      // Mock updateIssue to return conflict
      vi.mocked(api.updateIssue).mockResolvedValue({ issue: null, etag: null, conflict: true });

      // Mock showConfirm to simulate user clicking Reload
      vi.mocked(utils.showConfirm).mockResolvedValue(true);

      // Trigger a save (e.g., change status)
      const statusSelect = byId('status', HTMLInputElement);
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
      expect(api.fetchIssueById).toHaveBeenCalledWith(1, 1);
      expect(utils.showNotification).toHaveBeenCalledWith('Reloaded with latest data');
    });

    it('should keep the modal open when a form submit hits a conflict, without a second save', async () => {
      const issue = makeIssue({ id: 1, title: 'Old', status: 'Todo' });
      await openModalWithMock(issue);
      byId('title', HTMLInputElement).value = 'Old';
      byId('status', HTMLInputElement).value = 'Todo';

      vi.mocked(api.updateIssue).mockReset();
      vi.mocked(api.updateIssue).mockResolvedValue({ issue: null, etag: null, conflict: true });
      vi.mocked(utils.showConfirm).mockResolvedValue(false); // User keeps the current data

      document.getElementById('issue-form').dispatchEvent(new Event('submit'));
      await new Promise(process.nextTick);
      await new Promise(process.nextTick);

      expect(api.updateIssue).toHaveBeenCalledTimes(1);
      expect(utils.showConfirm).toHaveBeenCalledWith('Conflict Detected', expect.any(String), 'Reload', 'Cancel', 'primary');
      expect(document.getElementById('issue-modal').classList.contains('hidden')).toBe(false);
    });

    it('should queue a form submit behind a pending field save and send it with that save\'s ETag', async () => {
      const issue = makeIssue({ id: 1, title: 'Old', status: 'Todo', priority: 'Normal' });
      await openModalWithMock(issue);
      byId('title', HTMLInputElement).value = 'Old';

      const resolveFieldSave = answerByHand();
      vi.mocked(api.updateIssue).mockReset();
      vi.mocked(api.updateIssue)
        .mockImplementationOnce(resolveFieldSave.save)
        .mockResolvedValueOnce({ issue: makeIssue({ id: 1 }), etag: '"after-submit"', conflict: false });

      const prioritySelect = byId('priority', HTMLInputElement);
      prioritySelect.value = 'High';
      prioritySelect.dispatchEvent(new Event('change'));
      await new Promise(process.nextTick);
      document.getElementById('issue-form').dispatchEvent(new Event('submit'));
      await new Promise(process.nextTick);

      expect(api.updateIssue).toHaveBeenCalledTimes(1); // the submit waits for the field save

      resolveFieldSave.answer('"after-field-save"');
      await new Promise(process.nextTick);
      await new Promise(process.nextTick);

      expect(api.updateIssue).toHaveBeenCalledTimes(2);
      expect(vi.mocked(api.updateIssue).mock.calls[1][2]).toBe('"after-field-save"');
      expect(document.getElementById('issue-modal').classList.contains('hidden')).toBe(true);
    });

    it('should keep modal open when user cancels conflict reload', async () => {
      const issue = makeIssue({ id: 1, title: 'Original', status: 'Todo' });
      await openModalWithMock(issue);

      vi.mocked(api.updateIssue).mockResolvedValue({ issue: null, etag: null, conflict: true });
      vi.mocked(utils.showConfirm).mockResolvedValue(false); // User cancels

      const statusSelect = byId('status', HTMLInputElement);
      statusSelect.value = 'Done';
      statusSelect.dispatchEvent(new Event('change'));

      await new Promise(process.nextTick);

      expect(utils.showConfirm).toHaveBeenCalled();
      // Modal stays open when user cancels
      expect(document.getElementById('issue-modal').classList.contains('hidden')).toBe(false);
    });
  });

  describe('Additional Coverage Improvements', () => {
    it('should handle link click in description editor in read-only mode', async () => {
      const issue = makeIssue({ id: 1, description: '<a id="test-link" href="https://example.com">Link</a>' });
      await openModalWithMock(issue);

      const descPreview = document.getElementById('description-preview');
      const link = descPreview.querySelector('a'); // link is rendered into the preview pane
      const openSpy = vi.spyOn(globalThis, 'open').mockImplementation(() => null);

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
      const issue = makeIssue({ id: 1, assignee_id: null });
      await openModalWithMock(issue);

      const assigneeSelect = byId('assignee-select', HTMLInputElement);
      assigneeSelect.value = '1';
      assigneeSelect.dispatchEvent(new Event('change'));

      await new Promise(process.nextTick);

      expect(api.updateIssue).toHaveBeenCalledWith(1, expect.objectContaining({
        assignee_id: 1
      }), expect.any(String));
      expect(api.fetchIssueById).toHaveBeenCalled();
    });

    it('should await the editing task save on Done click and close on success', async () => {
      const issue = makeIssue({ id: 1, tasks: [makeTask({ id: 101, title: 'Task 1' })] });
      const saveTask = vi.fn().mockResolvedValue(true);
      // Simulate a task entering edit mode: renderTasks hands its save() to the modal
      vi.mocked(tasks.renderTasks).mockImplementation((_taskList, container, _issue, callbacks) => {
        container.innerHTML = '<li class="task-item editing" data-id="101"><input class="task-title-input" value="Changed Task"></li>';
        callbacks.onTaskEditStart(saveTask);
      });
      await openModalWithMock(issue);

      document.getElementById('done-btn').click();
      await new Promise(process.nextTick);

      expect(utils.showConfirm).not.toHaveBeenCalled();
      expect(saveTask).toHaveBeenCalled();
      expect(document.getElementById('issue-modal').classList.contains('hidden')).toBe(true);
      vi.mocked(tasks.renderTasks).mockReset();
    });

    it('should keep the modal open on Done when the editing task save fails', async () => {
      const issue = makeIssue({ id: 1, tasks: [makeTask({ id: 101, title: 'Task 1' })] });
      const saveTask = vi.fn().mockResolvedValue(false);
      vi.mocked(tasks.renderTasks).mockImplementation((_taskList, container, _issue, callbacks) => {
        container.innerHTML = '<li class="task-item editing" data-id="101"><input class="task-title-input" value="Changed Task"></li>';
        callbacks.onTaskEditStart(saveTask);
      });
      await openModalWithMock(issue);

      document.getElementById('done-btn').click();
      await new Promise(process.nextTick);

      expect(saveTask).toHaveBeenCalled();
      expect(document.getElementById('issue-modal').classList.contains('hidden')).toBe(false);
      vi.mocked(tasks.renderTasks).mockReset();
    });

    it('should not save a task on Done once its edit mode has ended', async () => {
      const removeSpy = vi.spyOn(globalThis, 'removeEventListener');
      const saveTask = vi.fn().mockResolvedValue(true);
      vi.mocked(tasks.renderTasks).mockImplementation((_taskList, _container, _issue, callbacks) => {
        callbacks.onTaskEditStart(saveTask);
        callbacks.onTaskEditEnd();
      });
      await openModalWithMock(makeIssue({ id: 1, tasks: [makeTask({ id: 101, title: 'Task 1' })] }));

      expect(removeSpy).toHaveBeenCalledWith('beforeunload', preventNavigation);

      document.getElementById('done-btn').click();
      await flush();

      expect(saveTask).not.toHaveBeenCalled();
      expect(document.getElementById('issue-modal').classList.contains('hidden')).toBe(true);
      vi.mocked(tasks.renderTasks).mockReset();
    });

    it('should re-render the views and refresh the history after a task update', async () => {
      const rerenderViews = vi.fn();
      setupModal(vi.fn(), rerenderViews);
      await openModalWithMock(makeIssue({ id: 1, tasks: [] }));

      const callbacks = vi.mocked(tasks.renderTasks).mock.lastCall[3];
      callbacks.onTaskUpdate();

      expect(rerenderViews).toHaveBeenCalled();
      expect(activity.refreshHistory).toHaveBeenCalled();
    });

    it('should guard against leaving the page while an activity comment is edited', async () => {
      const addSpy = vi.spyOn(globalThis, 'addEventListener');
      const removeSpy = vi.spyOn(globalThis, 'removeEventListener');
      await openModalWithMock(makeIssue({ id: 1, title: 'T' }));

      // The callbacks look at the actual editor state: open while onEditStart runs, closed after.
      const { onEditStart, onEditEnd } = vi.mocked(activity.loadActivity).mock.lastCall[1];
      vi.mocked(activity.getOpenCommentDraft).mockReturnValueOnce({ changed: () => false, save: vi.fn(), discard: vi.fn() });
      onEditStart();
      expect(addSpy).toHaveBeenCalledWith('beforeunload', preventNavigation);
      onEditEnd();
      expect(removeSpy).toHaveBeenCalledWith('beforeunload', preventNavigation);
    });

    it('should save task order', async () => {
      const issue = makeIssue({
        id: 1,
        project_id: 7,
        tasks: [
          makeTask({ id: 101, title: 'T1', position: 0 }),
          makeTask({ id: 102, title: 'T2', position: 1 })
        ]
      });
      await openModalWithMock(issue);

      // Setup DOM as if dragged
      const taskList = document.getElementById('task-list');
      taskList.innerHTML = `
          <li class="task-item" data-id="102"></li>
          <li class="task-item" data-id="101"></li>
          `;

      // We need to trigger the saveTaskOrder somehow. It's internal but used in renderTasks callback
      // We can manually call it if we can access it, or trigger the callback.
      const taskOrderCallback = vi.mocked(tasks.renderTasks).mock.calls[0][3].onTaskOrderSave;
      await taskOrderCallback();

      // One request carrying the whole new order, not one PUT per task
      expect(api.updateTaskPositions).toHaveBeenCalledTimes(1);
      expect(api.updateTaskPositions).toHaveBeenCalledWith(7, 1, [{ id: 102, position: 0 }, { id: 101, position: 1 }]);
      expect(state.currentIssue.tasks[0].id).toBe(102);
    });

    it('should insert ordered list via toolbar button', async () => {
      openModal(null);
      const editor = byId('description-editor', HTMLTextAreaElement);

      editor.value = 'item one\nitem two';
      editor.selectionStart = 0;
      editor.selectionEnd = 17;

      const olBtn = document.querySelector<HTMLElement>('.editor-btn[data-md="ol"]');
      if (olBtn) olBtn.click();

      expect(editor.value).toContain('1. item one');
      expect(editor.value).toContain('2. item two');
    });

    it('should create link via toolbar with URL selection', async () => {
      openModal(null);
      const editor = byId('description-editor', HTMLTextAreaElement);

      editor.value = 'https://example.com';
      editor.selectionStart = 0;
      editor.selectionEnd = 19;

      const linkBtn = document.querySelector<HTMLElement>('.editor-btn[data-md="link"]');
      linkBtn.click();

      expect(editor.value).toBe('[https://example.com](https://example.com)');
    });

    it('should use placeholder URL when selection is not a valid URL', async () => {
      openModal(null);
      const editor = byId('description-editor', HTMLTextAreaElement);

      editor.value = 'click here';
      editor.selectionStart = 0;
      editor.selectionEnd = 10;

      const linkBtn = document.querySelector<HTMLElement>('.editor-btn[data-md="link"]');
      linkBtn.click();

      // Non-URL selection becomes link text; URL is a safe https:// placeholder
      expect(editor.value).toBe('[click here](https://)');
      expect(editor.value).not.toContain('javascript:'); //NOSONAR
    });

    it('should handle planned date chip add button click', () => {
      openModal(null);
      const addBtn = document.querySelector<HTMLElement>('.date-chip-add');
      const picker = byId('planned-date-picker', HTMLInputElement);
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
      const issue = makeIssue({ id: 1, status: 'Open' });
      await openModalWithMock(issue);

      vi.mocked(utils.canArchive).mockReturnValue({ allowed: false, reason: 'Reason' });
      vi.mocked(utils.showConfirm).mockResolvedValue(true);

      const archiveBtn = document.getElementById('archive-issue-btn');
      archiveBtn.click();

      await new Promise(process.nextTick);

      expect(utils.showConfirm).toHaveBeenCalledWith('Cannot Archive', 'Reason', 'OK', null, 'primary');
      expect(api.updateIssue).not.toHaveBeenCalled();
    });

    it('should handle preventNavigation', () => {
      // jsdom cannot construct a BeforeUnloadEvent, and preventNavigation only uses these two members.
      const event = { preventDefault: vi.fn(), returnValue: 'abc' } as unknown as BeforeUnloadEvent;
      preventNavigation(event);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.returnValue).toBe('');
    });

    it('should toggle preview in new-issue mode', () => {
      openModal(null);
      const editor = byId('description-editor', HTMLTextAreaElement);
      const preview = document.getElementById('description-preview');
      const previewToggle = document.getElementById('md-preview-toggle');

      // In new-issue mode: editor visible, preview hidden
      expect(editor.classList.contains('hidden')).toBe(false);
      expect(preview.classList.contains('hidden')).toBe(true);

      // Toggle to preview
      editor.value = 'hello world';
      previewToggle.click();
      expect(preview.classList.contains('hidden')).toBe(false);
      expect(editor.classList.contains('hidden')).toBe(true);

      // Toggle back to editor
      previewToggle.click();
      expect(editor.classList.contains('hidden')).toBe(false);
      expect(preview.classList.contains('hidden')).toBe(true);
    });

    it('should indent and unindent multi-line text on Tab and Shift+Tab', () => {
      openModal(null);
      const editor = byId('description-editor', HTMLTextAreaElement);

      // Test 1: Single line insert spaces
      editor.value = 'hello';
      editor.selectionStart = 2; // after 'e'
      editor.selectionEnd = 2;

      let event = new globalThis.KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
      vi.spyOn(event, 'preventDefault');
      const dispatchInputSpy = vi.spyOn(editor, 'dispatchEvent');
      editor.dispatchEvent(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(editor.value).toBe('he  llo');
      expect(dispatchInputSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'input' }));

      // Test 2: Multi-line indent (Tab on selected block)
      editor.value = 'line1\nline2\nline3';
      editor.selectionStart = 0; // Select from "line1"
      editor.selectionEnd = 10;  // to mid of "line2"

      event = new globalThis.KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
      editor.dispatchEvent(event);
      // It should indent line1 and line2, but not line3
      expect(editor.value).toBe('  line1\n  line2\nline3');
      expect(editor.selectionStart).toBe(2);
      expect(editor.selectionEnd).toBe(14); // 10 original + 2 (line1) + 2 (line2) = 14

      // Test 3: Multi-line unindent (Shift+Tab)
      event = new globalThis.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true });
      editor.dispatchEvent(event);
      // It should revert back
      expect(editor.value).toBe('line1\nline2\nline3');
      expect(editor.selectionStart).toBe(0);
      expect(editor.selectionEnd).toBe(10);
      dispatchInputSpy.mockRestore();
    });

    it('should auto-continue bullet lists on Enter', () => {
      openModal(null);
      const editor = byId('description-editor', HTMLTextAreaElement);
      const dispatchInputSpy = vi.spyOn(editor, 'dispatchEvent');

      // Basic bullet with '-'
      editor.value = '- first item';
      editor.selectionStart = editor.selectionEnd = 12;
      let event = new globalThis.KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
      vi.spyOn(event, 'preventDefault');
      editor.dispatchEvent(event);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(editor.value).toBe('- first item\n- ');
      expect(editor.selectionStart).toBe(15);
      expect(dispatchInputSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'input' }));

      // Bullet with '*'
      editor.value = '* second item';
      editor.selectionStart = editor.selectionEnd = 13;
      event = new globalThis.KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
      editor.dispatchEvent(event);
      expect(editor.value).toBe('* second item\n* ');

      // Bullet with '+'
      editor.value = '+ third item';
      editor.selectionStart = editor.selectionEnd = 12;
      event = new globalThis.KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
      editor.dispatchEvent(event);
      expect(editor.value).toBe('+ third item\n+ ');

      // Indented bullet preserves indent
      editor.value = '  - indented';
      editor.selectionStart = editor.selectionEnd = 12;
      event = new globalThis.KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
      editor.dispatchEvent(event);
      expect(editor.value).toBe('  - indented\n  - ');

      dispatchInputSpy.mockRestore();
    });

    it('should auto-continue numbered lists on Enter', () => {
      openModal(null);
      const editor = byId('description-editor', HTMLTextAreaElement);

      // Basic numbered list
      editor.value = '1. first item';
      editor.selectionStart = editor.selectionEnd = 13;
      let event = new globalThis.KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
      vi.spyOn(event, 'preventDefault');
      editor.dispatchEvent(event);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(editor.value).toBe('1. first item\n2. ');
      expect(editor.selectionStart).toBe(17);

      // Increments from arbitrary number
      editor.value = '5. fifth item';
      editor.selectionStart = editor.selectionEnd = 13;
      event = new globalThis.KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
      editor.dispatchEvent(event);
      expect(editor.value).toBe('5. fifth item\n6. ');

      // Indented numbered list preserves indent
      editor.value = '  3. indented';
      editor.selectionStart = editor.selectionEnd = 13;
      event = new globalThis.KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
      editor.dispatchEvent(event);
      expect(editor.value).toBe('  3. indented\n  4. ');
    });

    it('should exit list on Enter when list item is empty', () => {
      openModal(null);
      const editor = byId('description-editor', HTMLTextAreaElement);

      // Empty bullet item: removes marker
      editor.value = '- ';
      editor.selectionStart = editor.selectionEnd = 2;
      let event = new globalThis.KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
      vi.spyOn(event, 'preventDefault');
      editor.dispatchEvent(event);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(editor.value).toBe('');
      expect(editor.selectionStart).toBe(0);

      // Empty numbered item: removes marker
      editor.value = '1. ';
      editor.selectionStart = editor.selectionEnd = 3;
      event = new globalThis.KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
      editor.dispatchEvent(event);
      expect(editor.value).toBe('');
      expect(editor.selectionStart).toBe(0);
    });

    it('should not interfere with Enter on plain text or with modifier keys', () => {
      openModal(null);
      const editor = byId('description-editor', HTMLTextAreaElement);

      // Plain text line: Enter should not be intercepted
      editor.value = 'just some text';
      editor.selectionStart = editor.selectionEnd = 14;
      let event = new globalThis.KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
      vi.spyOn(event, 'preventDefault');
      editor.dispatchEvent(event);
      expect(event.preventDefault).not.toHaveBeenCalled();

      // Shift+Enter on a list line: not intercepted
      editor.value = '- item';
      editor.selectionStart = editor.selectionEnd = 6;
      event = new globalThis.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true });
      vi.spyOn(event, 'preventDefault');
      editor.dispatchEvent(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('should handle dropdown option clicks', async () => {
      const issue = makeIssue({ id: 1, label: null, priority: 'Normal' });
      await openModalWithMock(issue);

      // Priority option click
      const priorityOptions = document.getElementById('priority-options');
      const highOption = Array.from(priorityOptions.querySelectorAll<HTMLElement>('.custom-option')).find(c => c.textContent === 'High');
      highOption.click();
      expect(byId('priority', HTMLInputElement).value).toBe('High');

      // Label "No Label" click
      const labelOptions = document.getElementById('label-options');
      const noLabelOption = Array.from(labelOptions.querySelectorAll<HTMLElement>('.custom-option')).find(c => c.textContent === 'No Label');
      noLabelOption.click();
      expect(byId('label-select', HTMLInputElement).value).toBe('');

      // Label specific option click
      const bugOption = Array.from(labelOptions.querySelectorAll<HTMLElement>('.custom-option')).find(c => c.textContent === 'Bug');
      bugOption.click();
      expect(byId('label-select', HTMLInputElement).value).toBe('1');

      // Assignee option clicks
      const assigneeOptions = document.getElementById('assignee-options');
      const unassignedOption = Array.from(assigneeOptions.querySelectorAll<HTMLElement>('.custom-option')).find(c => c.textContent === 'Unassigned');
      unassignedOption.click();
      expect(byId('assignee-select', HTMLInputElement).value).toBe('');

      const userOption = Array.from(assigneeOptions.querySelectorAll<HTMLElement>('.custom-option')).find(c => c.textContent === 'Test User');
      userOption.click();
      expect(byId('assignee-select', HTMLInputElement).value).toBe('1');
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
      const issue = makeIssue({ id: 1, project_id: 7, title: 'Test' });
      await openModalWithMock(issue);

      const input = byId('new-task-title', HTMLInputElement);
      input.value = 'New Task';

      vi.mocked(api.createTask).mockResolvedValue(makeTask({ id: 999, title: 'New Task' }));

      input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter' }));

      await new Promise(process.nextTick);
      expect(api.createTask).toHaveBeenCalled();
    });

    it('should handle modal open failure - issue not found', async () => {
      vi.mocked(api.fetchIssueById).mockResolvedValue({ issue: null, etag: null });
      const modal = document.getElementById('issue-modal');

      await openModal(makeIssue({ id: 999 }));

      expect(utils.showNotification).toHaveBeenCalledWith('Issue not found or was deleted', 'error');
      expect(modal.classList.contains('hidden')).toBe(true);
    });

    it('should handle modal open failure - fetch error', async () => {
      vi.mocked(api.fetchIssueById).mockRejectedValue(new Error('Network Error'));
      const modal = document.getElementById('issue-modal');

      await openModal(makeIssue({ id: 999 }));

      expect(utils.showNotification).toHaveBeenCalledWith('Failed to load issue', 'error');
      expect(modal.classList.contains('hidden')).toBe(true);
    });

    it('saves the description only once when ✓ is pressed again while the first save is in flight', async () => {
      const issue = makeIssue({ id: 1, description: 'Original' });
      await openModalWithMock(issue);
      const resolveUpdate = answerByHand();
      vi.mocked(api.updateIssue).mockImplementationOnce(resolveUpdate.save);

      const descEditor = byId('description-editor', HTMLTextAreaElement);
      const saveBtn = document.getElementById('desc-save-btn');
      document.getElementById('description-preview').click();
      descEditor.value = 'Changed';
      const descContainer = document.querySelector('.editor-container');
      saveBtn.click();
      expect(descContainer.getAttribute('aria-busy')).toBe('true');
      saveBtn.click();

      resolveUpdate.answer('"e2"');
      await new Promise(process.nextTick);
      await new Promise(process.nextTick);

      expect(api.updateIssue).toHaveBeenCalledTimes(1);
      expect(descContainer.hasAttribute('aria-busy')).toBe(false);
    });

    it('should handle cancel description edit', async () => {
      const issue = makeIssue({ id: 1, description: 'Original' });
      await openModalWithMock(issue);

      const descEditor = byId('description-editor', HTMLTextAreaElement);
      const descPreview = document.getElementById('description-preview');
      const descContainer = document.querySelector('.editor-container');

      descPreview.click(); // Enter edit mode via preview click
      descEditor.value = 'Changed';

      const cancelBtn = document.getElementById('desc-cancel-btn');
      cancelBtn.click();
      await new Promise(process.nextTick); // ✕ asks before discarding changed text

      expect(utils.confirmDiscard).toHaveBeenCalledWith(true);
      expect(descEditor.value).toBe('Original');
      expect(descContainer.classList.contains('inline-editing')).toBe(false);
    });


    it('should handle link bubble loop (span inside link)', async () => {
      const issue = makeIssue({ id: 1, description: '<a href="https://example.com"><span id="inner">Link</span></a>' });
      await openModalWithMock(issue);

      const descPreview = document.getElementById('description-preview');
      const inner = descPreview.querySelector('span'); // link is rendered into the preview pane
      const openSpy = vi.spyOn(globalThis, 'open').mockImplementation(() => null);

      inner.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(openSpy).toHaveBeenCalled();
      openSpy.mockRestore();
    });
  });

  // docs/frontend.md "Editing Fields"
  describe('Field behaviour', () => {
    const key = (el: Element, k: string, opts: KeyboardEventInit = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
    const modalHidden = () => document.getElementById('issue-modal').classList.contains('hidden');
    const descContainer = () => document.querySelector('.editor-container');

    it('saves the description with Cmd/Ctrl+Enter', async () => {
      await openModalWithMock(makeIssue({ id: 1, description: 'Old' }));
      document.getElementById('description-preview').click();
      const editor = byId('description-editor', HTMLTextAreaElement);
      editor.value = 'New';
      key(editor, 'Enter', { metaKey: true });
      await flush();

      expect(api.updateIssue).toHaveBeenCalledWith(1, expect.objectContaining({ description: 'New' }), expect.any(String));
      expect(descContainer().classList.contains('inline-editing')).toBe(false);
    });

    it('cancels the description with Escape, asking only when the text was changed', async () => {
      await openModalWithMock(makeIssue({ id: 1, description: 'Old' }));
      const editor = byId('description-editor', HTMLTextAreaElement);

      document.getElementById('description-preview').click();
      key(editor, 'Escape');
      await flush();
      expect(utils.confirmDiscard).toHaveBeenLastCalledWith(false);
      expect(descContainer().classList.contains('inline-editing')).toBe(false);

      document.getElementById('description-preview').click();
      editor.value = 'Typed';
      vi.mocked(utils.confirmDiscard).mockResolvedValueOnce(false); // Keep editing
      key(editor, 'Escape');
      await flush();
      expect(utils.confirmDiscard).toHaveBeenLastCalledWith(true);
      expect(descContainer().classList.contains('inline-editing')).toBe(true);
      expect(editor.value).toBe('Typed');
    });

    it('marks the title busy while it saves and ignores Escape meanwhile', async () => {
      await openModalWithMock(makeIssue({ id: 1, title: 'Old' }));
      const answerSave = answerByHand();
      vi.mocked(api.updateIssue).mockImplementationOnce(answerSave.save);
      const title = byId('title', HTMLInputElement);
      const field = title.closest('.title-input-container');

      title.click();
      title.value = 'New';
      key(title, 'Enter');
      expect(field.getAttribute('aria-busy')).toBe('true');
      key(title, 'Escape');
      expect(title.value).toBe('New');

      answerSave.answer('"e2"');
      await flush();
      expect(field.hasAttribute('aria-busy')).toBe(false);
      expect(title.classList.contains('inline-editing')).toBe(false);
      expect(title.readOnly).toBe(true);
    });

    it('takes the cleaned-up title from the save response, without fetching the issue again and keeping the tasks', async () => {
      await openModalWithMock(makeIssue({ id: 1, title: 'Old', tasks: [makeTask({ id: 5, title: 'Task' })] }));
      await flush();
      const tasksBefore = state.currentIssue.tasks;
      vi.mocked(api.fetchIssueById).mockClear();
      vi.mocked(api.updateIssue).mockResolvedValueOnce({ issue: makeIssue({ id: 1, title: 'Clean', tasks: [] }), etag: '"e2"', conflict: false });

      const title = byId('title', HTMLInputElement);
      title.click();
      title.value = 'Clean<b>';
      key(title, 'Enter');
      await flush();

      expect(api.fetchIssueById).not.toHaveBeenCalled();
      expect(title.value).toBe('Clean');
      expect(state.currentIssue.title).toBe('Clean');
      expect(state.currentIssue.tasks).toBe(tasksBefore);
      expect(utils.showNotification).toHaveBeenCalledWith('Unsupported HTML tags are not rendered for security.', 'error');
    });

    it('re-renders the views only after the saved issue is applied, so a card never keeps the old updated_at', async () => {
      await openModalWithMock(makeIssue({ id: 1, title: 'Old', updated_at: 't1' }));
      await flush();
      let seen = null;
      rerenderViews.mockImplementation(() => { seen = { ...state.currentIssue }; });
      vi.mocked(api.updateIssue).mockResolvedValueOnce({ issue: makeIssue({ id: 1, title: 'New', updated_at: 't2' }), etag: '"e2"', conflict: false });

      const title = byId('title', HTMLInputElement);
      title.click();
      title.value = 'New';
      key(title, 'Enter');
      await flush();

      expect(rerenderViews).toHaveBeenCalledTimes(1);
      expect(seen).toMatchObject({ title: 'New', updated_at: 't2' });
    });

    it('dims only the changed sidebar field until its save is done, also across a second change', async () => {
      await openModalWithMock(makeIssue({ id: 1, title: 'T', priority: 'Normal', status: 'Todo' }));
      await flush();
      const answers: ((etag: string) => void)[] = [];
      vi.mocked(api.updateIssue).mockImplementation((projectId, sent) => {
        const save = answerByHand();
        answers.push(save.answer);
        return save.save(projectId, sent);
      });
      const priority = byId('priority', HTMLInputElement);
      const priorityField = priority.closest('.form-group');
      const statusField = document.getElementById('status').closest('.form-group');

      priority.value = 'High';
      priority.dispatchEvent(new Event('change'));
      priority.value = 'Low';
      priority.dispatchEvent(new Event('change'));
      await flush();
      expect(priorityField.getAttribute('aria-busy')).toBe('true');
      expect(statusField.hasAttribute('aria-busy')).toBe(false);

      answers.shift()('"e2"');
      await flush();
      expect(priorityField.getAttribute('aria-busy')).toBe('true'); // the second change is still saving

      answers.shift()('"e3"');
      await flush();
      expect(priorityField.hasAttribute('aria-busy')).toBe(false);
      expect(state.currentIssue.priority).toBe('Low');
    });

    it('frees the sidebar field after a failed save', async () => {
      await openModalWithMock(makeIssue({ id: 1, title: 'T', status: 'Todo' }));
      await flush();
      vi.mocked(api.updateIssue).mockRejectedValueOnce(new Error('Connection to the server failed'));
      const status = byId('status', HTMLInputElement);
      status.value = 'Done';
      status.dispatchEvent(new Event('change'));
      await flush();
      expect(status.closest('.form-group').hasAttribute('aria-busy')).toBe(false);
      expect(status.value).toBe('Todo');
    });

    it('dims the planned dates while a date is saved', async () => {
      await openModalWithMock(makeIssue({ id: 1, title: 'T', planned_dates: [] }));
      await flush();
      const answer = answerByHand();
      vi.mocked(api.updateIssue).mockImplementationOnce(answer.save);
      const field = document.getElementById('planned-dates-container').closest('.form-group');

      const picker = byId('planned-date-picker', HTMLInputElement);
      picker.value = '2025-05-20';
      picker.dispatchEvent(new Event('change'));
      await flush();
      expect(field.getAttribute('aria-busy')).toBe('true');

      answer.answer('"e2"');
      await flush();
      expect(field.hasAttribute('aria-busy')).toBe(false);
    });

    it('takes the assignee object from the save response without fetching the issue again', async () => {
      await openModalWithMock(makeIssue({ id: 1, title: 'T', assignee_id: null }));
      await flush();
      vi.mocked(api.fetchIssueById).mockClear();
      const assignee = makeUserRef({ id: 1, first_name: 'Test', last_name: 'User' });
      vi.mocked(api.updateIssue).mockResolvedValueOnce({ issue: makeIssue({ id: 1, assignee_id: 1, assignee }), etag: '"e2"', conflict: false });

      const select = byId('assignee-select', HTMLInputElement);
      select.value = '1';
      select.dispatchEvent(new Event('change'));
      await flush();

      expect(api.fetchIssueById).not.toHaveBeenCalled();
      expect(state.currentIssue.assignee).toEqual(assignee);
    });

    it('asks "Add task?" on Done when the new-task field has text, and adds it', async () => {
      await openModalWithMock(makeIssue({ id: 1, project_id: 7, title: 'T', tasks: [] }));
      vi.mocked(api.createTask).mockResolvedValueOnce(makeTask({ id: 9, title: 'Typed', done: false }));
      byId('new-task-title', HTMLInputElement).value = 'Typed';
      vi.mocked(utils.showConfirm).mockResolvedValueOnce(true);

      document.getElementById('done-btn').click();
      await flush();

      expect(utils.showConfirm).toHaveBeenCalledWith('Unsaved Changes', 'Add task?', 'Add', 'Discard', 'primary');
      expect(api.createTask).toHaveBeenCalledTimes(1);
      expect(modalHidden()).toBe(true);
    });

    it('drops the new-task text on Done when the user discards it', async () => {
      await openModalWithMock(makeIssue({ id: 1, project_id: 7, title: 'T', tasks: [] }));
      byId('new-task-title', HTMLInputElement).value = 'Typed';
      vi.mocked(utils.showConfirm).mockResolvedValueOnce(false);

      document.getElementById('done-btn').click();
      await flush();

      expect(api.createTask).not.toHaveBeenCalled();
      expect(byId('new-task-title', HTMLInputElement).value).toBe('');
      expect(modalHidden()).toBe(true);
    });

    it('asks "Save comment?" on Done while a comment is open, and keeps the modal open if its save fails', async () => {
      await openModalWithMock(makeIssue({ id: 1, title: 'T' }));
      const draft = { changed: () => true, save: vi.fn().mockResolvedValue(false), discard: vi.fn() };
      vi.mocked(activity.getOpenCommentDraft).mockReturnValueOnce(draft);
      vi.mocked(utils.showConfirm).mockResolvedValueOnce(true);

      document.getElementById('done-btn').click();
      await flush();

      expect(utils.showConfirm).toHaveBeenCalledWith('Unsaved Changes', 'Save comment?', 'Save', 'Discard', 'primary');
      expect(draft.save).toHaveBeenCalled();
      expect(draft.discard).not.toHaveBeenCalled();
      expect(modalHidden()).toBe(false);
    });

    it('discards an unchanged comment on Done without asking', async () => {
      await openModalWithMock(makeIssue({ id: 1, title: 'T' }));
      const draft = { changed: () => false, save: vi.fn(), discard: vi.fn() };
      vi.mocked(activity.getOpenCommentDraft).mockReturnValueOnce(draft);

      document.getElementById('done-btn').click();
      await flush();

      expect(utils.showConfirm).not.toHaveBeenCalled();
      expect(draft.discard).toHaveBeenCalled();
      expect(modalHidden()).toBe(true);
    });

    it('keeps the leave-page warning after a title edit ends while a comment is still open', async () => {
      const removeSpy = vi.spyOn(globalThis, 'removeEventListener');
      await openModalWithMock(makeIssue({ id: 1, title: 'T' }));
      vi.mocked(activity.getOpenCommentDraft).mockReturnValue({ changed: () => true, save: vi.fn(), discard: vi.fn() });
      try {
        const title = document.getElementById('title');
        title.click();
        removeSpy.mockClear();
        key(title, 'Escape');
        expect(removeSpy).not.toHaveBeenCalledWith('beforeunload', preventNavigation);
      } finally {
        vi.mocked(activity.getOpenCommentDraft).mockReset();
      }
    });

    it('keeps the leave-page warning while the new-task field has text', async () => {
      const addSpy = vi.spyOn(globalThis, 'addEventListener');
      const removeSpy = vi.spyOn(globalThis, 'removeEventListener');
      await openModalWithMock(makeIssue({ id: 1, title: 'T', tasks: [] }));
      const input = byId('new-task-title', HTMLInputElement);

      input.value = 'Typed';
      input.dispatchEvent(new Event('input'));
      expect(addSpy).toHaveBeenCalledWith('beforeunload', preventNavigation);

      input.value = '';
      input.dispatchEvent(new Event('input'));
      expect(removeSpy).toHaveBeenCalledWith('beforeunload', preventNavigation);
    });

    it('ends the description edit mode and the leave-page warning when the modal closes, e.g. after archiving', async () => {
      const removeSpy = vi.spyOn(globalThis, 'removeEventListener');
      await openModalWithMock(makeIssue({ id: 1, description: 'Old' }));
      document.getElementById('description-preview').click();
      byId('description-editor', HTMLTextAreaElement).value = 'Typed';
      removeSpy.mockClear();

      closeModal();
      expect(descContainer().classList.contains('inline-editing')).toBe(false);
      expect(removeSpy).toHaveBeenCalledWith('beforeunload', preventNavigation);

      await openModalWithMock(makeIssue({ id: 2, description: 'Other' }));
      expect(descContainer().classList.contains('inline-editable')).toBe(true);
      expect(byId('description-editor', HTMLTextAreaElement).value).toBe('Other');
    });

    it('re-enables the dates and dropdowns when the next issue is not archived', async () => {
      await openModalWithMock(makeIssue({ id: 1, title: 'A', status: 'Archive' }));
      closeModal();
      await openModalWithMock(makeIssue({ id: 2, title: 'B', status: 'Done' }));

      expect(document.getElementById('deadline').hasAttribute('aria-disabled')).toBe(false);
      document.querySelectorAll<HTMLButtonElement>('.custom-select-trigger').forEach(trigger => expect(trigger.disabled).toBe(false));
      expect(document.getElementById('title').classList.contains('read-only-text')).toBe(false);
      expect(document.getElementById('title').hasAttribute('aria-disabled')).toBe(false);
      expect(document.querySelector('.editor-container').hasAttribute('aria-disabled')).toBe(false);
    });

    it('moves the issue only after a queued title save, so the next save carries the ETag from the move', async () => {
      await openModalWithMock(makeIssue({ id: 1, project_id: 1, title: 'Old', priority: 'Normal' }));
      await flush();
      const answerSave = answerByHand();
      vi.mocked(api.updateIssue).mockImplementationOnce(answerSave.save);
      vi.mocked(api.moveIssue).mockResolvedValueOnce({ issue: makeIssue({ id: 1, project_id: 2, title: 'New', priority: 'Normal' }), etag: '"moved"' });

      const title = byId('title', HTMLInputElement);
      title.click();
      title.value = 'New';
      key(title, 'Enter');
      const projectSelect = byId('project-select', HTMLInputElement);
      projectSelect.value = '2';
      projectSelect.dispatchEvent(new Event('change'));
      await flush();
      expect(utils.promptAdminPasswordConfirmation).not.toHaveBeenCalled();

      answerSave.answer('"before-move"');
      await flush();
      expect(api.moveIssue).toHaveBeenCalledTimes(1);

      vi.mocked(api.updateIssue).mockClear();
      const prioritySelect = byId('priority', HTMLInputElement);
      prioritySelect.value = 'High';
      prioritySelect.dispatchEvent(new Event('change'));
      await flush();
      expect(api.updateIssue).toHaveBeenLastCalledWith(2, expect.objectContaining({ priority: 'High' }), '"moved"');
    });
  });

  describe('Client-side Validation', () => {
    it('should validate title length before submit', async () => {
      await openModalWithMock(null);
      byId('title', HTMLInputElement).value = 'a'.repeat(101);
      document.getElementById('save-issue-btn').click();

      await new Promise(process.nextTick);

      expect(api.createIssue).not.toHaveBeenCalled();
      expect(utils.showNotification).toHaveBeenCalledWith('Title must not exceed 100 characters.', 'error');
    });

    it('should validate description length before submit', async () => {
      await openModalWithMock(null);
      byId('title', HTMLInputElement).value = 'Valid Title';
      const longDesc = 'a'.repeat(5001);
      byId('description-editor', HTMLTextAreaElement).value = longDesc;

      document.getElementById('save-issue-btn').click();

      await new Promise(process.nextTick);

      expect(api.createIssue).not.toHaveBeenCalled();
      expect(utils.showNotification).toHaveBeenCalledWith('Description must not exceed 5000 characters.', 'error');
    });

    it('should validate task title length', async () => {
      const issue = makeIssue({ id: 1, tasks: [] });
      await openModalWithMock(issue);
      const titleInput = byId('new-task-title', HTMLInputElement);
      titleInput.value = 'a'.repeat(101);
      document.getElementById('add-task-btn').click();

      expect(api.createTask).not.toHaveBeenCalled();
      expect(utils.showNotification).toHaveBeenCalledWith('Task title must not exceed 100 characters.', 'error');
    });
  });

  describe('Conflict Handling and Error Paths', () => {
    it('should handle conflict in saveIssueWithConflictCheck and reload', async () => {
      const issue = makeIssue({ id: 1, title: 'Old' });
      await openModalWithMock(issue);

      vi.mocked(api.updateIssue, { partial: true }).mockResolvedValue({ conflict: true });
      vi.mocked(utils.showConfirm).mockResolvedValue(true); // User clicks Reload
      vi.mocked(api.fetchIssueById).mockResolvedValue({ issue: makeIssue({ ...issue, title: 'Fresh' }), etag: '"new-etag"' });

      // Trigger a change that calls saveIssueWithConflictCheck (e.g. priority)
      const prioritySelect = byId('priority', HTMLInputElement);
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
      expect(document.getElementById('modal-title').textContent).toContain('Issue Details #1');
    });

    it('should handle sidebar save failures', async () => {
      const issue = makeIssue({ id: 1, title: 'Test' });
      await openModalWithMock(issue);

      vi.mocked(api.updateIssue).mockRejectedValue(new Error('Save Failed'));

      // Test Priority failure
      document.getElementById('priority').dispatchEvent(new Event('change'));
      await new Promise(process.nextTick);
      expect(utils.showNotification).toHaveBeenCalledWith('Save Failed', 'error');

      // Test Status failure
      document.getElementById('status').dispatchEvent(new Event('change'));
      await new Promise(process.nextTick);
      expect(utils.showNotification).toHaveBeenCalledWith('Save Failed', 'error');

      // Test Deadline failure
      byId('deadline', HTMLInputElement).value = '2023-01-01';
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
      const issue = makeIssue({ id: 1, title: 'Test' });
      const meUser = makeUser({ id: 5, first_name: 'Admin', last_name: 'User' });
      state.currentUser = meUser;

      await openModalWithMock(issue);

      const assigneeOptions = document.getElementById('assignee-options');
      const meOption = [...assigneeOptions.querySelectorAll<HTMLElement>('.custom-option')].find(o => o.textContent === 'Assign to me');

      expect(meOption).toBeDefined();
      meOption.click();

      expect(byId('assignee-select', HTMLInputElement).value).toBe('5');
    });

    it('should close modal on Done with no title changes', async () => {
      const issue = makeIssue({ id: 1, title: 'Original' });
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

    it('should show notification and keep modal open on archive failure', async () => {
      const issue = makeIssue({ id: 100, title: 'To Archive', status: 'Open' });
      await openModalWithMock(issue);

      vi.mocked(utils.canArchive).mockReturnValue({ allowed: true });
      vi.mocked(utils.showConfirm).mockResolvedValue(true);
      vi.mocked(api.archiveIssue).mockRejectedValue(new Error('Archive failed'));

      document.getElementById('archive-issue-btn').click();
      await new Promise(process.nextTick);

      expect(utils.showNotification).toHaveBeenCalledWith('Archive failed', 'error');
      expect(document.getElementById('issue-modal').classList.contains('hidden')).toBe(false);
    });

    it('should show notification and keep modal open on unarchive failure', async () => {
      const issue = makeIssue({ id: 101, title: 'To Unarchive', status: 'Archive' });
      await openModalWithMock(issue);

      vi.mocked(utils.showConfirm).mockResolvedValue(true);
      vi.mocked(api.unarchiveIssue).mockRejectedValue(new Error('Unarchive failed'));

      document.getElementById('unarchive-issue-btn').click();
      await new Promise(process.nextTick);

      expect(utils.showNotification).toHaveBeenCalledWith('Unarchive failed', 'error');
      expect(document.getElementById('issue-modal').classList.contains('hidden')).toBe(false);
    });

    it('should show notification when saveTaskOrder fails', async () => {
      const issue = makeIssue({
        id: 1,
        project_id: 7,
        tasks: [
          makeTask({ id: 101, title: 'T1', position: 0 }),
          makeTask({ id: 102, title: 'T2', position: 1 })
        ]
      });
      await openModalWithMock(issue);

      // Set up DOM as if tasks were reordered (positions differ from stored)
      const taskList = document.getElementById('task-list');
      taskList.innerHTML = `
        <li class="task-item" data-id="102"></li>
        <li class="task-item" data-id="101"></li>
      `;

      vi.mocked(api.updateTaskPositions).mockRejectedValue(new Error('Order save failed'));

      // Invoke onTaskOrderSave via the captured callback
      const onTaskOrderSave = vi.mocked(tasks.renderTasks).mock.calls[vi.mocked(tasks.renderTasks).mock.calls.length - 1][3].onTaskOrderSave;
      const renderCountBefore = vi.mocked(tasks.renderTasks).mock.calls.length;
      await onTaskOrderSave();

      expect(utils.showNotification).toHaveBeenCalledWith('Order save failed', 'error');
      // The old positions are restored and the task list is re-rendered in the old order
      expect(state.currentIssue.tasks.map(t => [t.id, t.position])).toEqual([[101, 0], [102, 1]]);
      expect(vi.mocked(tasks.renderTasks).mock.calls.length).toBe(renderCountBefore + 1);
    });
  });
});

describe('Project Selector Coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.updateIssue).mockImplementation(async (_projectId, sent) => ({ issue: savedIssue(sent), etag: '"test-etag"', conflict: false }));
    state.currentIssue = null;
    vi.mocked(setCurrentIssue).mockImplementation((val) => { state.currentIssue = val; });
    setupModal(vi.fn(), undefined);
  });

  it('should update project-text after fetchProjects resolves with a matching project (lines 198-199)', async () => {
    const issue = makeIssue({ id: 1, title: 'Test', project_id: 2 });
    vi.mocked(api.fetchIssueById).mockResolvedValue({ issue, etag: '"etag"' });
    vi.mocked(api.fetchProjects).mockResolvedValue([
      makeProject({ id: 1, name: 'Default' }),
      makeProject({ id: 2, name: 'My Project' })
    ]);

    await openModal(issue);
    await new Promise(process.nextTick);

    expect(document.getElementById('project-text').textContent).toBe('My Project');
  });

  it('should not update project-text when project_id is not found in fetched projects (line 198 branch false)', async () => {
    const issue = makeIssue({ id: 1, title: 'Test', project_id: 99 });
    vi.mocked(api.fetchIssueById).mockResolvedValue({ issue, etag: '"etag"' });
    vi.mocked(api.fetchProjects).mockResolvedValue([makeProject({ id: 1, name: 'Default' })]);

    await openModal(issue);
    await new Promise(process.nextTick);

    // Initial value set from issue?.project?.name ?? 'default' (no project object)
    expect(document.getElementById('project-text').textContent).toBe('default');
  });

  it('should move issue when project-select changes with currentIssue set', async () => {
    state.currentIssue = makeIssue({ id: 1, title: 'Test', project_id: 1 });
    vi.mocked(api.moveIssue).mockResolvedValue({ issue: makeIssue({ id: 1, project_id: 2, label: null, release_id: null, status: 'Open' }), etag: '"move-etag"' });

    const projectSelect = byId('project-select', HTMLInputElement);
    projectSelect.value = '2';
    projectSelect.dispatchEvent(new Event('change'));

    await new Promise(process.nextTick);

    expect(api.moveIssue).toHaveBeenCalledWith(1, 1, 2, 'AdminPass123!');
    expect(state.currentIssue.project_id).toBe(2);
  });

  it('should not call moveIssue and revert dropdown when user cancels confirmation', async () => {
    state.currentIssue = makeIssue({ id: 1, title: 'Test', project_id: 1, project: makeProject({ name: 'Default' }) });
    vi.mocked(utils.promptAdminPasswordConfirmation).mockResolvedValue(false);

    const projectSelect = byId('project-select', HTMLInputElement);
    projectSelect.value = '2';
    projectSelect.dispatchEvent(new Event('change'));

    await new Promise(process.nextTick);

    expect(api.moveIssue).not.toHaveBeenCalled();
    expect(projectSelect.value).toBe('1');
    expect(document.getElementById('project-text').textContent).toBe('Default');
  });

  it('should not call moveIssue when project-select changes without currentIssue', async () => {
    state.currentIssue = null;

    const projectSelect = byId('project-select', HTMLInputElement);
    projectSelect.value = '2';
    projectSelect.dispatchEvent(new Event('change'));

    await new Promise(process.nextTick);

    expect(api.moveIssue).not.toHaveBeenCalled();
  });

  it('should reload labels and reset selection when a project option is clicked (lines 1295-1299)', async () => {
    vi.mocked(api.fetchProjects).mockResolvedValue([makeProject({ id: 1, name: 'Default' }), makeProject({ id: 2, name: 'Other' })]);
    vi.mocked(api.fetchLabelsByProject).mockResolvedValue([makeLabel({ id: 10, name: 'Backend' })]);

    await openModal(null);
    await new Promise(process.nextTick);

    // Second option corresponds to project id=2 ('Other')
    const option = document.querySelectorAll<HTMLElement>('#project-options .custom-option')[1];
    option.click();
    await new Promise(process.nextTick);

    expect(api.fetchLabelsByProject).toHaveBeenCalledWith(2);
    expect(byId('label-select', HTMLInputElement).value).toBe('');
    expect(document.getElementById('label-text').textContent).toBe('No Label');
  });

  it('should log error when fetchLabelsByProject fails on project option click (line 1299)', async () => {
    vi.mocked(api.fetchProjects).mockResolvedValue([makeProject({ id: 1, name: 'Default' }), makeProject({ id: 2, name: 'Other' })]);
    vi.mocked(api.fetchLabelsByProject).mockRejectedValue(new Error('Network error'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await openModal(null);
    await new Promise(process.nextTick);

    const option = document.querySelectorAll<HTMLElement>('#project-options .custom-option')[1];
    option.click();
    await new Promise(process.nextTick);

    expect(consoleSpy).toHaveBeenCalledWith('Failed to reload labels for project', expect.any(Error));
  });
});

// ─── renderReleaseOptions ──────────────────────────────────────────────────────

describe('renderReleaseOptions', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="release-dropdown">
        <div id="release-trigger" class="custom-select-trigger">
          <span id="release-text">No Release</span>
        </div>
        <div id="release-options" class="custom-select-options hidden"></div>
        <input type="hidden" id="release-select">
      </div>
    `;
  });

  it('always renders a "No Release" option', () => {
    renderReleaseOptions([], null);
    const opts = document.querySelectorAll<HTMLElement>('#release-options .custom-option');
    expect(opts).toHaveLength(1);
    expect(opts[0].textContent).toBe('No Release');
  });

  it('renders one option per release plus the "No Release" option', () => {
    renderReleaseOptions([makeRelease({ id: 1, name: 'v1.0' }), makeRelease({ id: 2, name: 'v2.0' })], null);
    const opts = document.querySelectorAll<HTMLElement>('#release-options .custom-option');
    expect(opts).toHaveLength(3);
    expect(opts[1].textContent).toBe('v1.0');
    expect(opts[2].textContent).toBe('v2.0');
  });

  it('sets input value and text to the matching release when currentReleaseId is provided', () => {
    renderReleaseOptions([makeRelease({ id: 1, name: 'v1.0' })], 1);
    expect(byId('release-select', HTMLInputElement).value).toBe('1');
    expect(document.getElementById('release-text').textContent).toBe('v1.0');
  });

  it('sets text to "No Release" when currentReleaseId is not found in the list', () => {
    renderReleaseOptions([makeRelease({ id: 1, name: 'v1.0' })], 999);
    expect(byId('release-select', HTMLInputElement).value).toBe('999');
    expect(document.getElementById('release-text').textContent).toBe('No Release');
  });

  it('sets input to empty and text to "No Release" when currentReleaseId is null', () => {
    renderReleaseOptions([makeRelease({ id: 1, name: 'v1.0' })], null);
    expect(byId('release-select', HTMLInputElement).value).toBe('');
    expect(document.getElementById('release-text').textContent).toBe('No Release');
  });

  it('selects "No Release" option on click and closes dropdown', () => {
    renderReleaseOptions([makeRelease({ id: 1, name: 'v1.0' })], 1);
    const noReleaseOpt = document.querySelector<HTMLElement>('#release-options .custom-option');
    noReleaseOpt.click();
    expect(byId('release-select', HTMLInputElement).value).toBe('');
    expect(document.getElementById('release-text').textContent).toBe('No Release');
    expect(document.getElementById('release-options').classList.contains('hidden')).toBe(true);
  });

  it('selects a specific release option on click', () => {
    renderReleaseOptions([makeRelease({ id: 1, name: 'v1.0' })], null);
    const opts = document.querySelectorAll<HTMLElement>('#release-options .custom-option');
    opts[1].click(); // v1.0
    expect(byId('release-select', HTMLInputElement).value).toBe('1');
    expect(document.getElementById('release-text').textContent).toBe('v1.0');
  });

  it('returns early when the options container is absent', () => {
    document.getElementById('release-options').remove();
    expect(() => renderReleaseOptions([], null)).not.toThrow();
  });
});

// ─── release-select inline save ───────────────────────────────────────────────

describe('release-select change handler', () => {
  beforeEach(async () => {
    document.body.innerHTML = `
      <div id="issue-modal" class="hidden">
        <div class="modal-content">
          <h2 id="modal-title"></h2>
          <form id="issue-form">
            <input id="issue-id" type="hidden">
            <input id="title" type="text" value="">
            <div class="editor-container">
              <div class="md-editor-panes">
                <textarea id="description-editor"></textarea>
                <div id="description-preview" class="hidden"></div>
              </div>
              <div id="description-edit-actions" class="hidden">
                <button id="desc-cancel-btn" type="button"></button>
                <button id="desc-save-btn" type="button"></button>
              </div>
            </div>
            <div id="planned-dates-container"></div>
            <input id="deadline" type="date">
            <div id="status-dropdown">
              <div id="status-trigger"><span id="status-text"></span></div>
              <div id="status-options" class="hidden"></div>
              <input type="hidden" id="status">
            </div>
            <div id="priority-dropdown">
              <div id="priority-trigger"><span id="priority-text"></span></div>
              <div id="priority-options" class="hidden"></div>
              <input type="hidden" id="priority">
            </div>
            <div id="label-dropdown">
              <div id="label-trigger"><span id="label-text"></span></div>
              <div id="label-options" class="hidden"></div>
              <input type="hidden" id="label-select">
            </div>
            <div id="assignee-dropdown">
              <div id="assignee-trigger"><span id="assignee-text"></span></div>
              <div id="assignee-options" class="hidden"></div>
              <input type="hidden" id="assignee-select">
            </div>
            <div id="project-dropdown">
              <button type="button" id="project-trigger"><span id="project-text"></span></button>
              <div id="project-options" class="hidden"></div>
              <input type="hidden" id="project-select" value="1">
            </div>
            <div id="release-dropdown">
              <div id="release-trigger"><span id="release-text"></span></div>
              <div id="release-options" class="hidden"></div>
              <input type="hidden" id="release-select">
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
            <button id="cancel-btn" type="button"></button>
            <button id="save-issue-btn" type="submit"></button>
            <button id="done-btn" type="button"></button>
            <button class="editor-btn" data-md="bold" data-prefix="**" data-suffix="**"></button>
            <button class="editor-btn" data-md="italic" data-prefix="*" data-suffix="*"></button>
            <button class="editor-btn" data-md="strike" data-prefix="~~" data-suffix="~~"></button>
            <button class="editor-btn" data-md="h1"></button>
            <button class="editor-btn" data-md="h2"></button>
            <button class="editor-btn" data-md="ul"></button>
            <button class="editor-btn" data-md="ol"></button>
            <button class="editor-btn" data-md="link"></button>
            <button class="editor-btn" data-md="code"></button>
            <button class="editor-btn" data-md="table"></button>
            <button id="md-preview-toggle" class="editor-btn">Preview</button>
          </form>
        </div>
      </div>
      <div class="left-menu">
        <div id="add-issue-btn" class="menu-btn"></div>
        <div id="nav-board" class="menu-btn"></div>
      </div>
    `;
    vi.clearAllMocks();
    vi.mocked(api.fetchLabelsByProject).mockResolvedValue([]);
    vi.mocked(api.fetchUsers).mockResolvedValue([]);
    vi.mocked(api.fetchProjects).mockResolvedValue([makeProject({ id: 1, name: 'Default' })]);
    vi.mocked(api.updateIssue).mockResolvedValue({ issue: makeIssue({ id: 1, release_id: 2, release: makeRelease({ id: 2, name: 'v2.0' }) }), etag: '"etag"', conflict: false });
    state.releases = [makeRelease({ id: 2, name: 'v2.0' })];
    HTMLElement.prototype.scrollIntoView = vi.fn();
    HTMLInputElement.prototype.reportValidity = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setupModal(vi.fn(), undefined);
  });

  it('calls updateIssue with new release_id when release-select changes to a release', async () => {
    const issue = makeIssue({ id: 1, title: 'T', status: 'Open', release_id: null, release: null });
    vi.mocked(api.fetchIssueById).mockResolvedValue({ issue, etag: '"e"' });
    vi.mocked(setCurrentIssue).mockImplementation(v => { state.currentIssue = v; });
    await openModal(issue);
    state.currentIssue = issue;

    const releaseSelect = byId('release-select', HTMLInputElement);
    releaseSelect.value = '2';
    releaseSelect.dispatchEvent(new Event('change'));
    await new Promise(process.nextTick);

    expect(api.updateIssue).toHaveBeenCalledWith(1, 
      expect.objectContaining({ release_id: 2 }),
      expect.any(String)
    );
  });

  it('calls updateIssue with release_id null when release-select is cleared', async () => {
    const issue = makeIssue({ id: 1, title: 'T', status: 'Open', release_id: 2, release: makeRelease({ id: 2, name: 'v2.0' }) });
    vi.mocked(api.fetchIssueById).mockResolvedValue({ issue, etag: '"e"' });
    vi.mocked(api.updateIssue).mockResolvedValue({ issue: makeIssue({ ...issue, release_id: null, release: null }), etag: '"e2"', conflict: false });
    vi.mocked(setCurrentIssue).mockImplementation(v => { state.currentIssue = v; });
    await openModal(issue);
    state.currentIssue = issue;

    const releaseSelect = byId('release-select', HTMLInputElement);
    releaseSelect.value = '';
    releaseSelect.dispatchEvent(new Event('change'));
    await new Promise(process.nextTick);

    expect(api.updateIssue).toHaveBeenCalledWith(1, 
      expect.objectContaining({ release_id: null }),
      expect.any(String)
    );
  });
});
