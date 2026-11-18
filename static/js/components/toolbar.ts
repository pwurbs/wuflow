import { state, setFilterLabel, setFilterPriority, setFilterAssignee, setFilterRelease, setFilterReleaseOwner, setSelectedProject } from '../state.ts';
import type { Filter, UserFilter } from '../state.ts';
import type { Label, Project, Release, User } from '../models.ts';
import type { Priority } from '../domain-constants.ts';
import type { RefreshApp, RerenderView } from '../list-utils.ts';
import { PRIORITY_OPTIONS, RELEASE_STATUS_CLOSED } from '../domain-constants.ts';
import { logout, updateCurrentUser } from '../api.ts';
import { byId, showNotification, getUserInitials, onGuardedSubmit, errorMessage, containsTarget, sortByName } from '../utils.ts';
import { validatePasswordPolicy } from './system-settings.ts';

// Updates a filter button to show the active selection (with a clear ×) or the default state (with ▼).
// The accessible name contains the visible text (WCAG 2.5.3), so it follows the button's text.
function updateFilterButtonState(btn: HTMLElement, defaultText: string, selectedText: string | null, clearHandler: () => void) {
  btn.innerHTML = '';
  btn.setAttribute('aria-label', selectedText ?? `Filter by ${defaultText}`);
  if (selectedText == null) {
    const textSpan = document.createElement('span');
    textSpan.textContent = defaultText;
    btn.appendChild(textSpan);

    const arrowIcon = document.createElement('span');
    arrowIcon.className = 'toolbar-icon-arrow';
    arrowIcon.innerHTML = '▼';
    btn.appendChild(arrowIcon);
    btn.classList.remove('has-selection');
  } else {
    const textSpan = document.createElement('span');
    textSpan.textContent = selectedText;
    btn.appendChild(textSpan);

    const clearIcon = document.createElement('span');
    clearIcon.className = 'toolbar-icon-clear';
    clearIcon.innerHTML = '&times;';
    clearIcon.title = 'Clear filter';
    clearIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      clearHandler();
    });

    btn.appendChild(clearIcon);
    btn.classList.add('has-selection');
  }
}

// Toolbar dropdowns: the button toggles the list, a click outside the container closes it.
// Opening one list therefore closes every other one.
function bindDropdown(container: HTMLElement, button: HTMLElement, list: HTMLElement) {
  button.addEventListener('click', () => {
    list.classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!containsTarget(container, e.target)) {
      list.classList.add('hidden');
    }
  });
}

// ─── Filters (label, priority, user, release) ──────────────────────────────────
// Each filter is a single-select dropdown with the markup `<name>-filter-wrapper/-btn/-options`.
// The update functions below only build the option list, the dropdown does the rest.

type FilterName = 'label' | 'priority' | 'user' | 'release';

interface FilterOption<V> { value: V; text: string }

interface FilterView<V> {
  label: string;                        // button text without a selection, prefix with one
  options: readonly FilterOption<V>[];
  selected: () => V | null;
  select: (value: V | null) => void;
}

let rerenderFilteredView: RerenderView = () => {};

function createFilterOption(text: string, onPick: () => void) {
  const div = document.createElement('div');
  div.className = 'custom-option';
  div.textContent = text;
  div.title = text;
  div.addEventListener('click', onPick);
  return div;
}

function createFilterDropdown<V extends string | number>(name: FilterName) {
  const list = () => byId(`${name}-filter-options`);

  function apply(view: FilterView<V>, value: V | null) {
    view.select(value);
    render(view);
    rerenderFilteredView();
  }

  function render(view: FilterView<V>) {
    const options = list();
    options.innerHTML = '';
    for (const option of view.options) {
      options.appendChild(createFilterOption(option.text, () => {
        options.classList.add('hidden');
        apply(view, option.value);
      }));
    }
    const selected = view.selected();
    const selectedText = selected == null
      ? null
      : `${view.label}: ${view.options.find(o => o.value === selected)?.text ?? 'Unknown'}`;
    updateFilterButtonState(byId(`${name}-filter-btn`), view.label, selectedText, () => apply(view, null));
  }

  return {
    bind: () => bindDropdown(byId(`${name}-filter-wrapper`), byId(`${name}-filter-btn`), list()),
    render,
  };
}

const labelFilter = createFilterDropdown<NonNullable<Filter['labelId']>>('label');
const priorityFilter = createFilterDropdown<Priority>('priority');
const userFilter = createFilterDropdown<UserFilter>('user');
const releaseFilter = createFilterDropdown<NonNullable<Filter['releaseId']>>('release');

export function initToolbarFilters(rerenderView: RerenderView) {
  rerenderFilteredView = rerenderView;
  for (const filter of [labelFilter, priorityFilter, userFilter, releaseFilter]) filter.bind();
  updatePriorityFilterOptions();
}

export function updateLabelFilterOptions(labels: Label[]) {
  labelFilter.render({
    label: 'Label',
    options: [
      { value: '__no_label__', text: 'No Label' },
      ...sortByName(labels, l => l.name).map(l => ({ value: l.id, text: l.name })),
    ],
    selected: () => state.filter.labelId,
    select: setFilterLabel,
  });
}

export function updatePriorityFilterOptions() {
  priorityFilter.render({
    label: 'Priority',
    options: PRIORITY_OPTIONS,
    selected: () => state.filter.priority,
    select: setFilterPriority,
  });
}

// context 'releases': the same dropdown filters releases by owner.
export function updateUserFilterOptions(users: User[], context: 'issues' | 'releases' = 'issues') {
  const isReleases = context === 'releases';
  const fullName = (u: User) => `${u.first_name} ${u.last_name}`;
  userFilter.render({
    label: isReleases ? 'Owner' : 'Assignee',
    options: [
      { value: 'me', text: isReleases ? 'My Releases' : 'My Issues' },
      { value: 'unassigned', text: isReleases ? 'No Owner' : 'Unassigned' },
      ...sortByName(users.filter(u => u.active), fullName).map(u => ({ value: u.id, text: fullName(u) })),
    ],
    selected: () => isReleases ? state.filter.releaseOwnerFilter : state.filter.assigneeId,
    select: isReleases ? setFilterReleaseOwner : setFilterAssignee,
  });
}

export function updateReleaseFilterOptions(releases: Release[]) {
  releaseFilter.render({
    label: 'Release',
    options: [
      { value: '__no_release__', text: 'No Release' },
      ...sortByName(releases.filter(r => r.status !== RELEASE_STATUS_CLOSED), r => r.name).map(r => ({ value: r.id, text: r.name })),
    ],
    selected: () => state.filter.releaseId,
    select: setFilterRelease,
  });
}

// ─── Search fields ─────────────────────────────────────────────────────────────

// The × of the filter dropdowns for a search field: shown while the field has text, a click empties
// the field and fires `input`, so the field's own search handler runs as on typing.
// Returns the show/hide sync for code that sets the field's value itself.
export function bindSearchClear(input: HTMLInputElement, clear: HTMLElement) {
  const sync = () => clear.classList.toggle('hidden', input.value === '');
  input.addEventListener('input', sync);
  clear.addEventListener('click', () => {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  });
  sync();
  return sync;
}

// ─── Project Selector ──────────────────────────────────────────────────────────

let _onProjectChange: RefreshApp | null = null;

export function initProjectSelector(onProjectChange: RefreshApp) {
  _onProjectChange = onProjectChange;

  // Restore last selected project from browser storage
  const stored = localStorage.getItem('wuflow_selectedProjectId');
  if (stored !== null) {
    const id = Number.parseInt(stored, 10);
    if (!Number.isNaN(id)) {
      setSelectedProject(id);
    }
  }

  bindDropdown(byId('project-selector-wrapper'), byId('project-selector-btn'), byId('project-selector-options'));
}

export function updateProjectSelectorOptions(projects: Project[]) {
  const btn = byId('project-selector-btn');
  const optionsDiv = byId('project-selector-options');

  optionsDiv.innerHTML = '';

  if (state.selectedProjectId === null && projects.length > 0) {
    setSelectedProject(projects[0].id);
    localStorage.setItem('wuflow_selectedProjectId', String(projects[0].id));
    if (_onProjectChange) _onProjectChange();
  } else if (state.selectedProjectId !== null && !projects.some(p => p.id === state.selectedProjectId)) {
    const fallback = projects.length > 0 ? projects[0].id : null;
    setSelectedProject(fallback);
    if (fallback === null) {
      localStorage.removeItem('wuflow_selectedProjectId');
    } else {
      localStorage.setItem('wuflow_selectedProjectId', String(fallback));
    }
    if (_onProjectChange) _onProjectChange();
  }

  // Sorted only for display: the fallback above stays the first project from the server (the default project).
  sortByName(projects, p => p.name).forEach(project => {
    const option = document.createElement('div');
    option.className = 'custom-option' + (state.selectedProjectId === project.id ? ' selected' : '');
    option.dataset.value = String(project.id);
    option.textContent = project.name;
    option.title = project.name;
    option.addEventListener('click', (e) => {
      e.stopPropagation();
      setSelectedProject(project.id);
      localStorage.setItem('wuflow_selectedProjectId', String(project.id));
      updateProjectButtonLabel(btn, project.name);
      optionsDiv.classList.add('hidden');
      if (_onProjectChange) _onProjectChange();
    });
    optionsDiv.appendChild(option);
  });

  const current = projects.find(p => p.id === state.selectedProjectId);
  updateProjectButtonLabel(btn, current ? current.name : 'Select Project');
}

function updateProjectButtonLabel(btn: HTMLElement, projectName: string) {
  const textSpan = btn.querySelector('#project-selector-text');
  if (textSpan) {
    textSpan.textContent = projectName || 'Select Project';
  }
}

// ─── User Menu ─────────────────────────────────────────────────────────────────

export function setupUserMenu(user: User) {
  const userMenuBtn = byId('user-menu-btn');
  const userMenuDropdown = byId('user-menu-dropdown');
  const nameSpan = byId('current-user');

  const badge = document.createElement('div');
  badge.className = 'user-badge';
  badge.textContent = getUserInitials(user);

  // The button shows the full name, the open menu adds email and role.
  const fullName = `${user.first_name} ${user.last_name}`.trim() || user.email;
  const nameText = document.createElement('span');
  nameText.className = 'user-menu-fullname';
  nameText.textContent = fullName;
  nameText.title = fullName;
  nameSpan.replaceChildren(badge, nameText);
  byId('user-menu-identity').textContent = `${user.email} (${user.role})`;

  bindDropdown(byId('user-menu-container'), userMenuBtn, userMenuDropdown);

  byId('user-menu-logout').addEventListener('click', () => {
    void logout();
  });

  byId('user-menu-password').addEventListener('click', () => {
    userMenuDropdown.classList.add('hidden');
    openPasswordModal();
  });

  setupPasswordModal(user);
}

function setupPasswordModal(user: User) {
  const modal = byId('password-modal');
  const form = byId('password-form', HTMLFormElement);

  byId('password-cancel-btn').addEventListener('click', () => {
    modal.classList.add('hidden');
    form.reset();
  });

  onGuardedSubmit(form, async () => {
    const currentPassword = byId('current-password', HTMLInputElement).value;
    const newPassword = byId('new-password', HTMLInputElement).value;
    const confirmNewPassword = byId('confirm-new-password', HTMLInputElement).value;

    try {
      if (newPassword !== confirmNewPassword) {
        throw new Error('New password and confirmation do not match.');
      }

      const pwError = validatePasswordPolicy(newPassword, user.email);
      if (pwError) {
        throw new Error(pwError);
      }

      await updateCurrentUser({ password: newPassword, current_password: currentPassword });
      showNotification('Password updated successfully. Logging out...');
      modal.classList.add('hidden');
      form.reset();

      setTimeout(() => {
        void logout();
      }, 1500);
    } catch (err) {
      const errorDisplay = byId('password-modal-error');
      errorDisplay.textContent = errorMessage(err);
      errorDisplay.classList.remove('hidden');
    }
  });
}

function openPasswordModal() {
  const errorDisplay = byId('password-modal-error');
  errorDisplay.textContent = '';
  errorDisplay.classList.add('hidden');

  if (state.currentUser) {
    byId('password-form-username', HTMLInputElement).value = state.currentUser.email;
  }

  byId('password-modal').classList.remove('hidden');
  byId('current-password').focus();
}
