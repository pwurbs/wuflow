import { fetchUsers, createUser, updateUser, deleteUser, fetchProjects, createProject, updateProject, deleteProject, logout, fetchActiveIssuesByProject, fetchArchivedIssuesByProject, fetchOpenIssuesByProject } from '../api.ts';
import { byId, showNotification, getUserInitials, escapeHtml, initCharCounter, countCodepoints, countUtf8Bytes, formatDateTime, promptAdminPasswordConfirmation, onGuardedSubmit } from '../utils.ts';
import { MAX_PROJECT_NAME_LEN, MAX_PROJECT_DESC_LEN, MAX_USERNAME_LENGTH, MAX_EMAIL_LENGTH, MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH, EMAIL_REGEX } from '../validation-config.ts';
import { state, setUsers, setProjects } from '../state.ts';
import { ROLE_DISPLAY_NAMES, DEFAULT_PROJECT_ID } from '../domain-constants.ts';
import type { UserWrite } from '../api.ts';
import type { Role } from '../permissions.ts';
import type { Project, User } from '../models.ts';
import { userCan, ACTION_CREATE_PROJECT, ACTION_UPDATE_PROJECT, ACTION_LIST_PROJECTS, ACTION_DELETE_PROJECT, ACTION_LIST_USERS, ACTION_CREATE_USER, ACTION_UPDATE_USER, ACTION_DELETE_USER } from '../permissions.ts';
import { updateProjectSelectorOptions } from './toolbar.ts';

const HINT_EDIT_USER = 'Leave empty to keep current password';
const HINT_NEW_USER = 'Minimum 12 characters. No common passwords.';

let systemSettingsViewContainer: HTMLElement | null = null;

export function setupSystemSettingsView() {
  systemSettingsViewContainer = document.getElementById('system-settings-view');

  // User management
  setupUserModal();

  // Project management
  setupProjectModal();
}

export async function renderSystemSettingsView() {
  if (!systemSettingsViewContainer) return;

  // Both lists are independent, so their requests go out in one parallel wave.
  const [projects] = await Promise.all([
    renderProjectList(),
    renderUserList(),
  ]);
  return projects;
}

// --- Project Management ---

let editingProjectId: number | null = null;

function setupProjectModal() {
  const addProjectBtn = document.getElementById('add-project-btn');
  const cancelBtn = document.getElementById('project-modal-cancel');
  const form = document.getElementById('project-form');
  const projectDeleteBtn = document.getElementById('project-modal-delete');

  const nameInput = document.getElementById('project-name');
  const descInput = document.getElementById('project-description');
  if (nameInput instanceof HTMLInputElement) initCharCounter(nameInput, MAX_PROJECT_NAME_LEN);
  if (descInput instanceof HTMLTextAreaElement) initCharCounter(descInput, MAX_PROJECT_DESC_LEN);

  if (addProjectBtn) {
    addProjectBtn.addEventListener('click', () => openProjectModal(null));
  }
  if (cancelBtn) {
    cancelBtn.addEventListener('click', closeProjectModal);
  }
  if (form instanceof HTMLFormElement) onGuardedSubmit(form, () => handleProjectSubmit());
  if (projectDeleteBtn) {
    projectDeleteBtn.addEventListener('click', () => handleDeleteProject());
  }
}

function openProjectModal(project: Project | null) {
  const overlay = byId('project-modal-overlay');
  const title = byId('project-modal-title');
  const nameInput = byId('project-name', HTMLInputElement);
  const descInput = byId('project-description', HTMLTextAreaElement);
  const errorDisplay = byId('project-modal-error');
  const deleteBtn = byId('project-modal-delete');

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
  const overlay = byId('project-modal-overlay');
  overlay.classList.add('hidden');
  editingProjectId = null;
}

async function handleProjectSubmit() {
  const nameInput = byId('project-name', HTMLInputElement);
  const descInput = byId('project-description', HTMLTextAreaElement);
  const errorDisplay = byId('project-modal-error');

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
    const projects = await renderSystemSettingsView();
    // Refreshes the project selector dropdown; its own fallback logic triggers a full
    // refresh only if the currently selected project was affected (e.g. deleted elsewhere).
    updateProjectSelectorOptions(projects ?? await fetchProjects());
  } catch (err) {
    showProjectError(errorDisplay, err.message);
  }
}

function showProjectError(el: HTMLElement, message: string) {
  el.textContent = message;
  el.classList.remove('hidden');
}

async function handleDeleteProject() {
  const projectId = editingProjectId;
  if (!projectId || projectId === DEFAULT_PROJECT_ID) return;
  if (!userCan(state.currentUser, ACTION_DELETE_PROJECT)) return;

  const errorDisplay = byId('project-modal-error');
  const [active, archived, open] = await Promise.all([
    fetchActiveIssuesByProject(projectId),
    fetchArchivedIssuesByProject(projectId),
    fetchOpenIssuesByProject(projectId),
  ]);
  const issueCount = active.length + archived.length + open.length;
  if (issueCount > 0) {
    showProjectError(errorDisplay, `This project still has ${issueCount} issue${issueCount === 1 ? '' : 's'}. Move or delete them first before deleting the project.`);
    return;
  }

  const projectName = byId('project-name', HTMLInputElement).value;
  const confirmed = await promptAdminPasswordConfirmation(
    'Delete Project',
    `Do you really want to delete the project "${projectName}"?\nThis action cannot be undone.`,
    async (adminPassword) => {
      await deleteProject(projectId, adminPassword);
    },
    'Delete'
  );
  if (!confirmed) return;

  showNotification('Project deleted', 'success');
  closeProjectModal();
  const projects = await renderSystemSettingsView();
  // Refreshes the project selector dropdown; its own fallback logic triggers a full
  // refresh if the deleted project was the currently selected one.
  updateProjectSelectorOptions(projects ?? await fetchProjects());
}

async function renderProjectList() {
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
    setProjects(projects); // keep the issue modal's project dropdown current
    projectsList.innerHTML = '';

    projects.forEach(project => {
      const row = document.createElement('div');
      row.className = 'settings-entry';

      const isDefault = project.id === DEFAULT_PROJECT_ID;
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

    return projects;
  } catch (err) {
    console.error(err);
    projectsList.innerHTML = '<div class="error">Failed to load projects.</div>';
  }
}

// --- User Management ---

let editingUserId: number | null = null;
// Role, active flag, email and name of the user being edited, as loaded (null when creating).
type EditedUser = Pick<User, 'role' | 'active' | 'email' | 'first_name' | 'last_name'>;
let editingUserOriginal: EditedUser | null = null;

const ROLE_RANK: Record<Role, number> = { user: 0, admin: 1, sysadmin: 2 };
function isRolePromotion(fromRole: Role, toRole: Role) {
  return (ROLE_RANK[toRole] ?? -1) > (ROLE_RANK[fromRole] ?? -1);
}

function setupUserModal() {
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

  if (form instanceof HTMLFormElement) onGuardedSubmit(form, () => handleUserSubmit());

  document.getElementById('user-modal-delete')?.addEventListener('click', () => handleDeleteUser());

  // Setup custom dropdowns
  setupUserDropdown('user-role-trigger', 'user-role-options', 'user-role', 'user-role-text');

  // Character counters for user name fields
  initCharCounter(byId('user-first-name', HTMLInputElement), MAX_USERNAME_LENGTH);
  initCharCounter(byId('user-last-name', HTMLInputElement), MAX_USERNAME_LENGTH);
}

function openUserModal(user: User | null) {
  const overlay = byId('user-modal-overlay');
  const modalTitle = byId('user-modal-title');
  const emailInput = byId('user-email', HTMLInputElement);
  const firstNameInput = byId('user-first-name', HTMLInputElement);
  const lastNameInput = byId('user-last-name', HTMLInputElement);
  const passwordInput = byId('user-password', HTMLInputElement);
  const passwordHint = byId('user-password-hint');
  const errorDisplay = byId('user-modal-error');
  const activeInput = byId('user-active', HTMLInputElement);
  const roleInput = byId('user-role', HTMLInputElement);
  const roleText = byId('user-role-text');
  const userForm = byId('user-form', HTMLFormElement);
  const deleteBtn = byId('user-modal-delete');

  // Editing an existing user other than yourself (the backend blocks self-deletion)
  const canDelete = !!user && user.id !== state.currentUser?.id && userCan(state.currentUser, ACTION_DELETE_USER);
  deleteBtn.classList.toggle('hidden', !canDelete);

  // Clear error
  errorDisplay.textContent = '';
  errorDisplay.classList.add('hidden');

  if (user) {
    editingUserId = user.id;
    editingUserOriginal = { role: user.role, active: user.active, email: user.email, first_name: user.first_name, last_name: user.last_name };
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
    editingUserOriginal = null;
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
  const overlay = byId('user-modal-overlay');
  overlay.classList.add('hidden');
  editingUserId = null;
  editingUserOriginal = null;
}

async function handleUserSubmit() {
  const emailInput = byId('user-email', HTMLInputElement);
  const firstNameInput = byId('user-first-name', HTMLInputElement);
  const lastNameInput = byId('user-last-name', HTMLInputElement);
  const passwordInput = byId('user-password', HTMLInputElement);
  const roleInput = byId('user-role', HTMLInputElement);
  const activeInput = byId('user-active', HTMLInputElement);
  const errorDisplay = byId('user-modal-error');

  const userData: UserWrite = {
    email: emailInput.value.trim(),
    first_name: firstNameInput.value.trim(),
    last_name: lastNameInput.value.trim(),
    // The hidden input only ever holds a value of the role dropdown.
    role: roleInput.value as Role,
    active: activeInput.checked,
  };

  if (passwordInput.value) {
    userData.password = passwordInput.value;
  }

  if (!validateUserInput(userData, errorDisplay)) {
    return;
  }

  try {
    const userId = editingUserId;
    const original = editingUserOriginal;
    const isEditing = !!userId && !!original;
    const action = isEditing ? ACTION_UPDATE_USER : ACTION_CREATE_USER;
    if (!userCan(state.currentUser, action)) return;

    if (isEditing) {
      if (!await applyUserUpdate(userId, original, userData)) return;
    } else {
      await createUser(userData);
    }

    showNotification(isEditing ? 'User updated' : 'User created', 'success');
    closeUserModal();
    void renderSystemSettingsView();
  } catch (err) {
    showUserError(errorDisplay, err.message);
  }
}

async function handleDeleteUser() {
  const userId = editingUserId;
  const original = editingUserOriginal;
  if (!userId || !original || userId === state.currentUser?.id) return;
  if (!userCan(state.currentUser, ACTION_DELETE_USER)) return;

  const name = `${original.first_name} ${original.last_name}`.trim();
  const confirmed = await promptAdminPasswordConfirmation(
    'Delete User',
    `Do you really want to delete ${name}?\nIssues assigned to them become unassigned (noted in each issue's history), releases they own lose their owner, and their comments and history entries show "Unknown user". This signs them out (<15min) and cannot be undone.`,
    async (adminPassword) => {
      await deleteUser(userId, adminPassword);
    },
    'Delete'
  );
  if (!confirmed) return;

  showNotification('User deleted', 'success');
  closeUserModal();
  void renderSystemSettingsView();
}

// Returns the confirmation dialog copy for the update, or null if it needs no confirmation.
// Several confirmable changes at once get one dialog that lists all of them.
function getUserUpdateConfirmationCopy(userData: UserWrite, original: EditedUser) {
  const name = `${userData.first_name} ${userData.last_name}`.trim();
  // title + message: the dialog for this change alone; change: its line in a combined dialog.
  const cases: { title: string; message: string; change: string; signsOut: boolean }[] = [];
  if (userData.password) {
    cases.push({
      title: 'Confirm Password Reset',
      message: `Do you really want to reset the password for ${name}?\nThis immediately sets a new password and signs them out of every active session (<15min).`,
      change: 'Set a new password',
      signsOut: true,
    });
  }
  if (userData.email !== original.email) {
    cases.push({
      title: 'Confirm Email Change',
      message: `Do you really want to change ${name}'s login email to ${userData.email}?\nThis signs them out of every active session (<15min); they must then log in with the new email.`,
      change: `Change the login email to ${userData.email}; they must then log in with the new email`,
      signsOut: true,
    });
  }
  if (userData.active === false && original.active) {
    cases.push({
      title: 'Confirm Deactivation',
      message: `Do you really want to deactivate ${name}?\nThis blocks new logins until reactivated and signs them out of every active session (<15min).`,
      change: 'Deactivate the account; this blocks new logins until reactivated',
      signsOut: true,
    });
  } else if (userData.active !== original.active) {
    cases.push({
      title: 'Confirm Reactivation',
      message: `Do you really want to reactivate ${name}?\nThis allows them to log in again.`,
      change: 'Reactivate the account; this allows them to log in again',
      signsOut: false,
    });
  }
  if (isRolePromotion(original.role, userData.role)) {
    const roleLabel = ROLE_DISPLAY_NAMES[userData.role] ?? userData.role;
    cases.push({
      title: 'Confirm Role Change',
      message: `Do you really want to change ${name}'s role to ${roleLabel}?\nThis signs them out of every active session (<15min); the new permissions apply from their next login.`,
      change: `Change the role to ${roleLabel}; the new permissions apply from their next login`,
      signsOut: true,
    });
  }
  if (cases.length === 0) return null;
  if (cases.length === 1) return { title: cases[0].title, message: cases[0].message };
  const changes = cases.map(c => `• ${c.change}`).join('\n');
  const signOut = cases.some(c => c.signsOut) ? '\nThis signs them out of every active session (<15min).' : '';
  return {
    title: 'Confirm User Changes',
    message: `Do you really want to apply these changes to ${name}?\n${changes}${signOut}`
  };
}

async function applyUserUpdate(userId: number, original: EditedUser, userData: UserWrite) {
  const confirmation = getUserUpdateConfirmationCopy(userData, original);
  if (confirmation) {
    const { title, message } = confirmation;
    const confirmed = await promptAdminPasswordConfirmation(
      title,
      message,
      async (adminPassword) => {
        await updateUser(userId, { ...userData, admin_password: adminPassword });
      },
      'Confirm'
    );
    if (!confirmed) return false;
  } else {
    await updateUser(userId, userData);
  }
  const isSelf = userId === state.currentUser?.id;
  if (isSelf && (userData.password || userData.role !== state.currentUser?.role || userData.email !== original.email)) {
    void logout();
    return false;
  }
  return true;
}

function validateUserInput(userData: UserWrite, errorDisplay: HTMLElement) {
  if (!userData.email || !EMAIL_REGEX.test(userData.email)) {
    showUserError(errorDisplay, 'A valid email address is required.');
    byId('user-email', HTMLInputElement).focus();
    return false;
  }
  if (userData.email.length > MAX_EMAIL_LENGTH) {
    showUserError(errorDisplay, `Email must not exceed ${MAX_EMAIL_LENGTH} characters.`);
    byId('user-email', HTMLInputElement).focus();
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
    const pwError = validatePasswordPolicy(userData.password, userData.email);
    if (pwError) {
      showUserError(errorDisplay, pwError);
      return false;
    }
  }

  return true;
}

function showUserError(el: HTMLElement, message: string) {
  el.textContent = message;
  el.classList.remove('hidden');
}

/**
 * Client-side password policy validation.
 * Must match backend rules in validation.go.
 */
export function validatePasswordPolicy(password: string, email: string): string | null {
  if (countCodepoints(password) < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (countUtf8Bytes(password) > MAX_PASSWORD_BYTES) {
    return `Password must not exceed ${MAX_PASSWORD_BYTES} bytes (letters, digits and common symbols count 1, umlauts and accented letters 2, emoji 4)`;
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

export function isBlacklistedPassword(pw: string) {
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

async function renderUserList() {
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
    setUsers(users); // keep the issue modal's assignee dropdown current
    usersList.innerHTML = '';

    // Sort users: Active first, then by email
    users.sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return a.email.localeCompare(b.email);
    });

    users.forEach(user => {
      const row = document.createElement('div');
      row.className = user.active ? 'settings-entry' : 'settings-entry user-inactive';

      const roleBadgeMap: Record<Role, string> = {
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

function setupUserDropdown(triggerId: string, optionsId: string, inputId: string, textId: string) {
  const trigger = document.getElementById(triggerId);
  const options = document.getElementById(optionsId);
  const input = document.getElementById(inputId);
  const text = document.getElementById(textId);
  if (!trigger || !options || !(input instanceof HTMLInputElement) || !text) return;

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
    const option = e.target instanceof Element ? e.target.closest('.custom-option') : null;
    if (!(option instanceof HTMLElement)) return;
    const value = option.dataset.value ?? '';
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
