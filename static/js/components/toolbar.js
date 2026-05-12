import { state, setFilterLabel, setFilterPriority, setFilterAssignee, setFilterRelease, setFilterReleaseOwner, setSelectedProject } from '../state.js';
import { PRIORITY_OPTIONS } from '../domain-constants.js';
import { logout, updateCurrentUser } from '../api.js';
import { showNotification, getUserInitials } from '../utils.js';
import { validatePasswordPolicy } from './system-settings.js';

// ─── Label Filter ──────────────────────────────────────────────────────────────

let labelFilterContainer;
let labelFilterBtn;
let labelFilterOptions;
let labelRefreshCallback;

export function initLabelFilter(refreshApp) {
  labelRefreshCallback = refreshApp;

  labelFilterContainer = document.getElementById('label-filter-wrapper');
  labelFilterBtn = document.getElementById('label-filter-btn');
  labelFilterOptions = document.getElementById('label-filter-options');

  labelFilterBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    labelFilterOptions.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (labelFilterContainer && !labelFilterContainer.contains(e.target)) {
      labelFilterOptions.classList.add('hidden');
    }
  });
}

export function updateLabelFilterOptions(labels) {
  const currentVal = state.filter.labelId;

  labelFilterOptions.innerHTML = '';

  const noLabelOption = createLabelOption('No Label', '__no_label__');
  labelFilterOptions.appendChild(noLabelOption);

  labels.forEach(label => {
    const option = createLabelOption(label.name, label.id);
    labelFilterOptions.appendChild(option);
  });

  labelFilterBtn.innerHTML = '';
  if (currentVal !== null && currentVal !== undefined) {
    let labelText = 'Unknown';
    if (currentVal === '__no_label__') {
      labelText = 'No Label';
    } else {
      const found = labels.find(l => l.id === currentVal);
      if (found) labelText = found.name;
    }

    const textSpan = document.createElement('span');
    textSpan.textContent = `Label: ${labelText}`;
    labelFilterBtn.appendChild(textSpan);

    const clearIcon = document.createElement('span');
    clearIcon.className = 'toolbar-icon-clear';
    clearIcon.innerHTML = '&times;';
    clearIcon.title = 'Clear filter';

    clearIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      setFilterLabel(null);
      if (labelRefreshCallback) labelRefreshCallback();
    });

    labelFilterBtn.appendChild(clearIcon);
    labelFilterBtn.classList.add('has-selection');
  } else {
    const textSpan = document.createElement('span');
    textSpan.textContent = 'Label';
    labelFilterBtn.appendChild(textSpan);

    const arrowIcon = document.createElement('span');
    arrowIcon.className = 'toolbar-icon-arrow';
    arrowIcon.innerHTML = '▼';

    labelFilterBtn.appendChild(arrowIcon);
    labelFilterBtn.classList.remove('has-selection');
  }
}

function createLabelOption(text, value) {
  const div = document.createElement('div');
  div.className = 'custom-option';
  div.textContent = text;
  div.addEventListener('click', () => {
    setFilterLabel(value || null);
    labelFilterOptions.classList.add('hidden');
    if (labelRefreshCallback) labelRefreshCallback();
  });
  return div;
}

// ─── Priority Filter ───────────────────────────────────────────────────────────

let priorityFilterContainer;
let priorityFilterBtn;
let priorityFilterOptions;
let priorityRefreshCallback;

export function initPriorityFilter(refreshApp) {
  priorityRefreshCallback = refreshApp;

  priorityFilterContainer = document.getElementById('priority-filter-wrapper');
  priorityFilterBtn = document.getElementById('priority-filter-btn');
  priorityFilterOptions = document.getElementById('priority-filter-options');

  priorityFilterBtn.addEventListener('click', (e) => {
    e.stopPropagation();

    const labelOpts = document.getElementById('label-filter-options');
    if (labelOpts) labelOpts.classList.add('hidden');

    priorityFilterOptions.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (priorityFilterContainer && !priorityFilterContainer.contains(e.target)) {
      priorityFilterOptions.classList.add('hidden');
    }
  });

  updatePriorityFilterOptions();
}

export function updatePriorityFilterOptions() {
  const currentVal = state.filter.priority;

  priorityFilterOptions.innerHTML = '';

  const priorities = PRIORITY_OPTIONS;

  priorities.forEach(prio => {
    const option = createPriorityOption(prio.text, prio.value);
    priorityFilterOptions.appendChild(option);
  });

  priorityFilterBtn.innerHTML = '';
  if (currentVal) {
    const textSpan = document.createElement('span');
    textSpan.textContent = `Priority: ${currentVal}`;
    priorityFilterBtn.appendChild(textSpan);

    const clearIcon = document.createElement('span');
    clearIcon.className = 'toolbar-icon-clear';
    clearIcon.innerHTML = '&times;';
    clearIcon.title = 'Clear filter';

    clearIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      setFilterPriority(null);
      updatePriorityFilterOptions();
      if (priorityRefreshCallback) priorityRefreshCallback();
    });

    priorityFilterBtn.appendChild(clearIcon);
    priorityFilterBtn.classList.add('has-selection');
  } else {
    const textSpan = document.createElement('span');
    textSpan.textContent = 'Priority';
    priorityFilterBtn.appendChild(textSpan);

    const arrowIcon = document.createElement('span');
    arrowIcon.className = 'toolbar-icon-arrow';
    arrowIcon.innerHTML = '▼';

    priorityFilterBtn.appendChild(arrowIcon);
    priorityFilterBtn.classList.remove('has-selection');
  }
}

function createPriorityOption(text, value) {
  const div = document.createElement('div');
  div.className = 'custom-option';
  div.textContent = text;
  div.addEventListener('click', () => {
    setFilterPriority(value);
    priorityFilterOptions.classList.add('hidden');
    updatePriorityFilterOptions();
    if (priorityRefreshCallback) priorityRefreshCallback();
  });
  return div;
}

// ─── User Filter ───────────────────────────────────────────────────────────────

let userFilterContainer;
let userFilterBtn;
let userFilterOptions;
let userRefreshCallback;

export function initUserFilter(refreshApp) {
  userRefreshCallback = refreshApp;

  userFilterContainer = document.getElementById('user-filter-wrapper');
  userFilterBtn = document.getElementById('user-filter-btn');
  userFilterOptions = document.getElementById('user-filter-options');

  if (!userFilterBtn) return;

  userFilterBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    userFilterOptions.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (userFilterContainer && !userFilterContainer.contains(e.target)) {
      userFilterOptions.classList.add('hidden');
    }
  });
}

function resolveFilterLabel(currentVal, users, myLabel, unassignedLabel) {
  if (currentVal === 'me') return myLabel;
  if (currentVal === 'unassigned') return unassignedLabel;
  const user = users.find(u => u.id === Number.parseInt(currentVal));
  return user ? `${user.first_name} ${user.last_name}` : 'User';
}

export function updateUserFilterOptions(users, context = 'issues') {
  if (!userFilterOptions) return;
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

  userFilterBtn.innerHTML = '';
  if (currentVal !== null && currentVal !== undefined) {
    const userName = resolveFilterLabel(currentVal, users, myLabel, unassignedLabel);
    const textSpan = document.createElement('span');
    textSpan.textContent = `${buttonLabel}: ${userName}`;
    userFilterBtn.appendChild(textSpan);

    const clearIcon = document.createElement('span');
    clearIcon.className = 'toolbar-icon-clear';
    clearIcon.innerHTML = '&times;';
    clearIcon.title = 'Clear filter';

    clearIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      setFilter(null);
      if (userRefreshCallback) userRefreshCallback();
    });

    userFilterBtn.appendChild(clearIcon);
    userFilterBtn.classList.add('has-selection');
  } else {
    const textSpan = document.createElement('span');
    textSpan.textContent = buttonLabel;
    userFilterBtn.appendChild(textSpan);

    const arrowIcon = document.createElement('span');
    arrowIcon.className = 'toolbar-icon-arrow';
    arrowIcon.innerHTML = '▼';

    userFilterBtn.appendChild(arrowIcon);
    userFilterBtn.classList.remove('has-selection');
  }
}

function createUserOption(text, value, setFilter) {
  const div = document.createElement('div');
  div.className = 'custom-option';
  div.textContent = text;
  div.addEventListener('click', () => {
    setFilter(value);
    userFilterOptions.classList.add('hidden');
    if (userRefreshCallback) userRefreshCallback();
  });
  return div;
}

// ─── Release Filter ────────────────────────────────────────────────────────────

let releaseFilterContainer;
let releaseFilterBtn;
let releaseFilterOptions;
let releaseRefreshCallback;

export function initReleaseFilter(refreshApp) {
  releaseRefreshCallback = refreshApp;

  releaseFilterContainer = document.getElementById('release-filter-wrapper');
  releaseFilterBtn = document.getElementById('release-filter-btn');
  releaseFilterOptions = document.getElementById('release-filter-options');

  if (!releaseFilterBtn) return;

  releaseFilterBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    releaseFilterOptions.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (releaseFilterContainer && !releaseFilterContainer.contains(e.target)) {
      releaseFilterOptions.classList.add('hidden');
    }
  });
}

export function updateReleaseFilterOptions(releases) {
  if (!releaseFilterOptions) return;
  const currentVal = state.filter.releaseId;

  releaseFilterOptions.innerHTML = '';

  const noReleaseOption = createReleaseOption('No Release', '__no_release__');
  releaseFilterOptions.appendChild(noReleaseOption);

  [...releases].sort((a, b) => a.name.localeCompare(b.name)).forEach(release => {
    const option = createReleaseOption(release.name, release.id);
    releaseFilterOptions.appendChild(option);
  });

  releaseFilterBtn.innerHTML = '';
  if (currentVal !== null && currentVal !== undefined) {
    let releaseText = 'Unknown';
    if (currentVal === '__no_release__') {
      releaseText = 'No Release';
    } else {
      const found = releases.find(r => r.id === currentVal);
      if (found) releaseText = found.name;
    }

    const textSpan = document.createElement('span');
    textSpan.textContent = `Release: ${releaseText}`;
    releaseFilterBtn.appendChild(textSpan);

    const clearIcon = document.createElement('span');
    clearIcon.className = 'toolbar-icon-clear';
    clearIcon.innerHTML = '&times;';
    clearIcon.title = 'Clear filter';
    clearIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      setFilterRelease(null);
      if (releaseRefreshCallback) releaseRefreshCallback();
    });

    releaseFilterBtn.appendChild(clearIcon);
    releaseFilterBtn.classList.add('has-selection');
  } else {
    const textSpan = document.createElement('span');
    textSpan.textContent = 'Release';
    releaseFilterBtn.appendChild(textSpan);

    const arrowIcon = document.createElement('span');
    arrowIcon.className = 'toolbar-icon-arrow';
    arrowIcon.innerHTML = '▼';
    releaseFilterBtn.appendChild(arrowIcon);
    releaseFilterBtn.classList.remove('has-selection');
  }
}

function createReleaseOption(text, value) {
  const div = document.createElement('div');
  div.className = 'custom-option';
  div.textContent = text;
  div.addEventListener('click', () => {
    setFilterRelease(value);
    releaseFilterOptions.classList.add('hidden');
    if (releaseRefreshCallback) releaseRefreshCallback();
  });
  return div;
}

// ─── Project Selector ──────────────────────────────────────────────────────────

let _onProjectChange = null;

export function initProjectSelector(onProjectChange) {
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

export function updateProjectSelectorOptions(projects) {
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

function updateProjectButtonLabel(btn, projectName) {
  const textSpan = btn.querySelector('#project-selector-text');
  if (textSpan) {
    textSpan.textContent = projectName || 'Select Project';
  }
}

// ─── User Menu ─────────────────────────────────────────────────────────────────

export function setupUserMenu(user) {
  const userMenuBtn = document.getElementById('user-menu-btn');
  const userMenuDropdown = document.getElementById('user-menu-dropdown');
  const userEmailSpan = document.getElementById('current-user-email');
  const logoutBtn = document.getElementById('user-menu-logout');
  const passwordBtn = document.getElementById('user-menu-password');

  if (userEmailSpan) {
    const initials = getUserInitials(user);
    const badge = document.createElement('div');
    badge.className = 'user-badge header';
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
      if (!userMenuBtn.contains(e.target) && !userMenuDropdown.contains(e.target)) {
        userMenuDropdown.classList.add('hidden');
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      logout();
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

function setupPasswordModal(user) {
  const modal = document.getElementById('password-modal');
  const form = document.getElementById('password-form');
  const cancelBtn = document.getElementById('password-cancel-btn');

  if (!modal || !form || !cancelBtn) return;

  cancelBtn.addEventListener('click', () => {
    modal.classList.add('hidden');
    form.reset();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newPassword = document.getElementById('new-password').value;

    try {
      const pwError = validatePasswordPolicy(newPassword, user ? user.email : '');
      if (pwError) {
        throw new Error(pwError);
      }

      await updateCurrentUser({ password: newPassword });
      showNotification('Password updated successfully. Logging out...');
      modal.classList.add('hidden');
      form.reset();

      setTimeout(() => {
        logout();
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

    modal.classList.remove('hidden');
    document.getElementById('new-password').focus();
  }
}
