import { state, setFilterLabel, setFilterPriority, setFilterAssignee, setFilterRelease, setFilterReleaseOwner, setSelectedProject } from '../state.ts';
import type { Filter, UserFilter } from '../state.ts';
import type { Label, Project, Release, User } from '../models.ts';
import type { Priority } from '../domain-constants.ts';
import { PRIORITY_OPTIONS, RELEASE_STATUS_CLOSED } from '../domain-constants.ts';
import { logout, updateCurrentUser } from '../api.ts';
import { byId, showNotification, getUserInitials, onGuardedSubmit } from '../utils.ts';
import { validatePasswordPolicy } from './system-settings.ts';

// Updates a filter button to show the active selection (with a clear ×) or the default state (with ▼).
function updateFilterButtonState(btn: HTMLElement, defaultText: string, selectedText: string | null, clearHandler: () => void) {
  btn.innerHTML = '';
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

// ─── Label Filter ──────────────────────────────────────────────────────────────

let labelRefreshCallback: (() => unknown) | undefined;

export function initLabelFilter(refreshApp: () => unknown) {
  labelRefreshCallback = refreshApp;

  const labelFilterContainer = byId('label-filter-wrapper');
  const labelFilterBtn = byId('label-filter-btn');
  const labelFilterOptions = byId('label-filter-options');

  labelFilterBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    labelFilterOptions.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!(e.target instanceof Node && labelFilterContainer.contains(e.target))) {
      labelFilterOptions.classList.add('hidden');
    }
  });
}

export function updateLabelFilterOptions(labels: Label[]) {
  const labelFilterBtn = byId('label-filter-btn');
  const labelFilterOptions = byId('label-filter-options');
  const currentVal = state.filter.labelId;

  labelFilterOptions.innerHTML = '';

  const noLabelOption = createLabelOption('No Label', '__no_label__');
  labelFilterOptions.appendChild(noLabelOption);

  labels.forEach(label => {
    const option = createLabelOption(label.name, label.id);
    labelFilterOptions.appendChild(option);
  });

  let labelSelectedText: string | null = null;
  if (currentVal != null) {
    const labelText = currentVal === '__no_label__' ? 'No Label' : (labels.find(l => l.id === currentVal)?.name ?? 'Unknown');
    labelSelectedText = `Label: ${labelText}`;
  }
  updateFilterButtonState(labelFilterBtn, 'Label', labelSelectedText, () => {
    setFilterLabel(null);
    if (labelRefreshCallback) labelRefreshCallback();
  });
}

function createLabelOption(text: string, value: Filter['labelId']) {
  const div = document.createElement('div');
  div.className = 'custom-option';
  div.textContent = text;
  div.addEventListener('click', () => {
    setFilterLabel(value || null);
    byId('label-filter-options').classList.add('hidden');
    if (labelRefreshCallback) labelRefreshCallback();
  });
  return div;
}

// ─── Priority Filter ───────────────────────────────────────────────────────────

let priorityRefreshCallback: (() => unknown) | undefined;

export function initPriorityFilter(refreshApp: () => unknown) {
  priorityRefreshCallback = refreshApp;

  const priorityFilterContainer = byId('priority-filter-wrapper');
  const priorityFilterBtn = byId('priority-filter-btn');
  const priorityFilterOptions = byId('priority-filter-options');

  priorityFilterBtn.addEventListener('click', (e) => {
    e.stopPropagation();

    const labelOpts = document.getElementById('label-filter-options');
    if (labelOpts) labelOpts.classList.add('hidden');

    priorityFilterOptions.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!(e.target instanceof Node && priorityFilterContainer.contains(e.target))) {
      priorityFilterOptions.classList.add('hidden');
    }
  });

  updatePriorityFilterOptions();
}

export function updatePriorityFilterOptions() {
  const priorityFilterBtn = byId('priority-filter-btn');
  const priorityFilterOptions = byId('priority-filter-options');
  const currentVal = state.filter.priority;

  priorityFilterOptions.innerHTML = '';

  const priorities = PRIORITY_OPTIONS;

  priorities.forEach(prio => {
    const option = createPriorityOption(prio.text, prio.value);
    priorityFilterOptions.appendChild(option);
  });

  updateFilterButtonState(priorityFilterBtn, 'Priority', currentVal ? `Priority: ${currentVal}` : null, () => {
    setFilterPriority(null);
    updatePriorityFilterOptions();
    if (priorityRefreshCallback) priorityRefreshCallback();
  });
}

function createPriorityOption(text: string, value: Priority) {
  const div = document.createElement('div');
  div.className = 'custom-option';
  div.textContent = text;
  div.addEventListener('click', () => {
    setFilterPriority(value);
    byId('priority-filter-options').classList.add('hidden');
    updatePriorityFilterOptions();
    if (priorityRefreshCallback) priorityRefreshCallback();
  });
  return div;
}

// ─── User Filter ───────────────────────────────────────────────────────────────

let userRefreshCallback: (() => unknown) | undefined;

export function initUserFilter(refreshApp: () => unknown) {
  userRefreshCallback = refreshApp;

  const userFilterContainer = byId('user-filter-wrapper');
  const userFilterBtn = byId('user-filter-btn');
  const userFilterOptions = byId('user-filter-options');

  userFilterBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    userFilterOptions.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!(e.target instanceof Node && userFilterContainer.contains(e.target))) {
      userFilterOptions.classList.add('hidden');
    }
  });
}

function resolveFilterLabel(currentVal: UserFilter, users: User[], myLabel: string, unassignedLabel: string) {
  if (currentVal === 'me') return myLabel;
  if (currentVal === 'unassigned') return unassignedLabel;
  const user = users.find(u => u.id === currentVal);
  return user ? `${user.first_name} ${user.last_name}` : 'User';
}

export function updateUserFilterOptions(users: User[], context: 'issues' | 'releases' = 'issues') {
  const userFilterBtn = byId('user-filter-btn');
  const userFilterOptions = byId('user-filter-options');
  const isReleases = context === 'releases';
  const currentVal = isReleases ? state.filter.releaseOwnerFilter : state.filter.assigneeId;
  const setFilter = isReleases ? setFilterReleaseOwner : setFilterAssignee;
  const myLabel = isReleases ? 'My Releases' : 'My Issues';
  const unassignedLabel = isReleases ? 'No Owner' : 'Unassigned';
  const buttonLabel = isReleases ? 'Owner' : 'Assignee';

  userFilterOptions.innerHTML = '';

  const myIssuesOption = createUserOption(myLabel, 'me', setFilter);
  userFilterOptions.appendChild(myIssuesOption);

  const unassignedOption = createUserOption(unassignedLabel, 'unassigned', setFilter);
  userFilterOptions.appendChild(unassignedOption);

  users.filter(u => u.active).forEach(user => {
    const option = createUserOption(`${user.first_name} ${user.last_name}`, user.id, setFilter);
    userFilterOptions.appendChild(option);
  });

  const userSelectedText = currentVal == null
    ? null
    : `${buttonLabel}: ${resolveFilterLabel(currentVal, users, myLabel, unassignedLabel)}`;
  updateFilterButtonState(userFilterBtn, buttonLabel, userSelectedText, () => {
    setFilter(null);
    if (userRefreshCallback) userRefreshCallback();
  });
}

function createUserOption(text: string, value: UserFilter, setFilter: (value: UserFilter | null) => void) {
  const div = document.createElement('div');
  div.className = 'custom-option';
  div.textContent = text;
  div.addEventListener('click', () => {
    setFilter(value);
    byId('user-filter-options').classList.add('hidden');
    if (userRefreshCallback) userRefreshCallback();
  });
  return div;
}

// ─── Release Filter ────────────────────────────────────────────────────────────

let releaseRefreshCallback: (() => unknown) | undefined;

export function initReleaseFilter(refreshApp: () => unknown) {
  releaseRefreshCallback = refreshApp;

  const releaseFilterContainer = byId('release-filter-wrapper');
  const releaseFilterBtn = byId('release-filter-btn');
  const releaseFilterOptions = byId('release-filter-options');

  releaseFilterBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    releaseFilterOptions.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!(e.target instanceof Node && releaseFilterContainer.contains(e.target))) {
      releaseFilterOptions.classList.add('hidden');
    }
  });
}

export function updateReleaseFilterOptions(releases: Release[]) {
  const releaseFilterBtn = byId('release-filter-btn');
  const releaseFilterOptions = byId('release-filter-options');
  const currentVal = state.filter.releaseId;

  releaseFilterOptions.innerHTML = '';

  const noReleaseOption = createReleaseOption('No Release', '__no_release__');
  releaseFilterOptions.appendChild(noReleaseOption);

  releases.filter(r => r.status !== RELEASE_STATUS_CLOSED).sort((a, b) => a.name.localeCompare(b.name)).forEach(release => {
    const option = createReleaseOption(release.name, release.id);
    releaseFilterOptions.appendChild(option);
  });

  let releaseSelectedText: string | null = null;
  if (currentVal != null) {
    const releaseText = currentVal === '__no_release__' ? 'No Release' : (releases.find(r => r.id === currentVal)?.name ?? 'Unknown');
    releaseSelectedText = `Release: ${releaseText}`;
  }
  updateFilterButtonState(releaseFilterBtn, 'Release', releaseSelectedText, () => {
    setFilterRelease(null);
    if (releaseRefreshCallback) releaseRefreshCallback();
  });
}

function createReleaseOption(text: string, value: Filter['releaseId']) {
  const div = document.createElement('div');
  div.className = 'custom-option';
  div.textContent = text;
  div.addEventListener('click', () => {
    setFilterRelease(value);
    byId('release-filter-options').classList.add('hidden');
    if (releaseRefreshCallback) releaseRefreshCallback();
  });
  return div;
}

// ─── Project Selector ──────────────────────────────────────────────────────────

let _onProjectChange: (() => unknown) | null = null;

export function initProjectSelector(onProjectChange: () => unknown) {
  _onProjectChange = onProjectChange;

  const btn = document.getElementById('project-selector-btn');
  const optionsDiv = document.getElementById('project-selector-options');

  if (!btn || !optionsDiv) return;

  // Restore last selected project from browser storage
  const stored = localStorage.getItem('wuflow_selectedProjectId');
  if (stored !== null) {
    const id = Number.parseInt(stored, 10);
    if (!Number.isNaN(id)) {
      setSelectedProject(id);
    }
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    optionsDiv.classList.toggle('hidden');
  });

  document.addEventListener('click', () => {
    optionsDiv.classList.add('hidden');
  });
}

export function updateProjectSelectorOptions(projects: Project[]) {
  const btn = document.getElementById('project-selector-btn');
  const optionsDiv = document.getElementById('project-selector-options');

  if (!btn || !optionsDiv) return;

  optionsDiv.innerHTML = '';

  if (state.selectedProjectId === null && projects && projects.length > 0) {
    setSelectedProject(projects[0].id);
    localStorage.setItem('wuflow_selectedProjectId', String(projects[0].id));
    if (_onProjectChange) _onProjectChange();
  } else if (state.selectedProjectId !== null && projects && !projects.some(p => p.id === state.selectedProjectId)) {
    const fallback = projects.length > 0 ? projects[0].id : null;
    setSelectedProject(fallback);
    if (fallback === null) {
      localStorage.removeItem('wuflow_selectedProjectId');
    } else {
      localStorage.setItem('wuflow_selectedProjectId', String(fallback));
    }
    if (_onProjectChange) _onProjectChange();
  }

  (projects || []).forEach(project => {
    const option = document.createElement('div');
    option.className = 'custom-option' + (state.selectedProjectId === project.id ? ' selected' : '');
    option.dataset.value = String(project.id);
    option.textContent = project.name;
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

  const current = (projects || []).find(p => p.id === state.selectedProjectId);
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
  const userMenuBtn = document.getElementById('user-menu-btn');
  const userMenuDropdown = byId('user-menu-dropdown');
  const userEmailSpan = document.getElementById('current-user-email');
  const logoutBtn = document.getElementById('user-menu-logout');
  const passwordBtn = document.getElementById('user-menu-password');

  if (userEmailSpan) {
    const initials = getUserInitials(user);
    const badge = document.createElement('div');
    badge.className = 'user-badge';
    badge.textContent = initials;

    userEmailSpan.innerHTML = '';
    userEmailSpan.style.display = 'flex';
    userEmailSpan.style.alignItems = 'center';
    userEmailSpan.style.gap = '8px';
    userEmailSpan.appendChild(badge);
    userEmailSpan.appendChild(document.createTextNode(`${user.email} (${user.role})`));
  }

  if (userMenuBtn && userMenuDropdown) {
    userMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      userMenuDropdown.classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
      const inside = e.target instanceof Node && (userMenuBtn.contains(e.target) || userMenuDropdown.contains(e.target));
      if (!inside) {
        userMenuDropdown.classList.add('hidden');
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      void logout();
    });
  }

  if (passwordBtn) {
    passwordBtn.addEventListener('click', () => {
      userMenuDropdown.classList.add('hidden');
      openPasswordModal();
    });
  }

  setupPasswordModal(user);
}

function setupPasswordModal(user: User) {
  const modal = document.getElementById('password-modal');
  const form = document.getElementById('password-form');
  const cancelBtn = document.getElementById('password-cancel-btn');

  if (!modal || !(form instanceof HTMLFormElement) || !cancelBtn) return;

  cancelBtn.addEventListener('click', () => {
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

      const pwError = validatePasswordPolicy(newPassword, user ? user.email : '');
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
      const errorDisplay = document.getElementById('password-modal-error');
      if (errorDisplay) {
        errorDisplay.textContent = err.message;
        errorDisplay.classList.remove('hidden');
      } else {
        showNotification(err.message, 'error');
      }
    }
  });
}

function openPasswordModal() {
  const modal = document.getElementById('password-modal');
  const errorDisplay = document.getElementById('password-modal-error');

  if (modal) {
    if (errorDisplay) {
      errorDisplay.textContent = '';
      errorDisplay.classList.add('hidden');
    }

    const usernameField = document.getElementById('password-form-username');
    if (usernameField instanceof HTMLInputElement && state.currentUser) {
      usernameField.value = state.currentUser.email || '';
    }

    modal.classList.remove('hidden');
    byId('current-password').focus();
  }
}
