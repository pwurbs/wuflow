import { fetchLabels, createLabel, deleteLabel, fetchUsers, createUser, updateUser, fetchProjects, createProject, updateProject, deleteProject } from '../api.js';
import { showNotification, showConfirm, getUserInitials, escapeHtml, initCharCounter, countCodepoints } from '../utils.js';
import { state } from '../state.js';
import { userCan, ACTION_CREATE_PROJECT, ACTION_UPDATE_PROJECT, ACTION_LIST_PROJECTS, ACTION_DELETE_PROJECT, ACTION_LIST_LABELS, ACTION_CREATE_LABEL, ACTION_DELETE_LABEL, ACTION_LIST_USERS, ACTION_CREATE_USER, ACTION_UPDATE_USER } from '../permissions.js';

const HINT_EDIT_USER = 'Leave empty to keep current password';
const HINT_NEW_USER = 'Minimum 12 characters. No common passwords.';


let setupViewContainer = null;

export function setupSetupView(refreshCallback) {
  setupViewContainer = document.getElementById('setup-view');
  // Add event listener for adding a label
  const addLabelInput = document.getElementById('new-label-input');
  const addLabelBtn = document.getElementById('add-label-btn');

  if (addLabelBtn && addLabelInput) {
    if (userCan(state.currentUser, ACTION_CREATE_LABEL)) {
      initCharCounter(addLabelInput, 15);

      // Function to handle adding label
      const handleAdd = async () => {
        const name = addLabelInput.value.trim();
        if (!name) return;
        if (countCodepoints(name) > 15) {
          showNotification('Label name must not exceed 15 characters.', 'error');
          return;
        }

        try {
          // Fetch existing labels to check used colors
          const existingLabels = await fetchLabels();
          const usedColors = existingLabels.map(l => l.color);

          const color = getUnusedColor(usedColors);
          await createLabel({ name, color });
          addLabelInput.value = '';
          renderSetupView(refreshCallback); // Refresh list
          if (refreshCallback) refreshCallback(); // Refresh board/app
          showNotification('Label created', 'success');
        } catch (err) {
          console.error(err);
          showNotification('Failed to create label', 'error');
        }
      };

      addLabelBtn.addEventListener('click', handleAdd);
      addLabelInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleAdd();
      });
    } else {
      const group = addLabelBtn.closest('.label-input-group');
      if (group) group.style.display = 'none';
    }
  }

  // User management
  setupUserModal(refreshCallback);

  // Project management
  setupProjectModal(refreshCallback);
}

export async function renderSetupView(refreshCallback) {
  if (!setupViewContainer) return;

  const labelsList = document.getElementById('labels-list');
  if (!labelsList) return;

  const labelsSection = labelsList.closest('.setup-section');
  if (labelsSection) {
    if (userCan(state.currentUser, ACTION_LIST_LABELS)) {
      labelsSection.style.display = '';
    } else {
      labelsSection.style.display = 'none';
      return;
    }
  }

  labelsList.innerHTML = '<div class="loader">Loading...</div>';

  try {
    const labels = await fetchLabels();
    labelsList.innerHTML = ''; // Clear loader

    if (labels.length === 0) {
      labelsList.innerHTML = '';
    }

    labels.forEach(label => {
      const labelEl = document.createElement('div');
      labelEl.className = 'label-item';
      // Match Board Style: Light BG, Border, Colored Text
      const safeColor = /^#[0-9A-Fa-f]{6}$/.test(label.color) ? label.color : '#808080';
      labelEl.style.backgroundColor = safeColor + '20';
      labelEl.style.color = safeColor;
      labelEl.style.border = `1px solid ${safeColor}`;

      labelEl.innerHTML = `
                <span class="label-name">${escapeHtml(label.name)}</span>
                ${userCan(state.currentUser, ACTION_DELETE_LABEL) ? '<button class="delete-label-btn" title="Delete Label">×</button>' : ''}
            `;

      const deleteBtn = labelEl.querySelector('.delete-label-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
          if (!userCan(state.currentUser, ACTION_DELETE_LABEL)) return;
          const confirmed = await showConfirm(
            'Delete Label',
            `Are you sure you want to delete the label "${label.name}"? This action cannot be undone.`
          );
          if (confirmed) {
            try {
              await deleteLabel(label.id);
              renderSetupView(refreshCallback); // Refresh
              if (refreshCallback) refreshCallback(); // Refresh board/app
              showNotification('Label deleted', 'success');
            } catch (err) {
              console.error(err);
              showNotification('Failed to delete label', 'error');
            }
          }
        });
      }

      labelsList.appendChild(labelEl);
    });

  } catch (err) {
    console.error(err);
    labelsList.innerHTML = '<div class="error">Failed to load labels.</div>';
  }

  // Render project list
  await renderProjectList(refreshCallback);

  // Render user list
  await renderUserList(refreshCallback);
}

// --- Project Management ---

let editingProjectId = null;

function setupProjectModal(refreshCallback) {
  const addProjectBtn = document.getElementById('add-project-btn');
  const cancelBtn = document.getElementById('project-modal-cancel');
  const form = document.getElementById('project-form');
  const projectDeleteBtn = document.getElementById('project-modal-delete');

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
  if (countCodepoints(name) > 15) {
    showProjectError(errorDisplay, 'Project name must not exceed 15 characters.');
    return;
  }
  if (countCodepoints(description) > 100) {
    showProjectError(errorDisplay, 'Project description must not exceed 100 characters.');
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
    renderSetupView(refreshCallback);
    if (refreshCallback) refreshCallback();
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
    try {
      await deleteProject(editingProjectId);
      showNotification('Project deleted', 'success');
      closeProjectModal();
      renderSetupView(refreshCallback);
      if (refreshCallback) refreshCallback();
    } catch (err) {
      const errorDisplay = document.getElementById('project-modal-error');
      showProjectError(errorDisplay, err.message);
    } finally {
      cleanup();
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
      row.className = 'user-row';

      const isDefault = project.id === 1;
      const desc = project.description ? escapeHtml(project.description) : '<em>No description</em>';
      const editBtnHtml = userCan(state.currentUser, ACTION_UPDATE_PROJECT)
        ? `<button class="btn secondary project-edit-btn" title="Edit Project">Edit</button>`
        : '';

      row.innerHTML = `
        <div class="user-info">
          <span class="user-email">${escapeHtml(project.name)}</span>
          ${isDefault ? '<span class="user-role-badge admin">default</span>' : ''}
          <span class="user-name">${desc}</span>
        </div>
        <div class="user-meta">
          ${editBtnHtml}
        </div>
      `;

      if (userCan(state.currentUser, ACTION_UPDATE_PROJECT)) {
        const editBtn = row.querySelector('.project-edit-btn');
        editBtn?.addEventListener('click', () => openProjectModal(project));
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
  initCharCounter(document.getElementById('user-first-name'), 50);
  initCharCounter(document.getElementById('user-last-name'), 50);
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
    modalTitle.textContent = 'Edit User';
    emailInput.value = user.email;
    firstNameInput.value = user.first_name;
    lastNameInput.value = user.last_name;
    activeInput.checked = user.active;

    // Set role dropdown value
    roleInput.value = user.role;
    roleText.textContent = user.role === 'admin' ? 'Admin' : 'User';

    // ... existing code ...

    // Password logic for Edit Mode
    passwordInput.placeholder = '';
    passwordInput.required = false;
    passwordHint.textContent = HINT_EDIT_USER;
    passwordHint.classList.remove('hidden');
  } else {
    editingUserId = null;
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
      await updateUser(editingUserId, userData);
    } else {
      await createUser(userData);
    }

    showNotification(isEditing ? 'User updated' : 'User created', 'success');
    closeUserModal();
    renderSetupView(refreshCallback);
  } catch (err) {
    showUserError(errorDisplay, err.message);
  }
}

function validateUserInput(userData, errorDisplay) {
  const emailRegex = /^[^\s@]+@[^\s@]+$/;
  if (!userData.email || !emailRegex.test(userData.email)) {
    showUserError(errorDisplay, 'A valid email address is required.');
    document.getElementById('user-email')?.focus();
    return false;
  }
  if (userData.email.length > 254) {
    showUserError(errorDisplay, 'Email must not exceed 254 characters.');
    document.getElementById('user-email')?.focus();
    return false;
  }
  if (!userData.first_name || !userData.last_name) {
    showUserError(errorDisplay, 'First name and last name are required.');
    return false;
  }
  if (countCodepoints(userData.first_name) > 50 || countCodepoints(userData.last_name) > 50) {
    showUserError(errorDisplay, 'First and last name must not exceed 50 characters.');
    return false;
  }

  if (!editingUserId && !userData.password) {
    showUserError(errorDisplay, 'Password is required for new users');
    return false;
  }

  if (userData.password) {
    if (countCodepoints(userData.password) > 128) {
      showUserError(errorDisplay, 'Password must not exceed 128 characters.');
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
  if (countCodepoints(password) < 12) {
    return 'Password must be at least 12 characters';
  }
  if (email && password.toLowerCase() === email.toLowerCase()) {
    return 'Password must not be your email address';
  }
  if (isBlacklistedPassword(password)) {
    return 'Password is too common';
  }
  return null;
}

const PASSWORD_BLACKLIST = [
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
];

const LEET_REPLACEMENTS = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a',
  '5': 's', '@': 'a', '$': 's', '!': 'i',
};

export function isBlacklistedPassword(pw) {
  let normalized = pw.toLowerCase();

  // Check exact match before leet speak replacement (fixes numeric passwords like 123456)
  if (PASSWORD_BLACKLIST.includes(normalized)) return true;

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
      row.className = user.active ? 'user-row' : 'user-row user-inactive';

      const adminBadge = user.role === 'admin'
        ? `<span class="user-role-badge admin">Admin</span>`
        : '';

      const editBtnHtml = userCan(state.currentUser, ACTION_UPDATE_USER)
        ? '<button class="btn secondary user-edit-btn" title="Edit User">Edit</button>'
        : '';

      row.innerHTML = `
        <div class="user-info">
          <div class="user-badge">${escapeHtml(getUserInitials(user))}</div>
          <span class="user-email">${escapeHtml(user.email)}</span>
          <span class="user-name">(${escapeHtml(user.first_name)} ${escapeHtml(user.last_name)})</span>
          ${adminBadge}
        </div>
        <div class="user-meta">
          ${editBtnHtml}
        </div>
      `;

      if (userCan(state.currentUser, ACTION_UPDATE_USER)) {
        const editBtn = row.querySelector('.user-edit-btn');
        editBtn?.addEventListener('click', () => openUserModal(user));
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


export function getUnusedColor(usedColors) {
  const colors = [
    '#EF5350', '#EC407A', '#AB47BC', '#7E57C2', '#5C6BC0',
    '#42A5F5', '#29B6F6', '#26C6DA', '#26A69A', '#66BB6A',
    '#9CCC65', '#D4E157', '#FFEE58', '#FFCA28', '#FFA726',
    '#FF7043', '#8D6E63', '#78909C'
  ];

  const availableColors = colors.filter(c => !usedColors.includes(c));

  if (availableColors.length > 0) {
    return availableColors[Math.floor(Math.random() * availableColors.length)]; //NOSONAR
  }

  // Fallback: if all colors used, pick random from full list
  return colors[Math.floor(Math.random() * colors.length)]; //NOSONAR
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
