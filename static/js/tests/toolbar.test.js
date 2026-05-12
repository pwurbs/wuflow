import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { filterIssues, filterByStatus, sortByPosition } from '../filters.js';
import { state, setFilterRelease } from '../state.js';

// Provide a localStorage stub for the jsdom environment used by vitest.
const _localStore = {};
vi.stubGlobal('localStorage', {
  getItem: (key) => _localStore[key] ?? null,
  setItem: (key, value) => { _localStore[key] = String(value); },
  removeItem: (key) => { delete _localStore[key]; },
});

vi.mock('../api.js', () => ({
  logout: vi.fn(),
  updateCurrentUser: vi.fn().mockResolvedValue({}),
}));

vi.mock('../utils.js', () => ({
  showNotification: vi.fn(),
  getUserInitials: vi.fn((user) => (user.first_name[0] + user.last_name[0]).toUpperCase()),
  debounce: vi.fn((fn) => fn),
}));

vi.mock('../components/system-settings.js', () => ({
  setupSystemSettingsView: vi.fn(),
  renderSystemSettingsView: vi.fn(),
  validatePasswordPolicy: vi.fn(() => null),
}));

import {
  initLabelFilter, updateLabelFilterOptions,
  initPriorityFilter, updatePriorityFilterOptions,
  initUserFilter, updateUserFilterOptions,
  initReleaseFilter, updateReleaseFilterOptions,
  initProjectSelector, updateProjectSelectorOptions,
  setupUserMenu,
} from '../components/toolbar.js';

// ─── Shared Fixtures ───────────────────────────────────────────────────────────

const createIssue = (overrides = {}) => ({
  id: 1,
  title: 'Default Title',
  description: 'Default description',
  status: 'Open',
  priority: 'Normal',
  position: 0,
  label: null,
  ...overrides
});

const mockIssues = [
  createIssue({ id: 1, title: 'Login Bug', priority: 'High', label: { id: 1, name: 'Bug', color: '#ff0000' }, assignee_id: 1, position: 2 }),
  createIssue({ id: 2, title: 'Add Dark Mode', priority: 'Normal', label: { id: 2, name: 'Feature', color: '#00ff00' }, assignee_id: 2, position: 0 }),
  createIssue({ id: 3, title: 'Fix Typo', priority: 'Normal', label: null, assignee_id: null, position: 1 }),
  createIssue({ id: 4, title: 'API Integration', description: 'Login endpoint', priority: 'High', status: 'Working', assignee_id: 1, position: 3 }),
];

// ─── filterIssues ──────────────────────────────────────────────────────────────

describe('filterIssues', () => {
  describe('edge cases', () => {
    it('should return empty array for null issues', () => {
      expect(filterIssues(null, {})).toEqual([]);
    });

    it('should return empty array for undefined issues', () => {
      expect(filterIssues(undefined, {})).toEqual([]);
    });

    it('should return empty array for non-array issues', () => {
      expect(filterIssues('not an array', {})).toEqual([]);
    });

    it('should return all issues when filter is empty', () => {
      const filter = { labelId: null, priority: null, assigneeId: null, search: '' };
      expect(filterIssues(mockIssues, filter)).toHaveLength(4);
    });
  });

  describe('label filter', () => {
    it('should filter by label id', () => {
      const filter = { labelId: 1, priority: null, assigneeId: null, search: '' };
      const result = filterIssues(mockIssues, filter);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Login Bug');
    });

    it('should filter to show only unlabeled issues with __no_label__', () => {
      const filter = { labelId: '__no_label__', priority: null, assigneeId: null, search: '' };
      const result = filterIssues(mockIssues, filter);
      expect(result).toHaveLength(2); // "Fix Typo" and "API Integration" have no label
    });

    it('should return empty when label id not found', () => {
      const filter = { labelId: 999, priority: null, assigneeId: null, search: '' };
      expect(filterIssues(mockIssues, filter)).toHaveLength(0);
    });
  });

  describe('assignee filter', () => {
    it('should filter by assignee id', () => {
      const filter = { labelId: null, priority: null, assigneeId: 1, search: '' };
      const result = filterIssues(mockIssues, filter);
      expect(result).toHaveLength(2); // Login Bug and API Integration
    });

    it('should filter by unassigned', () => {
      const filter = { labelId: null, priority: null, assigneeId: 'unassigned', search: '' };
      const result = filterIssues(mockIssues, filter);
      expect(result).toHaveLength(1); // Fix Typo
    });

    it('should filter by "me" using currentUserId', () => {
      const filter = { labelId: null, priority: null, assigneeId: 'me', search: '' };
      const result = filterIssues(mockIssues, filter, 1);
      expect(result).toHaveLength(2); // Login Bug and API Integration (assignee_id: 1)
    });

    it('should return no issues when "me" filter is used and currentUserId is null', () => {
      const filter = { labelId: null, priority: null, assigneeId: 'me', search: '' };
      const result = filterIssues(mockIssues, filter, null);
      expect(result).toHaveLength(0);
    });
  });

  describe('priority filter', () => {
    it('should filter by High priority', () => {
      const filter = { labelId: null, priority: 'High', assigneeId: null, search: '' };
      const result = filterIssues(mockIssues, filter);
      expect(result).toHaveLength(2);
      expect(result.every(i => i.priority === 'High')).toBe(true);
    });

    it('should filter by Normal priority', () => {
      const filter = { labelId: null, priority: 'Normal', assigneeId: null, search: '' };
      const result = filterIssues(mockIssues, filter);
      expect(result).toHaveLength(2);
      expect(result.every(i => i.priority === 'Normal')).toBe(true);
    });
  });

  describe('search filter', () => {
    it('should search in title (case insensitive)', () => {
      const filter = { labelId: null, priority: null, assigneeId: null, search: 'login' };
      const result = filterIssues(mockIssues, filter);
      expect(result).toHaveLength(2); // "Login Bug" and "API Integration" (description has login)
    });

    it('should search in description', () => {
      const filter = { labelId: null, priority: null, assigneeId: null, search: 'endpoint' };
      const result = filterIssues(mockIssues, filter);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('API Integration');
    });

    it('should handle issues without description', () => {
      const issues = [createIssue({ id: 1, title: 'Test', description: null })];
      const filter = { labelId: null, priority: null, assigneeId: null, search: 'test' };
      expect(filterIssues(issues, filter)).toHaveLength(1);
    });
  });

  describe('release filter', () => {
    it('should filter by release id', () => {
      const issues = [
        createIssue({ id: 1, release_id: 5 }),
        createIssue({ id: 2, release_id: 6 }),
        createIssue({ id: 3, release_id: null }),
      ];
      const filter = { labelId: null, priority: null, assigneeId: null, search: '', releaseId: 5 };
      const result = filterIssues(issues, filter);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
    });

    it('should filter to show only issues without a release using __no_release__', () => {
      const issues = [
        createIssue({ id: 1, release_id: 5 }),
        createIssue({ id: 2, release_id: null }),
        createIssue({ id: 3, release_id: null }),
      ];
      const filter = { labelId: null, priority: null, assigneeId: null, search: '', releaseId: '__no_release__' };
      const result = filterIssues(issues, filter);
      expect(result).toHaveLength(2);
      expect(result.every(i => !i.release_id)).toBe(true);
    });

    it('should return all issues when releaseId filter is null', () => {
      const issues = [
        createIssue({ id: 1, release_id: 5 }),
        createIssue({ id: 2, release_id: null }),
      ];
      const filter = { labelId: null, priority: null, assigneeId: null, search: '', releaseId: null };
      expect(filterIssues(issues, filter)).toHaveLength(2);
    });

    it('should filter by releaseFilterIds (OR logic) matching any selected release', () => {
      const issues = [
        createIssue({ id: 1, release_id: 10 }),
        createIssue({ id: 2, release_id: 20 }),
        createIssue({ id: 3, release_id: 30 }),
      ];
      const filter = { labelId: null, priority: null, assigneeId: null, search: '', releaseFilterIds: [10, 20] };
      const result = filterIssues(issues, filter);
      expect(result).toHaveLength(2);
      expect(result.map(i => i.id)).toEqual(expect.arrayContaining([1, 2]));
    });

    it('should include unassigned issues when null is in releaseFilterIds', () => {
      const issues = [
        createIssue({ id: 1, release_id: 10 }),
        createIssue({ id: 2, release_id: null }),
        createIssue({ id: 3, release_id: null }),
      ];
      const filter = { labelId: null, priority: null, assigneeId: null, search: '', releaseFilterIds: [null] };
      const result = filterIssues(issues, filter);
      expect(result).toHaveLength(2);
      expect(result.every(i => i.release_id === null)).toBe(true);
    });

    it('should return all issues when releaseFilterIds is empty', () => {
      const issues = [
        createIssue({ id: 1, release_id: 10 }),
        createIssue({ id: 2, release_id: null }),
      ];
      const filter = { labelId: null, priority: null, assigneeId: null, search: '', releaseFilterIds: [] };
      expect(filterIssues(issues, filter)).toHaveLength(2);
    });
  });

  describe('combined filters', () => {
    it('should apply label and priority filters together', () => {
      const filter = { labelId: 1, priority: 'High', assigneeId: null, search: '' };
      const result = filterIssues(mockIssues, filter);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Login Bug');
    });

    it('should apply all filters together', () => {
      const filter = { labelId: '__no_label__', priority: 'High', assigneeId: 1, search: 'api' };
      const result = filterIssues(mockIssues, filter);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('API Integration');
    });

    it('should return empty when filters are mutually exclusive', () => {
      const filter = { labelId: 1, priority: 'Normal', assigneeId: null, search: '' };
      expect(filterIssues(mockIssues, filter)).toHaveLength(0);
    });
  });
});

// ─── filterByStatus ────────────────────────────────────────────────────────────

describe('filterByStatus', () => {
  it('should return empty array for null issues', () => {
    expect(filterByStatus(null, 'Open')).toEqual([]);
  });

  it('should filter issues by status', () => {
    const result = filterByStatus(mockIssues, 'Open');
    expect(result).toHaveLength(3);
  });

  it('should return issues matching Working status', () => {
    const result = filterByStatus(mockIssues, 'Working');
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('API Integration');
  });

  it('should return empty array when no matches', () => {
    expect(filterByStatus(mockIssues, 'Done')).toHaveLength(0);
  });
});

// ─── sortByPosition ────────────────────────────────────────────────────────────

describe('sortByPosition', () => {
  it('should return empty array for null issues', () => {
    expect(sortByPosition(null)).toEqual([]);
  });

  it('should sort issues by position ascending', () => {
    const result = sortByPosition(mockIssues);
    expect(result[0].id).toBe(2); // position 0
    expect(result[1].id).toBe(3); // position 1
    expect(result[2].id).toBe(1); // position 2
    expect(result[3].id).toBe(4); // position 3
  });

  it('should not mutate original array', () => {
    const original = [...mockIssues];
    sortByPosition(mockIssues);
    expect(mockIssues).toEqual(original);
  });
});

// ─── filterIssues project (server-side) ───────────────────────────────────────
// Project filtering is handled server-side. filterIssues does not filter by
// selectedProjectId — all issues in the passed array are returned regardless.

describe('filterIssues project (server-side)', () => {
  const projectIssues = [
    createIssue({ id: 10, project: { id: 1 } }),
    createIssue({ id: 11, project: { id: 2 } }),
    createIssue({ id: 12, project: null }),
  ];
  const emptyFilter = { labelId: null, priority: null, assigneeId: null, search: '' };

  afterEach(() => {
    state.selectedProjectId = null;
  });

  it('returns all issues regardless of selectedProjectId (filtering is server-side)', () => {
    state.selectedProjectId = null;
    expect(filterIssues(projectIssues, emptyFilter)).toHaveLength(3);
  });

  it('does not filter by project when selectedProjectId is set', () => {
    state.selectedProjectId = 1;
    expect(filterIssues(projectIssues, emptyFilter)).toHaveLength(3);
  });

  it('does not filter out issues with null project', () => {
    state.selectedProjectId = 2;
    expect(filterIssues(projectIssues, emptyFilter)).toHaveLength(3);
  });

  it('returns all issues even when selectedProjectId matches nothing', () => {
    state.selectedProjectId = 99;
    expect(filterIssues(projectIssues, emptyFilter)).toHaveLength(3);
  });
});

// ─── Label Filter (toolbar) ────────────────────────────────────────────────────

describe('Label Filter', () => {
  let refreshApp;

  beforeEach(() => {
    state.filter.labelId = null;
    refreshApp = vi.fn();
    document.body.innerHTML = `
      <div id="label-filter-wrapper">
        <button id="label-filter-btn"></button>
        <div id="label-filter-options" class="hidden"></div>
      </div>
    `;
    initLabelFilter(refreshApp);
  });

  it('populates "No Label" option plus all label options', () => {
    updateLabelFilterOptions([{ id: 1, name: 'Bug', color: '#f00' }]);
    const opts = document.querySelectorAll('#label-filter-options .custom-option');
    expect(opts).toHaveLength(2);
    expect(opts[0].textContent).toBe('No Label');
    expect(opts[1].textContent).toBe('Bug');
  });

  it('shows arrow icon and "Label" text when no filter is active', () => {
    updateLabelFilterOptions([]);
    const btn = document.getElementById('label-filter-btn');
    expect(btn.textContent).toContain('Label');
    expect(btn.querySelector('.toolbar-icon-arrow')).not.toBeNull();
    expect(btn.classList.contains('has-selection')).toBe(false);
  });

  it('shows active label name and clear icon when filter is set', () => {
    state.filter.labelId = 1;
    updateLabelFilterOptions([{ id: 1, name: 'Bug', color: '#f00' }]);
    const btn = document.getElementById('label-filter-btn');
    expect(btn.textContent).toContain('Label: Bug');
    expect(btn.querySelector('.toolbar-icon-clear')).not.toBeNull();
    expect(btn.classList.contains('has-selection')).toBe(true);
  });

  it('shows "No Label" in button when __no_label__ filter is set', () => {
    state.filter.labelId = '__no_label__';
    updateLabelFilterOptions([]);
    const btn = document.getElementById('label-filter-btn');
    expect(btn.textContent).toContain('Label: No Label');
  });

  it('shows "Unknown" for an unrecognized label id', () => {
    state.filter.labelId = 999;
    updateLabelFilterOptions([{ id: 1, name: 'Bug', color: '#f00' }]);
    const btn = document.getElementById('label-filter-btn');
    expect(btn.textContent).toContain('Label: Unknown');
  });

  it('clears filter and calls refresh when clear icon is clicked', () => {
    state.filter.labelId = 1;
    updateLabelFilterOptions([{ id: 1, name: 'Bug', color: '#f00' }]);
    document.querySelector('#label-filter-btn .toolbar-icon-clear').click();
    expect(state.filter.labelId).toBeNull();
    expect(refreshApp).toHaveBeenCalled();
  });

  it('sets filter and hides dropdown when a label option is clicked', () => {
    updateLabelFilterOptions([{ id: 1, name: 'Bug', color: '#f00' }]);
    const bugOption = document.querySelectorAll('#label-filter-options .custom-option')[1];
    bugOption.click();
    expect(state.filter.labelId).toBe(1);
    expect(document.getElementById('label-filter-options').classList.contains('hidden')).toBe(true);
    expect(refreshApp).toHaveBeenCalled();
  });

  it('sets __no_label__ filter when "No Label" option is clicked', () => {
    updateLabelFilterOptions([]);
    document.querySelector('#label-filter-options .custom-option').click();
    expect(state.filter.labelId).toBe('__no_label__');
  });

  it('toggles dropdown on button click', () => {
    const optionsDiv = document.getElementById('label-filter-options');
    const btn = document.getElementById('label-filter-btn');
    expect(optionsDiv.classList.contains('hidden')).toBe(true);
    btn.click();
    expect(optionsDiv.classList.contains('hidden')).toBe(false);
    btn.click();
    expect(optionsDiv.classList.contains('hidden')).toBe(true);
  });

  it('closes dropdown on outside click', () => {
    const optionsDiv = document.getElementById('label-filter-options');
    optionsDiv.classList.remove('hidden');
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(optionsDiv.classList.contains('hidden')).toBe(true);
  });
});

// ─── Priority Filter (toolbar) ─────────────────────────────────────────────────

describe('Priority Filter', () => {
  let refreshApp;

  beforeEach(() => {
    state.filter.priority = null;
    refreshApp = vi.fn();
    document.body.innerHTML = `
      <div id="priority-filter-wrapper">
        <button id="priority-filter-btn"></button>
        <div id="priority-filter-options" class="hidden"></div>
      </div>
      <div id="label-filter-options" class="hidden"></div>
    `;
    initPriorityFilter(refreshApp);
  });

  it('populates Normal and High options', () => {
    const opts = document.querySelectorAll('#priority-filter-options .custom-option');
    expect(opts).toHaveLength(2);
    expect(opts[0].textContent).toBe('Normal');
    expect(opts[1].textContent).toBe('High');
  });

  it('shows arrow icon and "Priority" text when no filter is active', () => {
    const btn = document.getElementById('priority-filter-btn');
    expect(btn.textContent).toContain('Priority');
    expect(btn.querySelector('.toolbar-icon-arrow')).not.toBeNull();
    expect(btn.classList.contains('has-selection')).toBe(false);
  });

  it('shows active priority and clear icon when filter is set', () => {
    state.filter.priority = 'High';
    updatePriorityFilterOptions();
    const btn = document.getElementById('priority-filter-btn');
    expect(btn.textContent).toContain('Priority: High');
    expect(btn.querySelector('.toolbar-icon-clear')).not.toBeNull();
    expect(btn.classList.contains('has-selection')).toBe(true);
  });

  it('clears filter and calls refresh when clear icon is clicked', () => {
    state.filter.priority = 'High';
    updatePriorityFilterOptions();
    document.querySelector('#priority-filter-btn .toolbar-icon-clear').click();
    expect(state.filter.priority).toBeNull();
    expect(refreshApp).toHaveBeenCalled();
  });

  it('sets filter and hides dropdown when an option is clicked', () => {
    const normalOpt = document.querySelector('#priority-filter-options .custom-option');
    normalOpt.click();
    expect(state.filter.priority).toBe('Normal');
    expect(document.getElementById('priority-filter-options').classList.contains('hidden')).toBe(true);
    expect(refreshApp).toHaveBeenCalled();
  });

  it('toggles dropdown on button click', () => {
    const optionsDiv = document.getElementById('priority-filter-options');
    const btn = document.getElementById('priority-filter-btn');
    expect(optionsDiv.classList.contains('hidden')).toBe(true);
    btn.click();
    expect(optionsDiv.classList.contains('hidden')).toBe(false);
    btn.click();
    expect(optionsDiv.classList.contains('hidden')).toBe(true);
  });

  it('closes the label dropdown when priority dropdown is opened', () => {
    const labelOpts = document.getElementById('label-filter-options');
    labelOpts.classList.remove('hidden');
    document.getElementById('priority-filter-btn').click();
    expect(labelOpts.classList.contains('hidden')).toBe(true);
  });

  it('closes dropdown on outside click', () => {
    const optionsDiv = document.getElementById('priority-filter-options');
    optionsDiv.classList.remove('hidden');
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(optionsDiv.classList.contains('hidden')).toBe(true);
  });
});

// ─── User Filter (toolbar) ─────────────────────────────────────────────────────

describe('User Filter', () => {
  let refreshApp;
  const mockUsers = [
    { id: 1, first_name: 'Alice', last_name: 'Smith', active: true },
    { id: 2, first_name: 'Bob', last_name: 'Jones', active: false },
    { id: 3, first_name: 'Carol', last_name: 'White', active: true },
  ];

  beforeEach(() => {
    state.filter.assigneeId = null;
    refreshApp = vi.fn();
    document.body.innerHTML = `
      <div id="user-filter-wrapper">
        <button id="user-filter-btn"></button>
        <div id="user-filter-options" class="hidden"></div>
      </div>
    `;
    initUserFilter(refreshApp);
  });

  it('populates My Issues, Unassigned, and active users only', () => {
    updateUserFilterOptions(mockUsers);
    const opts = document.querySelectorAll('#user-filter-options .custom-option');
    // My Issues + Unassigned + Alice + Carol (Bob is inactive)
    expect(opts).toHaveLength(4);
    expect(opts[0].textContent).toBe('My Issues');
    expect(opts[1].textContent).toBe('Unassigned');
    expect(opts[2].textContent).toBe('Alice Smith');
    expect(opts[3].textContent).toBe('Carol White');
  });

  it('shows arrow icon and "Assignee" text when no filter is active', () => {
    updateUserFilterOptions([]);
    const btn = document.getElementById('user-filter-btn');
    expect(btn.textContent).toContain('Assignee');
    expect(btn.querySelector('.toolbar-icon-arrow')).not.toBeNull();
    expect(btn.classList.contains('has-selection')).toBe(false);
  });

  it('shows "Assignee: My Issues" when filter is set to "me"', () => {
    state.filter.assigneeId = 'me';
    updateUserFilterOptions([]);
    expect(document.getElementById('user-filter-btn').textContent).toContain('Assignee: My Issues');
  });

  it('shows "Assignee: Unassigned" when filter is set to "unassigned"', () => {
    state.filter.assigneeId = 'unassigned';
    updateUserFilterOptions([]);
    expect(document.getElementById('user-filter-btn').textContent).toContain('Assignee: Unassigned');
  });

  it('shows user full name when filter is set to a user id', () => {
    state.filter.assigneeId = 1;
    updateUserFilterOptions(mockUsers);
    expect(document.getElementById('user-filter-btn').textContent).toContain('Assignee: Alice Smith');
  });

  it('shows has-selection class and clear icon when filter is active', () => {
    state.filter.assigneeId = 'me';
    updateUserFilterOptions([]);
    const btn = document.getElementById('user-filter-btn');
    expect(btn.classList.contains('has-selection')).toBe(true);
    expect(btn.querySelector('.toolbar-icon-clear')).not.toBeNull();
  });

  it('clears filter and calls refresh when clear icon is clicked', () => {
    state.filter.assigneeId = 'me';
    updateUserFilterOptions([]);
    document.querySelector('#user-filter-btn .toolbar-icon-clear').click();
    expect(state.filter.assigneeId).toBeNull();
    expect(refreshApp).toHaveBeenCalled();
  });

  it('sets filter and hides dropdown when an option is clicked', () => {
    updateUserFilterOptions(mockUsers);
    document.querySelector('#user-filter-options .custom-option').click(); // My Issues
    expect(state.filter.assigneeId).toBe('me');
    expect(document.getElementById('user-filter-options').classList.contains('hidden')).toBe(true);
    expect(refreshApp).toHaveBeenCalled();
  });

  it('toggles dropdown on button click', () => {
    const optionsDiv = document.getElementById('user-filter-options');
    const btn = document.getElementById('user-filter-btn');
    expect(optionsDiv.classList.contains('hidden')).toBe(true);
    btn.click();
    expect(optionsDiv.classList.contains('hidden')).toBe(false);
  });

  it('closes dropdown on outside click', () => {
    const optionsDiv = document.getElementById('user-filter-options');
    optionsDiv.classList.remove('hidden');
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(optionsDiv.classList.contains('hidden')).toBe(true);
  });
});

// ─── Project Selector (toolbar) ────────────────────────────────────────────────

describe('Project Selector', () => {
  let onProjectChange;
  const projects = [
    { id: 1, name: 'Alpha' },
    { id: 2, name: 'Beta' },
  ];

  beforeEach(() => {
    localStorage.removeItem('wuflow_selectedProjectId');
    state.selectedProjectId = null;
    onProjectChange = vi.fn();
    document.body.innerHTML = `
      <div id="project-selector-wrapper">
        <button id="project-selector-btn">
          <span id="project-selector-text">All Projects</span>
        </button>
        <div id="project-selector-options" class="hidden"></div>
      </div>
    `;
    initProjectSelector(onProjectChange);
  });

  afterEach(() => {
    state.selectedProjectId = null;
    localStorage.removeItem('wuflow_selectedProjectId');
  });

  it('auto-selects the first project when none is selected', () => {
    updateProjectSelectorOptions(projects);
    expect(state.selectedProjectId).toBe(1);
    expect(onProjectChange).toHaveBeenCalled();
  });

  it('renders one option per project', () => {
    state.selectedProjectId = 1;
    updateProjectSelectorOptions(projects);
    const opts = document.querySelectorAll('#project-selector-options .custom-option');
    expect(opts).toHaveLength(2);
    expect(opts[0].textContent).toBe('Alpha');
    expect(opts[1].textContent).toBe('Beta');
  });

  it('marks the currently selected project with "selected" class', () => {
    state.selectedProjectId = 2;
    updateProjectSelectorOptions(projects);
    const opts = document.querySelectorAll('#project-selector-options .custom-option');
    expect(opts[0].classList.contains('selected')).toBe(false);
    expect(opts[1].classList.contains('selected')).toBe(true);
  });

  it('updates the button label to match the selected project', () => {
    state.selectedProjectId = 2;
    updateProjectSelectorOptions(projects);
    expect(document.getElementById('project-selector-text').textContent).toBe('Beta');
  });

  it('shows "Select Project" when no projects are provided', () => {
    state.selectedProjectId = null;
    updateProjectSelectorOptions([]);
    expect(document.getElementById('project-selector-text').textContent).toBe('Select Project');
  });

  it('resets to first project when current selection is no longer valid', () => {
    state.selectedProjectId = 99;
    updateProjectSelectorOptions(projects);
    expect(state.selectedProjectId).toBe(1);
    expect(onProjectChange).toHaveBeenCalled();
  });

  it('sets selectedProjectId to null when invalid and no projects available', () => {
    state.selectedProjectId = 99;
    updateProjectSelectorOptions([]);
    expect(state.selectedProjectId).toBeNull();
  });

  it('changes selected project and hides dropdown on option click', () => {
    state.selectedProjectId = 1;
    updateProjectSelectorOptions(projects);
    const opts = document.querySelectorAll('#project-selector-options .custom-option');
    opts[1].click(); // click Beta
    expect(state.selectedProjectId).toBe(2);
    expect(document.getElementById('project-selector-options').classList.contains('hidden')).toBe(true);
    expect(onProjectChange).toHaveBeenCalled();
  });

  it('toggles dropdown on button click', () => {
    const optionsDiv = document.getElementById('project-selector-options');
    const btn = document.getElementById('project-selector-btn');
    expect(optionsDiv.classList.contains('hidden')).toBe(true);
    btn.click();
    expect(optionsDiv.classList.contains('hidden')).toBe(false);
  });

  it('closes dropdown on outside click', () => {
    const optionsDiv = document.getElementById('project-selector-options');
    optionsDiv.classList.remove('hidden');
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(optionsDiv.classList.contains('hidden')).toBe(true);
  });

  it('restores selected project from localStorage on init', () => {
    localStorage.setItem('wuflow_selectedProjectId', '2');
    state.selectedProjectId = null;
    initProjectSelector(vi.fn());
    expect(state.selectedProjectId).toBe(2);
  });
});

// ─── User Menu (toolbar) ───────────────────────────────────────────────────────

const TEST_PW_VALID = 'T3st-P@ssw0rd!';
const TEST_PW_WEAK  = 'weak';
const TEST_PW_BAD   = 'bad';

describe('User Menu', () => {
  const mockUser = { email: 'alice@example.com', role: 'admin', first_name: 'Alice', last_name: 'Smith' };

  beforeEach(() => {
    document.body.innerHTML = `
      <button id="user-menu-btn"><span id="current-user-email"></span></button>
      <div id="user-menu-dropdown" class="hidden">
        <button id="user-menu-password">Password</button>
        <button id="user-menu-logout">Logout</button>
      </div>
      <div id="password-modal" class="hidden">
        <form id="password-form">
          <input type="password" id="new-password">
          <div id="password-modal-error" class="hidden"></div>
          <button type="button" id="password-cancel-btn">Cancel</button>
          <button type="submit">Save</button>
        </form>
      </div>
    `;
  });

  it('renders user initials badge and email in the menu button', () => {
    setupUserMenu(mockUser);
    const emailSpan = document.getElementById('current-user-email');
    expect(emailSpan.querySelector('.user-badge')).not.toBeNull();
    expect(emailSpan.textContent).toContain('alice@example.com');
    expect(emailSpan.textContent).toContain('admin');
  });

  it('toggles dropdown visibility on user menu button click', () => {
    setupUserMenu(mockUser);
    const btn = document.getElementById('user-menu-btn');
    const dropdown = document.getElementById('user-menu-dropdown');
    expect(dropdown.classList.contains('hidden')).toBe(true);
    btn.click();
    expect(dropdown.classList.contains('hidden')).toBe(false);
    btn.click();
    expect(dropdown.classList.contains('hidden')).toBe(true);
  });

  it('closes dropdown on outside click', () => {
    setupUserMenu(mockUser);
    const dropdown = document.getElementById('user-menu-dropdown');
    dropdown.classList.remove('hidden');
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(dropdown.classList.contains('hidden')).toBe(true);
  });

  it('calls logout when logout button is clicked', async () => {
    const { logout } = await import('../api.js');
    setupUserMenu(mockUser);
    document.getElementById('user-menu-logout').click();
    expect(logout).toHaveBeenCalled();
  });

  it('hides dropdown and opens password modal when password button is clicked', () => {
    setupUserMenu(mockUser);
    const dropdown = document.getElementById('user-menu-dropdown');
    dropdown.classList.remove('hidden');
    document.getElementById('user-menu-password').click();
    expect(dropdown.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('password-modal').classList.contains('hidden')).toBe(false);
  });

  it('hides password modal and resets form on cancel', () => {
    setupUserMenu(mockUser);
    const modal = document.getElementById('password-modal');
    modal.classList.remove('hidden');
    document.getElementById('password-cancel-btn').click();
    expect(modal.classList.contains('hidden')).toBe(true);
  });

  it('clears error and shows modal when password modal is opened', () => {
    setupUserMenu(mockUser);
    const errorDisplay = document.getElementById('password-modal-error');
    errorDisplay.textContent = 'Old error';
    errorDisplay.classList.remove('hidden');

    document.getElementById('user-menu-password').click();
    expect(errorDisplay.textContent).toBe('');
    expect(errorDisplay.classList.contains('hidden')).toBe(true);
  });

  it('submits password form successfully, hides modal and schedules logout', async () => {
    vi.useFakeTimers();
    const { logout } = await import('../api.js');
    const { showNotification } = await import('../utils.js');
    logout.mockClear();
    showNotification.mockClear();

    setupUserMenu(mockUser);
    document.getElementById('new-password').value = TEST_PW_VALID;
    document.getElementById('password-form').dispatchEvent(new Event('submit'));

    await Promise.resolve(); // flush microtasks so the async handler completes

    expect(showNotification).toHaveBeenCalledWith('Password updated successfully. Logging out...');
    expect(document.getElementById('password-modal').classList.contains('hidden')).toBe(true);

    vi.runAllTimers(); // advance past the 1500 ms timeout
    expect(logout).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('shows inline error when password validation fails', async () => {
    const { validatePasswordPolicy } = await import('../components/system-settings.js');
    validatePasswordPolicy.mockReturnValueOnce('Password is too weak');

    setupUserMenu(mockUser);
    document.getElementById('new-password').value = TEST_PW_WEAK;
    document.getElementById('password-form').dispatchEvent(new Event('submit'));

    await Promise.resolve();

    const errorDisplay = document.getElementById('password-modal-error');
    expect(errorDisplay.textContent).toBe('Password is too weak');
    expect(errorDisplay.classList.contains('hidden')).toBe(false);
  });

  it('falls back to showNotification when error display element is absent', async () => {
    const { validatePasswordPolicy } = await import('../components/system-settings.js');
    const { showNotification } = await import('../utils.js');
    validatePasswordPolicy.mockReturnValueOnce('Some policy error');
    showNotification.mockClear();

    setupUserMenu(mockUser);
    document.getElementById('password-modal-error').remove();

    document.getElementById('new-password').value = TEST_PW_BAD;
    document.getElementById('password-form').dispatchEvent(new Event('submit'));

    await Promise.resolve();

    expect(showNotification).toHaveBeenCalledWith('Some policy error', 'error');
  });
});

// ─── Release Filter (toolbar) ──────────────────────────────────────────────────

describe('Release Filter', () => {
  let refreshApp;
  const releases = [
    { id: 1, name: 'v1.0' },
    { id: 2, name: 'v2.0' },
  ];

  beforeEach(() => {
    state.filter.releaseId = null;
    refreshApp = vi.fn();
    document.body.innerHTML = `
      <div id="release-filter-wrapper">
        <button id="release-filter-btn"></button>
        <div id="release-filter-options" class="hidden"></div>
      </div>
    `;
    initReleaseFilter(refreshApp);
  });

  afterEach(() => {
    setFilterRelease(null);
  });

  it('populates "No Release" option plus all release options', () => {
    updateReleaseFilterOptions(releases);
    const opts = document.querySelectorAll('#release-filter-options .custom-option');
    expect(opts).toHaveLength(3);
    expect(opts[0].textContent).toBe('No Release');
    expect(opts[1].textContent).toBe('v1.0');
    expect(opts[2].textContent).toBe('v2.0');
  });

  it('shows arrow icon and "Release" text when no filter is active', () => {
    updateReleaseFilterOptions([]);
    const btn = document.getElementById('release-filter-btn');
    expect(btn.textContent).toContain('Release');
    expect(btn.querySelector('.toolbar-icon-arrow')).not.toBeNull();
    expect(btn.classList.contains('has-selection')).toBe(false);
  });

  it('shows active release name and clear icon when filter is set', () => {
    state.filter.releaseId = 1;
    updateReleaseFilterOptions(releases);
    const btn = document.getElementById('release-filter-btn');
    expect(btn.textContent).toContain('Release: v1.0');
    expect(btn.querySelector('.toolbar-icon-clear')).not.toBeNull();
    expect(btn.classList.contains('has-selection')).toBe(true);
  });

  it('shows "No Release" in button when __no_release__ filter is set', () => {
    state.filter.releaseId = '__no_release__';
    updateReleaseFilterOptions([]);
    const btn = document.getElementById('release-filter-btn');
    expect(btn.textContent).toContain('Release: No Release');
  });

  it('shows "Unknown" for an unrecognized release id', () => {
    state.filter.releaseId = 999;
    updateReleaseFilterOptions(releases);
    const btn = document.getElementById('release-filter-btn');
    expect(btn.textContent).toContain('Release: Unknown');
  });

  it('clears filter and calls refresh when clear icon is clicked', () => {
    state.filter.releaseId = 1;
    updateReleaseFilterOptions(releases);
    document.querySelector('#release-filter-btn .toolbar-icon-clear').click();
    expect(state.filter.releaseId).toBeNull();
    expect(refreshApp).toHaveBeenCalled();
  });

  it('sets filter and hides dropdown when a release option is clicked', () => {
    updateReleaseFilterOptions(releases);
    const opts = document.querySelectorAll('#release-filter-options .custom-option');
    opts[1].click(); // v1.0
    expect(state.filter.releaseId).toBe(1);
    expect(document.getElementById('release-filter-options').classList.contains('hidden')).toBe(true);
    expect(refreshApp).toHaveBeenCalled();
  });

  it('sets __no_release__ filter when "No Release" option is clicked', () => {
    updateReleaseFilterOptions([]);
    document.querySelector('#release-filter-options .custom-option').click();
    expect(state.filter.releaseId).toBe('__no_release__');
  });

  it('toggles dropdown on button click', () => {
    const optionsDiv = document.getElementById('release-filter-options');
    const btn = document.getElementById('release-filter-btn');
    expect(optionsDiv.classList.contains('hidden')).toBe(true);
    btn.click();
    expect(optionsDiv.classList.contains('hidden')).toBe(false);
    btn.click();
    expect(optionsDiv.classList.contains('hidden')).toBe(true);
  });

  it('closes dropdown on outside click', () => {
    const optionsDiv = document.getElementById('release-filter-options');
    optionsDiv.classList.remove('hidden');
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(optionsDiv.classList.contains('hidden')).toBe(true);
  });
});
