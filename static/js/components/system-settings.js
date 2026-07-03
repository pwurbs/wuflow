import { fetchUsers, createUser, updateUser, fetchProjects, createProject, updateProject, deleteProject, logout } from '../api.js';
import { showNotification, getUserInitials, escapeHtml, initCharCounter, countCodepoints, formatDateTime } from '../utils.js';
import { MAX_PROJECT_NAME_LEN, MAX_PROJECT_DESC_LEN, MAX_USERNAME_LENGTH, MAX_EMAIL_LENGTH, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, EMAIL_REGEX } from '../validation-config.js';
import { state } from '../state.js';
import { ROLE_DISPLAY_NAMES } from '../domain-constants.js';
import { userCan, ACTION_CREATE_PROJECT, ACTION_UPDATE_PROJECT, ACTION_LIST_PROJECTS, ACTION_DELETE_PROJECT, ACTION_LIST_USERS, ACTION_CREATE_USER, ACTION_UPDATE_USER } from '../permissions.js';
import { updateProjectSelectorOptions } from './toolbar.js';

const HINT_EDIT_USER = 'Leave empty to keep current password';
const HINT_NEW_USER = 'Minimum 12 characters. No common passwords.';

let systemSettingsViewContainer = null;

export function setupSystemSettingsView(refreshCallback) {
  systemSettingsViewContainer = document.getElementById('system-settings-view');

  // User management
  setupUserModal(refreshCallback);

  // Project management
  setupProjectModal(refreshCallback);
}

export async function renderSystemSettingsView(refreshCallback) {
  if (!systemSettingsViewContainer) return;

  await renderProjectList(refreshCallback);
  await renderUserList(refreshCallback);
}

// --- Project Management ---

let editingProjectId = null;

function setupProjectModal(refreshCallback) {
  const addProjectBtn = document.getElementById('add-project-btn');
  const cancelBtn = document.getElementById('project-modal-cancel');
  const form = document.getElementById('project-form');
  const projectDeleteBtn = document.getElementById('project-modal-delete');

  const nameInput = document.getElementById('project-name');
  const descInput = document.getElementById('project-description');
  if (nameInput) initCharCounter(nameInput, MAX_PROJECT_NAME_LEN);
  if (descInput) initCharCounter(descInput, MAX_PROJECT_DESC_LEN);

  if (addProjectBtn) {
    addProjectBtn.addEventListener('click', () => openProjectModal(null));
  }
  if (cancelBtn) {
    cancelBtn.addEventListener('click', closeProjectModal);
  }
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleProjectSubmit(refreshCallback);
    });
  }
  if (projectDeleteBtn) {
    projectDeleteBtn.addEventListener('click', () => handleDeleteProject(refreshCallback));
  }
}

function openProjectModal(project) {
  const overlay = document.getElementById('project-modal-overlay');
  const title = document.getElementById('project-modal-title');
  const nameInput = document.getElementById('project-name');
  const descInput = document.getElementById('project-description');
  const errorDisplay = document.getElementById('project-modal-error');
  const deleteBtn = document.getElementById('project-modal-delete');

  errorDisplay.textContent = '';
  errorDisplay.classList.add('hidden');

  if (project) {
    editingProjectId = project.id;
    title.textContent = 'Edit Project';
    nameInput.value = project.name;
    nameInput.disabled = false;
    descInput.value = project.description || '';

    // Show delete button, but not for the default project (id 1) or if missing permission
    if (project.id !== 1 && userCan(state.currentUser, ACTION_DELETE_PROJECT)) {
      deleteBtn.classList.remove('hidden');
    } else {
      deleteBtn.classList.add('hidden');
    }
  } else {
    editingProjectId = null;
    title.textContent = 'New Project';
    nameInput.value = '';
    nameInput.disabled = false;
    descInput.value = '';
    deleteBtn.classList.add('hidden');
  }

  overlay.classList.remove('hidden');
  nameInput.focus();
}

function closeProjectModal() {
  const overlay = document.getElementById('project-modal-overlay');
  overlay.classList.add('hidden');
  editingProjectId = null;
}

async function handleProjectSubmit(refreshCallback) {
  const nameInput = document.getElementById('project-name');
  const descInput = document.getElementById('project-description');
  const errorDisplay = document.getElementById('project-modal-error');

  const name = nameInput.value.trim();
  const description = descInput.value.trim();

  if (!name) {
    showProjectError(errorDisplay, 'Project name is required.');
    return;
  }
  if (countCodepoints(name) > MAX_PROJECT_NAME_LEN) {
    showProjectError(errorDisplay, `Project name must not exceed ${MAX_PROJECT_NAME_LEN} characters.`);
    return;
  }
  if (countCodepoints(description) > MAX_PROJECT_DESC_LEN) {
    showProjectError(errorDisplay, `Project description must not exceed ${MAX_PROJECT_DESC_LEN} characters.`);
    return;
  }

  try {
    if (editingProjectId) {
      if (!userCan(state.currentUser, ACTION_UPDATE_PROJECT)) return;
      await updateProject(editingProjectId, { name, description });
      showNotification('Project updated', 'success');
    } else {
      if (!userCan(state.currentUser, ACTION_CREATE_PROJECT)) return;
      await createProject({ name, description });
      showNotification('Project created', 'success');
    }
    closeProjectModal();
    renderSystemSettingsView(refreshCallback);
    // Refreshes the project selector dropdown; its own fallback logic triggers a full
    // refresh only if the currently selected project was affected (e.g. deleted elsewhere).
    updateProjectSelectorOptions(await fetchProjects());
  } catch (err) {
    showProjectError(errorDisplay, err.message);
  }
}

function showProjectError(el, message) {
  el.textContent = message;
  el.classList.remove('hidden');
}

function handleDeleteProject(refreshCallback) {
  if (!editingProjectId || editingProjectId === 1) return;
  if (!userCan(state.currentUser, ACTION_DELETE_PROJECT)) return;

  const confirmModal = document.getElementById('confirm-modal');
  const confirmTitle = document.getElementById('confirm-title');
  const confirmMessage = document.getElementById('confirm-message');
  const okBtn = document.getElementById('confirm-ok-btn');
  const cancelBtn = document.getElementById('confirm-cancel-btn');

  confirmTitle.textContent = 'Delete Project';
  confirmMessage.textContent = 'Are you sure you want to delete this project?';

  const handleOk = async () => {
    cleanup();
    const adminPassword = await promptAdminPasswordConfirmation();
    if (adminPassword === null) return;

    try {
      await deleteProject(editingProjectId, adminPassword);
      showNotification('Project deleted', 'success');
      closeProjectModal();
      renderSystemSettingsView(refreshCallback);
      // Refreshes the project selector dropdown; its own fallback logic triggers a full
      // refresh if the deleted project was the currently selected one.
      updateProjectSelectorOptions(await fetchProjects());
    } catch (err) {
      const errorDisplay = document.getElementById('project-modal-error');
      showProjectError(errorDisplay, err.message);
    }
  };

  const handleCancel = () => {
    cleanup();
  };

  const cleanup = () => {
    confirmModal.classList.add('hidden');
    okBtn.removeEventListener('click', handleOk);
    cancelBtn.removeEventListener('click', handleCancel);
  };

  okBtn.addEventListener('click', handleOk);
  cancelBtn.addEventListener('click', handleCancel);

  confirmModal.classList.remove('hidden');
}

async function renderProjectList(refreshCallback) {
  const projectsList = document.getElementById('projects-list');
  const projectSection = document.getElementById('project-management-section');
  if (!projectsList || !projectSection) return;

  if (userCan(state.currentUser, ACTION_LIST_PROJECTS)) {
    projectSection.style.display = '';
  } else {
    projectSection.style.display = 'none';
    return;
  }

  // Only users with ACTION_CREATE_PROJECT can add projects
  const addBtn = document.getElementById('add-project-btn');
  if (addBtn) {
    addBtn.style.display = userCan(state.currentUser, ACTION_CREATE_PROJECT) ? '' : 'none';
  }

  projectsList.innerHTML = '<div class="loader">Loading...</div>';

  try {
    const projects = await fetchProjects();
    projectsList.innerHTML = '';

    projects.forEach(project => {
      const row = document.createElement('div');
      row.className = 'settings-entry';

      const isDefault = project.id === 1;
      const desc = project.description ? escapeHtml(project.description) : '<em>No description</em>';

      row.innerHTML = `
        <div class="settings-entry-info">
          <span class="settings-entry-title settings-entry-col-name" title="${escapeHtml(project.name)}">${escapeHtml(project.name)}</span>
          <span class="settings-entry-subtitle settings-entry-col-description">${desc}</span>
          <span class="settings-entry-col-role">${isDefault ? '<span class="settings-entry-badge admin">default</span>' : ''}</span>
        </div>
      `;

      if (userCan(state.currentUser, ACTION_UPDATE_PROJECT)) {
        row.classList.add('settings-entry--clickable');
        row.dataset.tooltip = 'Edit Project';
        row.addEventListener('click', () => openProjectModal(project));
      }

      projectsList.appendChild(row);
    });

  } catch (err) {
    console.error(err);
    projectsList.innerHTML = '<div class="error">Failed to load projects.</div>';
  }
}

// --- User Management ---

let editingUserId = null;
let editingUserOriginalRole = null;
let editingUserOriginalActive = null;

const ROLE_RANK = { user: 0, admin: 1, sysadmin: 2 };
function isRolePromotion(fromRole, toRole) {
  return (ROLE_RANK[toRole] ?? -1) > (ROLE_RANK[fromRole] ?? -1);
}

function setupUserModal(refreshCallback) {
  const addUserBtn = document.getElementById('add-user-btn');
  const cancelBtn = document.getElementById('user-modal-cancel');
  const form = document.getElementById('user-form');

  if (addUserBtn) {
    if (userCan(state.currentUser, ACTION_CREATE_USER)) {
      addUserBtn.style.display = '';
      addUserBtn.addEventListener('click', () => openUserModal(null));
    } else {
      addUserBtn.style.display = 'none';
    }
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', closeUserModal);
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleUserSubmit(refreshCallback);
    });
  }

  // Setup custom dropdowns
  setupUserDropdown('user-role-trigger', 'user-role-options', 'user-role', 'user-role-text');

  // Character counters for user name fields
  initCharCounter(document.getElementById('user-first-name'), MAX_USERNAME_LENGTH);
  initCharCounter(document.getElementById('user-last-name'), MAX_USERNAME_LENGTH);
}

function openUserModal(user) {
  const overlay = document.getElementById('user-modal-overlay');
  const modalTitle = document.getElementById('user-modal-title');
  const emailInput = document.getElementById('user-email');
  const firstNameInput = document.getElementById('user-first-name');
  const lastNameInput = document.getElementById('user-last-name');
  const passwordInput = document.getElementById('user-password');
  const passwordHint = document.getElementById('user-password-hint');
  const errorDisplay = document.getElementById('user-modal-error');
  const activeInput = document.getElementById('user-active');
  const roleInput = document.getElementById('user-role');
  const roleText = document.getElementById('user-role-text');
  const userForm = document.getElementById('user-form');

  // Clear error
  errorDisplay.textContent = '';
  errorDisplay.classList.add('hidden');

  if (user) {
    editingUserId = user.id;
    editingUserOriginalRole = user.role;
    editingUserOriginalActive = user.active;
    modalTitle.textContent = 'Edit User';
    emailInput.value = user.email;
    firstNameInput.value = user.first_name;
    lastNameInput.value = user.last_name;
    activeInput.checked = user.active;

    // Set role dropdown value
    roleInput.value = user.role;
    roleText.textContent = ROLE_DISPLAY_NAMES[user.role] ?? 'User';

    // ... existing code ...

    // Password logic for Edit Mode
    passwordInput.value = '';
    passwordInput.placeholder = '';
    passwordInput.required = false;
    passwordHint.textContent = HINT_EDIT_USER;
    passwordHint.classList.remove('hidden');
  } else {
    editingUserId = null;
    editingUserOriginalRole = null;
    editingUserOriginalActive = null;
    modalTitle.textContent = 'New User';
    userForm.reset();
    activeInput.checked = true; // Default to active

    // Reset role to default (user)
    roleInput.value = 'user';
    roleText.textContent = 'User';

    // Password logic for Create Mode
    passwordInput.placeholder = '';
    passwordInput.required = true;
    passwordHint.textContent = HINT_NEW_USER;
    passwordHint.classList.remove('hidden'); // Show hint for new user too
  }

  // Remove previous error messages
  errorDisplay.classList.add('hidden');
  errorDisplay.textContent = '';

  overlay.classList.remove('hidden');
  emailInput.focus();
}

function closeUserModal() {
  const overlay = document.getElementById('user-modal-overlay');
  overlay.classList.add('hidden');
  editingUserId = null;
  editingUserOriginalRole = null;
  editingUserOriginalActive = null;
}

async function handleUserSubmit(refreshCallback) {
  const emailInput = document.getElementById('user-email');
  const firstNameInput = document.getElementById('user-first-name');
  const lastNameInput = document.getElementById('user-last-name');
  const passwordInput = document.getElementById('user-password');
  const roleInput = document.getElementById('user-role');
  const activeInput = document.getElementById('user-active');
  const errorDisplay = document.getElementById('user-modal-error');

  const userData = {
    email: emailInput.value.trim(),
    first_name: firstNameInput.value.trim(),
    last_name: lastNameInput.value.trim(),
    role: roleInput.value,
    active: activeInput.checked,
  };

  if (passwordInput.value) {
    userData.password = passwordInput.value;
  }

  if (!validateUserInput(userData, errorDisplay)) {
    return;
  }

  try {
    const isEditing = !!editingUserId;
    const action = isEditing ? ACTION_UPDATE_USER : ACTION_CREATE_USER;
    if (!userCan(state.currentUser, action)) return;

    if (isEditing) {
      if (!await applyUserUpdate(userData)) return;
    } else {
      await createUser(userData);
    }

    showNotification(isEditing ? 'User updated' : 'User created', 'success');
    closeUserModal();
    renderSystemSettingsView(refreshCallback);
  } catch (err) {
    showUserError(errorDisplay, err.message);
  }
}

async function applyUserUpdate(userData) {
  if (userData.password || isRolePromotion(editingUserOriginalRole, userData.role) || userData.active !== editingUserOriginalActive) {
    const adminPassword = await promptAdminPasswordConfirmation();
    if (adminPassword === null) return false;
    userData.admin_password = adminPassword;
  }
  await updateUser(editingUserId, userData);
  const isSelf = editingUserId === state.currentUser?.id;
  if (isSelf && (userData.password || userData.role !== state.currentUser?.role)) {
    logout();
    return false;
  }
  return true;
}

function promptAdminPasswordConfirmation() {
  return new Promise((resolve) => {
    const modal = document.getElementById('admin-confirm-modal');
    const input = document.getElementById('admin-confirm-password');
    const errorDiv = document.getElementById('admin-confirm-error');
    const okBtn = document.getElementById('admin-confirm-ok-btn');
    const cancelBtn = document.getElementById('admin-confirm-cancel-btn');

    input.value = '';
    const usernameField = document.getElementById('admin-confirm-username');
    if (usernameField && state.currentUser) {
      usernameField.value = state.currentUser.email || '';
    }
    errorDiv.textContent = '';
    errorDiv.classList.add('hidden');
    modal.classList.remove('hidden');
    input.focus();

    function cleanup() {
      modal.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKeydown);
    }

    function onOk() {
      if (!input.value) {
        errorDiv.textContent = 'Password is required.';
        errorDiv.classList.remove('hidden');
        return;
      }
      cleanup();
      resolve(input.value);
    }

    function onCancel() {
      cleanup();
      resolve(null);
    }

    function onKeydown(e) {
      if (e.key === 'Enter') onOk();
    }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKeydown);
  });
}

function validateUserInput(userData, errorDisplay) {
  if (!userData.email || !EMAIL_REGEX.test(userData.email)) {
    showUserError(errorDisplay, 'A valid email address is required.');
    document.getElementById('user-email')?.focus();
    return false;
  }
  if (userData.email.length > MAX_EMAIL_LENGTH) {
    showUserError(errorDisplay, `Email must not exceed ${MAX_EMAIL_LENGTH} characters.`);
    document.getElementById('user-email')?.focus();
    return false;
  }
  if (!userData.first_name || !userData.last_name) {
    showUserError(errorDisplay, 'First name and last name are required.');
    return false;
  }
  if (countCodepoints(userData.first_name) > MAX_USERNAME_LENGTH || countCodepoints(userData.last_name) > MAX_USERNAME_LENGTH) {
    showUserError(errorDisplay, `First and last name must not exceed ${MAX_USERNAME_LENGTH} characters.`);
    return false;
  }

  if (!editingUserId && !userData.password) {
    showUserError(errorDisplay, 'Password is required for new users');
    return false;
  }

  if (userData.password) {
    if (countCodepoints(userData.password) > MAX_PASSWORD_LENGTH) {
      showUserError(errorDisplay, `Password must not exceed ${MAX_PASSWORD_LENGTH} characters.`);
      return false;
    }
    const pwError = validatePasswordPolicy(userData.password, userData.email);
    if (pwError) {
      showUserError(errorDisplay, pwError);
      return false;
    }
  }

  return true;
}

function showUserError(el, message) {
  el.textContent = message;
  el.classList.remove('hidden');
}

/**
 * Client-side password policy validation.
 * Must match backend rules in validation.go.
 */
export function validatePasswordPolicy(password, email) {
  if (countCodepoints(password) < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (email && password.toLowerCase() === email.toLowerCase()) {
    return 'Password must not be your email address';
  }
  if (isBlacklistedPassword(password)) {
    return 'Password is too common';
  }
  return null;
}

const PASSWORD_BLACKLIST = new Set([
  'password', 'qwerty', 'admin', 'welcome', 'login',
  'manager', 'master', 'dragon', 'baseball', 'football',
  'shadow', 'sunshine', 'freedom', 'charlie', 'iloveyou',
  'princess', 'monkey', 'donald', 'michael',
  '123456', '111111', '000000', 'abcdef',
  'passwort', 'geheim', 'hallo', 'willkommen',
  'sommer', 'winter', 'herbst', 'fruehling',
  'schatz', 'liebe', 'sonne', 'mond', 'sterne',
  'qwertz', 'asdfgh', 'yxcvbn',
  'fussball', 'musik', 'schule', 'arbeit',
]);

const LEET_REPLACEMENTS = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a',
  '5': 's', '@': 'a', '$': 's', '!': 'i',
};

export function isBlacklistedPassword(pw) {
  let normalized = pw.toLowerCase();

  // Check exact match before leet speak replacement (fixes numeric passwords like 123456)
  if (PASSWORD_BLACKLIST.has(normalized)) return true;

  for (const [from, to] of Object.entries(LEET_REPLACEMENTS)) {
    normalized = normalized.replaceAll(from, to);
  }
  for (const blocked of PASSWORD_BLACKLIST) {
    const match = blocked.length >= 4 ? normalized.includes(blocked) : normalized === blocked;
    if (match) return true;
  }
  return false;
}

async function renderUserList(refreshCallback) {
  const usersList = document.getElementById('users-list');
  const userSection = document.getElementById('user-management-section');
  if (!usersList || !userSection) return;

  // Only show user management for users with ACTION_LIST_USERS
  if (userCan(state.currentUser, ACTION_LIST_USERS)) {
    userSection.classList.remove('hidden');
  } else {
    userSection.classList.add('hidden');
    return;
  }

  usersList.innerHTML = '<div class="loader">Loading...</div>';

  try {
    const users = await fetchUsers();
    usersList.innerHTML = '';

    // Sort users: Active first, then by email
    users.sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return a.email.localeCompare(b.email);
    });

    users.forEach(user => {
      const row = document.createElement('div');
      row.className = user.active ? 'settings-entry' : 'settings-entry user-inactive';

      const roleBadgeMap = {
        sysadmin: '<span class="settings-entry-badge sysadmin">Sysadmin</span>',
        admin: '<span class="settings-entry-badge admin">Admin</span>',
        user: '<span class="settings-entry-badge user">User</span>',
      };
      const roleBadge = roleBadgeMap[user.role] ?? '';

      const lastLoginText = user.last_login ? formatDateTime(user.last_login) : 'Never';

      row.innerHTML = `
        <div class="settings-entry-info">
          <div class="user-badge">${escapeHtml(getUserInitials(user))}</div>
          <span class="settings-entry-title settings-entry-col-email" title="${escapeHtml(user.email)}">${escapeHtml(user.email)}</span>
          <span class="settings-entry-subtitle settings-entry-col-name" title="${escapeHtml(user.first_name)} ${escapeHtml(user.last_name)}">${escapeHtml(user.first_name)} ${escapeHtml(user.last_name)}</span>
          <span class="settings-entry-col-role">${roleBadge}</span>
          <span class="settings-entry-subtitle settings-entry-col-lastlogin">Last login: ${lastLoginText}</span>
        </div>
      `;

      if (userCan(state.currentUser, ACTION_UPDATE_USER)) {
        row.classList.add('settings-entry--clickable');
        row.dataset.tooltip = 'Edit User';
        row.addEventListener('click', () => openUserModal(user));
      }

      usersList.appendChild(row);
    });

  } catch (err) {
    console.error(err);
    usersList.innerHTML = '<div class="error">Failed to load users.</div>';
  }
}

// --- Custom Dropdown Helpers ---

function setupUserDropdown(triggerId, optionsId, inputId, textId) {
  const trigger = document.getElementById(triggerId);
  const options = document.getElementById(optionsId);
  const input = document.getElementById(inputId);
  const text = document.getElementById(textId);
  if (!trigger || !options || !input || !text) return;

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    // Close other user dropdowns
    ['user-role-options', 'user-active-options'].forEach(id => {
      if (id !== optionsId) {
        document.getElementById(id)?.classList.add('hidden');
      }
    });
    options.classList.toggle('hidden');
  });

  options.addEventListener('click', (e) => {
    const option = e.target.closest('.custom-option');
    if (!option) return;
    const value = option.dataset.value;
    input.value = value;
    text.textContent = option.textContent;
    // Update selected state
    options.querySelectorAll('.custom-option').forEach(o => o.classList.remove('selected'));
    option.classList.add('selected');
    options.classList.add('hidden');
  });

  // Close on outside click
  document.addEventListener('click', () => {
    options.classList.add('hidden');
  });
}


// Simple helper to check if color is light or dark (for text contrast)
export function isLight(color) {
  const hex = color.replaceAll('#', '');
  const r = Number.parseInt(hex.substr(0, 2), 16);
  const g = Number.parseInt(hex.substr(2, 2), 16);
  const b = Number.parseInt(hex.substr(4, 2), 16);
  const brightness = ((r * 299) + (g * 587) + (b * 114)) / 1000;
  return brightness > 155;
}
