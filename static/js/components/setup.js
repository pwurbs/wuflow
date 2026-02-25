import { fetchLabels, createLabel, deleteLabel, fetchUsers, createUser, updateUser } from '../api.js';
import { showNotification, showConfirm, getUserInitials, escapeHtml, initCharCounter, countCodepoints } from '../utils.js';
import { state } from '../state.js';

const HINT_EDIT_USER = 'Leave empty to keep current password';
const HINT_NEW_USER = 'Minimum 12 characters. No common passwords.';


let setupViewContainer = null;

export function setupSetupView(refreshCallback) {
  setupViewContainer = document.getElementById('setup-view');
  // Add event listener for adding a label
  const addLabelInput = document.getElementById('new-label-input');
  const addLabelBtn = document.getElementById('add-label-btn');

  if (addLabelBtn && addLabelInput) {
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
  }

  // User management
  setupUserModal(refreshCallback);
}

export async function renderSetupView(refreshCallback) {
  if (!setupViewContainer) return;

  const labelsList = document.getElementById('labels-list');
  if (!labelsList) return;

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
                <button class="delete-label-btn" title="Delete Label">×</button>
            `;

      const deleteBtn = labelEl.querySelector('.delete-label-btn');
      deleteBtn.addEventListener('click', async () => {
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

      labelsList.appendChild(labelEl);
    });

  } catch (err) {
    console.error(err);
    labelsList.innerHTML = '<div class="error">Failed to load labels.</div>';
  }

  // Render user list (admin only)
  await renderUserList(refreshCallback);
}

// --- User Management ---

let editingUserId = null;

function setupUserModal(refreshCallback) {
  const addUserBtn = document.getElementById('add-user-btn');
  const cancelBtn = document.getElementById('user-modal-cancel');
  const form = document.getElementById('user-form');

  if (addUserBtn) {
    addUserBtn.addEventListener('click', () => openUserModal(null));
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

  // --- Client-side field validation ---
  const emailRegex = /^[^\s@]+@[^\s@]+$/;
  if (!userData.email || !emailRegex.test(userData.email)) {
    showUserError(errorDisplay, 'A valid email address is required.');
    emailInput.focus();
    return;
  }
  if (userData.email.length > 254) {
    showUserError(errorDisplay, 'Email must not exceed 254 characters.');
    emailInput.focus();
    return;
  }
  if (!userData.first_name || !userData.last_name) {
    showUserError(errorDisplay, 'First name and last name are required.');
    return;
  }
  if (countCodepoints(userData.first_name) > 50 || countCodepoints(userData.last_name) > 50) {
    showUserError(errorDisplay, 'First and last name must not exceed 50 characters.');
    return;
  }
  // --- End field validation ---

  // Include password only if provided
  if (passwordInput.value) {
    userData.password = passwordInput.value;
  }

  // Client-side password validation (create mode requires password)
  if (!editingUserId && !userData.password) {
    showUserError(errorDisplay, 'Password is required for new users');
    return;
  }

  if (userData.password) {
    if (countCodepoints(userData.password) > 128) {
      showUserError(errorDisplay, 'Password must not exceed 128 characters.');
      return;
    }
    const pwError = validatePasswordPolicy(userData.password, userData.email);
    if (pwError) {
      showUserError(errorDisplay, pwError);
      return;
    }
  }

  try {
    if (editingUserId) {
      await updateUser(editingUserId, userData);
      showNotification('User updated', 'success');
    } else {
      await createUser(userData);
      showNotification('User created', 'success');
    }
    closeUserModal();
    renderSetupView(refreshCallback);
  } catch (err) {
    showUserError(errorDisplay, err.message);
  }
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

  // Only show user management for admins
  if (state.currentUser?.role !== 'admin') {
    userSection.classList.add('hidden');
    return;
  }
  userSection.classList.remove('hidden');

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

      row.innerHTML = `
        <div class="user-info">
          <div class="user-badge">${escapeHtml(getUserInitials(user))}</div>
          <span class="user-email">${escapeHtml(user.email)}</span>
          <span class="user-name">(${escapeHtml(user.first_name)} ${escapeHtml(user.last_name)})</span>
          ${adminBadge}
        </div>
        <div class="user-meta">
          <button class="btn secondary user-edit-btn" title="Edit User">Edit</button>
        </div>
      `;

      const editBtn = row.querySelector('.user-edit-btn');
      editBtn.addEventListener('click', () => openUserModal(user));

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
    return availableColors[Math.floor(Math.random() * availableColors.length)];
  }

  // Fallback: if all colors used, pick random from full list
  return colors[Math.floor(Math.random() * colors.length)];
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
