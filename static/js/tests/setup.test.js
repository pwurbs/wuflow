import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupSetupView, renderSetupView, validatePasswordPolicy, isBlacklistedPassword, isLight, getUnusedColor } from '../components/setup.js';
import * as api from '../api.js';
import * as utils from '../utils.js';
import * as permissions from '../permissions.js';
import { state } from '../state.js';

// Helper to generate random pass
function generateRandomPassword() {
  return btoa(Math.random().toString()).slice(0, 16) + 'U1!'; // NOSONAR
}

// Mock dependencies
vi.mock('../api.js', () => ({
  fetchLabels: vi.fn(),
  createLabel: vi.fn(),
  deleteLabel: vi.fn(),
  fetchUsers: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  fetchProjects: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn()
}));

vi.mock('../utils.js', () => ({
  showNotification: vi.fn(),
  showConfirm: vi.fn(),
  getUserInitials: vi.fn().mockReturnValue('AD'),
  escapeHtml: vi.fn((str) => str),
  initCharCounter: vi.fn(() => ({ show: vi.fn(), hide: vi.fn() })),
  countCodepoints: vi.fn(s => [...s].length)
}));

vi.mock('../permissions.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    userCan: vi.fn()
  };
});

vi.mock('../state.js', () => ({
  state: {
    currentUser: { role: 'admin' }
  }
}));

describe('setup.js component', () => {
  beforeEach(() => {
    // Setup DOM
    document.body.innerHTML = `
      <div id="setup-view">
        <div class="setup-section">
          <input type="text" id="new-label-input">
          <button id="add-label-btn"></button>
          <div id="labels-list"></div>
        </div>
        <div id="user-management-section">
          <button id="add-user-btn"></button>
          <div id="users-list"></div>
        </div>
      </div>

      <!-- User Modal -->
      <div id="user-modal-overlay" class="modal-overlay hidden">
        <h2 id="user-modal-title"></h2>
        <form id="user-form">
          <input type="text" id="user-email">
          <input type="text" id="user-first-name">
          <input type="text" id="user-last-name">
          <input type="password" id="user-password">
          <small id="user-password-hint"></small>
          <div id="user-role-dropdown">
            <input type="hidden" id="user-role">
            <button type="button" id="user-role-trigger">
              <span id="user-role-text"></span>
            </button>
            <div id="user-role-options" class="hidden">
              <div class="custom-option" data-value="user">User</div>
              <div class="custom-option" data-value="admin">Admin</div>
              <div class="custom-option" data-value="sysadmin">Sysadmin</div>
            </div>
          </div>
          <div id="user-active-options" class="hidden"></div>
          <input type="checkbox" id="user-active">
          <div id="user-modal-error" class="hidden"></div>
          <button type="button" id="user-modal-cancel"></button>
          <button type="submit" id="user-modal-save"></button>
        </form>
      </div>
    `;

    vi.clearAllMocks();
    // Default mock returns
    api.fetchLabels.mockResolvedValue([]);
    api.fetchUsers.mockResolvedValue([]);
    permissions.userCan.mockReturnValue(true);
    // Suppress console.error in tests
    vi.spyOn(console, 'error').mockImplementation(() => { });
  });

  describe('Label Management', () => {
    it('should initialize and attach listeners', () => {
      const refreshCallback = vi.fn();
      setupSetupView(refreshCallback);

      const addBtn = document.getElementById('add-label-btn');
      expect(addBtn).toBeTruthy();
    });

    it('should handle adding a new label', async () => {
      const refreshCallback = vi.fn();
      setupSetupView(refreshCallback);

      const input = document.getElementById('new-label-input');
      const addBtn = document.getElementById('add-label-btn');

      input.value = 'New Label';
      api.fetchLabels.mockResolvedValue([]);
      api.createLabel.mockResolvedValue({ id: 1, name: 'New Label', color: '#EF5350' });

      addBtn.click();

      await new Promise(process.nextTick);

      expect(api.createLabel).toHaveBeenCalledWith(expect.objectContaining({
        name: 'New Label',
        color: expect.stringMatching(/^#/)
      }));
      expect(input.value).toBe('');
      expect(utils.showNotification).toHaveBeenCalledWith('Label created', 'success');
    });

    it('should handle label deletion', async () => {
      const refreshCallback = vi.fn();
      api.fetchLabels.mockResolvedValue([{ id: 1, name: 'To Delete', color: '#FF0000' }]);
      utils.showConfirm.mockResolvedValue(true);

      await renderSetupView(refreshCallback);

      const deleteBtn = document.querySelector('.delete-label-btn');
      deleteBtn.click();

      await new Promise(process.nextTick);

      expect(utils.showConfirm).toHaveBeenCalled();
      expect(api.deleteLabel).toHaveBeenCalledWith(1);
      expect(utils.showNotification).toHaveBeenCalledWith('Label deleted', 'success');
    });

    it('should handle Enter key for adding a label', async () => {
      setupSetupView();
      const input = document.getElementById('new-label-input');
      input.value = 'Enter Label';
      api.createLabel.mockResolvedValue({ id: 2 });

      const event = new KeyboardEvent('keypress', { key: 'Enter' });
      input.dispatchEvent(event);

      await new Promise(process.nextTick);
      expect(api.createLabel).toHaveBeenCalled();
    });

    it('should show error if label creation fails', async () => {
      setupSetupView();
      const input = document.getElementById('new-label-input');
      input.value = 'Fail Label';
      api.createLabel.mockRejectedValue(new Error('Failed'));

      document.getElementById('add-label-btn').click();
      await new Promise(process.nextTick);

      expect(utils.showNotification).toHaveBeenCalledWith('Failed to create label', 'error');
    });

    it('should show error if label name is too long', async () => {
      setupSetupView();
      const input = document.getElementById('new-label-input');
      input.value = 'a'.repeat(16); // Max 15
      document.getElementById('add-label-btn').click();

      expect(api.createLabel).not.toHaveBeenCalled();
      expect(utils.showNotification).toHaveBeenCalledWith('Label name must not exceed 15 characters.', 'error');
    });
  });

  describe('User Management Rendering', () => {
    it('should hide user management section for non-sysadmins', async () => {
      // simulate userCan returning false for ACTION_LIST_USERS (non-sysadmin context)
      state.currentUser = { role: 'user' };
      permissions.userCan.mockImplementation((user, action) => {
        return !(action === permissions.ACTION_LIST_USERS && user.role !== 'sysadmin');
      });
      await renderSetupView();
      expect(document.getElementById('user-management-section').classList.contains('hidden')).toBe(true);
    });

    it('should show and render user list for sysadmins', async () => {
      state.currentUser = { role: 'sysadmin' };
      permissions.userCan.mockReturnValue(true);
      const users = [
        { id: 1, email: 'sysadmin@test.com', first_name: 'Sys', last_name: 'Admin', role: 'sysadmin', active: true },
        { id: 2, email: 'admin@test.com', first_name: 'Ad', last_name: 'Min', role: 'admin', active: true },
        { id: 3, email: 'user@test.com', first_name: 'Us', last_name: 'Er', role: 'user', active: true }
      ];
      api.fetchUsers.mockResolvedValue(users);

      await renderSetupView();

      expect(document.getElementById('user-management-section').classList.contains('hidden')).toBe(false);
      const rows = document.querySelectorAll('.user-row');
      expect(rows.length).toBe(3);
      // Users are sorted by email: admin < sysadmin < user
      expect(rows[0].textContent).toContain('admin@test.com');
      expect(rows[0].textContent).toContain('Admin');
      expect(rows[1].textContent).toContain('sysadmin@test.com');
      expect(rows[1].textContent).toContain('Sysadmin');
    });

    it('should escape user initials to prevent XSS', async () => {
      state.currentUser = { role: 'admin' };
      const users = [
        { id: 1, email: 'xss@test.com', first_name: '<', last_name: 'S', role: 'user', active: true }
      ];
      api.fetchUsers.mockResolvedValue(users);
      utils.getUserInitials.mockReturnValue('<S');

      // Use a safer mock or just check if it was called correctly
      // The original mock is escapeHtml: vi.fn((str) => str)
      // We want to verify it's called with the initials.

      await renderSetupView();

      expect(utils.getUserInitials).toHaveBeenCalled();
      expect(utils.escapeHtml).toHaveBeenCalledWith('<S');

      // Reset mocks to avoid breaking subsequent tests
      utils.getUserInitials.mockReturnValue('AD');
    });
  });

  describe('User Modal', () => {
    it('should open modal for new user', () => {
      setupSetupView();
      document.getElementById('add-user-btn').click();

      expect(document.getElementById('user-modal-overlay').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('user-modal-title').textContent).toBe('New User');
      expect(document.getElementById('user-password').required).toBe(true);
    });

    it('should open modal for editing user', async () => {
      state.currentUser = { role: 'admin' };
      const user = { id: 1, email: 'edit@test.com', first_name: 'E', last_name: 'D', role: 'user', active: true };
      api.fetchUsers.mockResolvedValue([user]);

      await renderSetupView();

      const editBtn = document.querySelector('.user-edit-btn');
      editBtn.click();

      expect(document.getElementById('user-modal-overlay').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('user-modal-title').textContent).toBe('Edit User');
      expect(document.getElementById('user-email').value).toBe('edit@test.com');
      expect(document.getElementById('user-password').required).toBe(false);
    });

    it('should handle user form submission (create)', async () => {
      setupSetupView();
      document.getElementById('add-user-btn').click();

      document.getElementById('user-email').value = 'new@test.com';
      document.getElementById('user-first-name').value = 'New';
      document.getElementById('user-last-name').value = 'User';
      const password = generateRandomPassword();
      document.getElementById('user-password').value = password;
      document.getElementById('user-role').value = 'user';
      document.getElementById('user-active').checked = true;

      api.createUser.mockResolvedValue({ id: 3 });

      const form = document.getElementById('user-form');
      form.dispatchEvent(new Event('submit'));

      await new Promise(process.nextTick);

      expect(api.createUser).toHaveBeenCalledWith(expect.objectContaining({
        email: 'new@test.com',
        password: password
      }));
      expect(document.getElementById('user-modal-overlay').classList.contains('hidden')).toBe(true);
    });

    it('should handle user form submission (update)', async () => {
      state.currentUser = { role: 'admin' };
      const user = { id: 1, email: 'edit@test.com', role: 'user', active: true };
      api.fetchUsers.mockResolvedValue([user]);
      setupSetupView();
      await renderSetupView();
      document.querySelector('.user-edit-btn').click();

      document.getElementById('user-first-name').value = 'Updated';
      api.updateUser.mockResolvedValue({});

      const form = document.getElementById('user-form');
      form.dispatchEvent(new Event('submit'));

      await new Promise(process.nextTick);

      expect(api.updateUser).toHaveBeenCalledWith(1, expect.objectContaining({
        first_name: 'Updated'
      }));
    });

    it('should show error for missing password on new user', async () => {
      setupSetupView();
      document.getElementById('add-user-btn').click();
      document.getElementById('user-email').value = 'valid@email.com';
      document.getElementById('user-first-name').value = 'Test';
      document.getElementById('user-last-name').value = 'User';
      document.getElementById('user-password').value = '';

      const form = document.getElementById('user-form');
      form.dispatchEvent(new Event('submit'));

      expect(document.getElementById('user-modal-error').textContent).toBe('Password is required for new users');
      expect(document.getElementById('user-modal-error').classList.contains('hidden')).toBe(false);
    });

    it('should show error for invalid email format', async () => {
      setupSetupView();
      document.getElementById('add-user-btn').click();
      document.getElementById('user-email').value = 'invalid-email';

      const form = document.getElementById('user-form');
      form.dispatchEvent(new Event('submit'));

      expect(document.getElementById('user-modal-error').textContent).toBe('A valid email address is required.');
      expect(document.getElementById('user-modal-error').classList.contains('hidden')).toBe(false);
    });

    it('should show error for long names', async () => {
      setupSetupView();
      document.getElementById('add-user-btn').click();
      document.getElementById('user-email').value = 'valid@test.com';
      document.getElementById('user-first-name').value = 'a'.repeat(51); // Max 50
      document.getElementById('user-last-name').value = 'Valid';

      const form = document.getElementById('user-form');
      form.dispatchEvent(new Event('submit'));

      expect(document.getElementById('user-modal-error').textContent).toBe('First and last name must not exceed 50 characters.');
    });

    it('should NOT close on overlay click', () => {
      setupSetupView();
      document.getElementById('add-user-btn').click();
      const overlay = document.getElementById('user-modal-overlay');
      overlay.click();
      expect(overlay.classList.contains('hidden')).toBe(false);
    });
  });

  describe('Dropdowns and Support', () => {
    it('should toggle dropdown and close others', () => {
      setupSetupView();
      const trigger = document.getElementById('user-role-trigger');
      const options = document.getElementById('user-role-options');
      const otherOptions = document.getElementById('user-active-options');

      otherOptions.classList.remove('hidden');
      trigger.click(); // Opens
      expect(options.classList.contains('hidden')).toBe(false);
      expect(otherOptions.classList.contains('hidden')).toBe(true);

      trigger.click(); // Closes
      expect(options.classList.contains('hidden')).toBe(true);
    });

    it('should select option from dropdown', () => {
      setupSetupView();
      document.getElementById('user-role-trigger').click();
      const adminOption = document.querySelector('.custom-option[data-value="admin"]');
      adminOption.click();

      expect(document.getElementById('user-role').value).toBe('admin');
      expect(document.getElementById('user-role-text').textContent).toBe('Admin');
      expect(document.getElementById('user-role-options').classList.contains('hidden')).toBe(true);
    });
  });
});

describe('Utility Functions', () => {
  it('isLight should correctly identify light colors', () => {
    expect(isLight('#FFFFFF')).toBe(true); // White
    expect(isLight('#000000')).toBe(false); // Black
    expect(isLight('#FFFF00')).toBe(true); // Yellow
    expect(isLight('#0000FF')).toBe(false); // Blue
  });
});

describe('Password Policy', () => {
  describe('isBlacklistedPassword', () => {
    it('should identify direct matches in blacklist', () => {
      expect(isBlacklistedPassword('password')).toBe(true);
      expect(isBlacklistedPassword('admin')).toBe(true);
      expect(isBlacklistedPassword('123456')).toBe(true);
    });

    it('should be case insensitive', () => {
      expect(isBlacklistedPassword('PASSWORD')).toBe(true);
      expect(isBlacklistedPassword('Admin')).toBe(true);
    });

    it('should identify leet speak variations', () => {
      expect(isBlacklistedPassword('p@ssw0rd')).toBe(true);
      expect(isBlacklistedPassword('4dm!n')).toBe(true);
    });

    it('should allow non-blacklisted passwords', () => {
      expect(isBlacklistedPassword('CorrectHorseBatteryStaple')).toBe(false);
    });
  });

  describe('validatePasswordPolicy', () => {
    it('should return null for valid passwords', () => {
      expect(validatePasswordPolicy('CorrectHorseBatteryStaple')).toBeNull();
    });

    it('should reject passwords shorter than 12 characters', () => {
      expect(validatePasswordPolicy('short')).toBe('Password must be at least 12 characters');
    });

    it('should reject passwords matching email', () => {
      expect(validatePasswordPolicy('user@example.com', 'user@example.com')).toBe('Password must not be your email address');
    });

    it('should reject blacklisted passwords', () => {
      expect(validatePasswordPolicy('password1234')).toBe('Password is too common');
    });
  });
});

describe('Additional Coverage', () => {
  describe('Label Management Error Paths', () => {
    it('should handle label fetch failure', async () => {
      api.fetchLabels.mockRejectedValue(new Error('Fetch failed'));
      await renderSetupView();
      expect(document.getElementById('labels-list').innerHTML).toContain('Failed to load labels');
    });

    it('should handle label delete failure', async () => {
      const refreshCallback = vi.fn();
      api.fetchLabels.mockResolvedValue([{ id: 1, name: 'To Delete', color: '#FF0000' }]);
      utils.showConfirm.mockResolvedValue(true);
      api.deleteLabel.mockRejectedValue(new Error('Delete failed'));

      await renderSetupView(refreshCallback);
      const deleteBtn = document.querySelector('.delete-label-btn');
      deleteBtn.click();

      await new Promise(process.nextTick);
      expect(utils.showNotification).toHaveBeenCalledWith('Failed to delete label', 'error');
    });
  });
  describe('User Management Validation & Errors', () => {
    beforeEach(async () => {
      // Re-initialize DOM specifically for these tests to guarantee elements exist
      document.body.innerHTML = `
        <div id="setup-view">
          <div class="setup-section">
            <input type="text" id="new-label-input">
            <button id="add-label-btn"></button>
            <div id="labels-list"></div>
          </div>
          <div id="user-management-section">
            <button id="add-user-btn"></button>
            <div id="users-list"></div>
          </div>
        </div>

        <div id="user-modal-overlay" class="modal-overlay hidden">
          <h2 id="user-modal-title"></h2>
          <form id="user-form">
            <input type="text" id="user-email">
            <input type="text" id="user-first-name">
            <input type="text" id="user-last-name">
            <input type="password" id="user-password">
            <small id="user-password-hint"></small>
            <div id="user-role-dropdown">
              <input type="hidden" id="user-role">
              <button type="button" id="user-role-trigger">
                <span id="user-role-text"></span>
              </button>
              <div id="user-role-options" class="hidden">
                <div class="custom-option" data-value="user">User</div>
                <div class="custom-option" data-value="admin">Admin</div>
                <div class="custom-option" data-value="sysadmin">Sysadmin</div>
              </div>
            </div>
            <div id="user-active-options" class="hidden"></div>
            <input type="checkbox" id="user-active">
            <div id="user-modal-error" class="hidden"></div>
            <button type="button" id="user-modal-cancel"></button>
            <button type="submit" id="user-modal-save"></button>
          </form>
        </div>
      `;
      state.currentUser = { role: 'admin' };
      setupSetupView();
      await renderSetupView();
      document.getElementById('add-user-btn').click();
    });

    it('should handle user fetch failure', async () => {
      api.fetchUsers.mockRejectedValue(new Error('Fetch failed'));
      await renderSetupView();
      expect(document.getElementById('users-list').innerHTML).toContain('Failed to load users');
    });

    it('should validate email length', async () => {
      document.getElementById('user-email').value = 'a'.repeat(250) + '@test.com';
      document.getElementById('user-first-name').value = 'New';
      document.getElementById('user-last-name').value = 'User';
      document.getElementById('user-form').dispatchEvent(new Event('submit'));
      await new Promise(process.nextTick);
      expect(document.getElementById('user-modal-error').textContent).toBe('Email must not exceed 254 characters.');
    });

    it('should validate missing names', async () => {
      document.getElementById('user-email').value = 'test@test.com';
      document.getElementById('user-first-name').value = '';
      document.getElementById('user-last-name').value = '';
      document.getElementById('user-form').dispatchEvent(new Event('submit'));
      await new Promise(process.nextTick);
      expect(document.getElementById('user-modal-error').textContent).toBe('First name and last name are required.');
    });

    it('should validate name length', async () => {
      document.getElementById('user-email').value = 'test@test.com';
      document.getElementById('user-first-name').value = 'a'.repeat(51);
      document.getElementById('user-last-name').value = 'User';
      document.getElementById('user-form').dispatchEvent(new Event('submit'));
      await new Promise(process.nextTick);
      expect(document.getElementById('user-modal-error').textContent).toBe('First and last name must not exceed 50 characters.');
    });

    it('should validate password length', async () => {
      document.getElementById('user-email').value = 'test@test.com';
      document.getElementById('user-first-name').value = 'First';
      document.getElementById('user-last-name').value = 'Last';
      document.getElementById('user-password').value = 'a'.repeat(129);
      document.getElementById('user-form').dispatchEvent(new Event('submit'));
      await new Promise(process.nextTick);
      expect(document.getElementById('user-modal-error').textContent).toBe('Password must not exceed 128 characters.');
    });

    it('should handle user creation failure', async () => {
      document.getElementById('user-email').value = 'fail@test.com';
      document.getElementById('user-first-name').value = 'Fail';
      document.getElementById('user-last-name').value = 'User';
      document.getElementById('user-password').value = generateRandomPassword();
      api.createUser.mockRejectedValue(new Error('Creation failed'));
      document.getElementById('user-form').dispatchEvent(new Event('submit'));
      await new Promise(process.nextTick);
      expect(document.getElementById('user-modal-error').textContent).toBe('Creation failed');
    });

    it('should trigger password policy error in handleUserSubmit', async () => {
      document.getElementById('user-email').value = 'test@test.com';
      document.getElementById('user-first-name').value = 'First';
      document.getElementById('user-last-name').value = 'Last';
      document.getElementById('user-password').value = 'too-short'; //NOSONAR
      document.getElementById('user-form').dispatchEvent(new Event('submit'));
      await new Promise(process.nextTick);
      expect(document.getElementById('user-modal-error').textContent).toBe('Password must be at least 12 characters');
    });
  });

  describe('Utilities', () => {
    it('getUnusedColor should fallback to full list if all colors used', () => {
      const fullList = [
        '#EF5350', '#EC407A', '#AB47BC', '#7E57C2', '#5C6BC0',
        '#42A5F5', '#29B6F6', '#26C6DA', '#26A69A', '#66BB6A',
        '#9CCC65', '#D4E157', '#FFEE58', '#FFCA28', '#FFA726',
        '#FF7043', '#8D6E63', '#78909C'
      ];
      // If all are used, it should still return a color from the list
      const result = getUnusedColor(fullList);
      expect(fullList).toContain(result);
    });

    it('isLight should handle colors with no # or different case', () => {
      // isLight(color) uses color.replaceAll('#', '')
      expect(isLight('FFFFFF')).toBe(true);
      expect(isLight('#000000')).toBe(false);
    });
  });
});

const PROJECT_DOM = `
  <div id="setup-view">
    <div class="setup-section">
      <input type="text" id="new-label-input">
      <button id="add-label-btn"></button>
      <div id="labels-list"></div>
    </div>
    <div id="project-management-section">
      <button id="add-project-btn"></button>
      <div id="projects-list"></div>
    </div>
    <div id="user-management-section">
      <button id="add-user-btn"></button>
      <div id="users-list"></div>
    </div>
  </div>

  <!-- Project Modal -->
  <div id="project-modal-overlay" class="hidden">
    <h2 id="project-modal-title"></h2>
    <form id="project-form">
      <input type="text" id="project-name">
      <textarea id="project-description"></textarea>
      <div id="project-modal-error" class="hidden"></div>
      <button type="button" id="project-modal-cancel"></button>
      <button type="button" id="project-modal-delete" class="hidden"></button>
      <button type="submit" id="project-modal-save"></button>
    </form>
  </div>

  <!-- Confirm Modal -->
  <div id="confirm-modal" class="hidden">
    <h2 id="confirm-title"></h2>
    <p id="confirm-message"></p>
    <button id="confirm-ok-btn"></button>
    <button id="confirm-cancel-btn"></button>
  </div>

  <!-- User Modal (required by setupUserModal) -->
  <div id="user-modal-overlay" class="modal-overlay hidden">
    <h2 id="user-modal-title"></h2>
    <form id="user-form">
      <input type="text" id="user-email">
      <input type="text" id="user-first-name">
      <input type="text" id="user-last-name">
      <input type="password" id="user-password">
      <small id="user-password-hint"></small>
      <div id="user-role-dropdown">
        <input type="hidden" id="user-role">
        <button type="button" id="user-role-trigger"><span id="user-role-text"></span></button>
        <div id="user-role-options" class="hidden">
          <div class="custom-option" data-value="user">User</div>
          <div class="custom-option" data-value="admin">Admin</div>
          <div class="custom-option" data-value="sysadmin">Sysadmin</div>
        </div>
      </div>
      <div id="user-active-options" class="hidden"></div>
      <input type="checkbox" id="user-active">
      <div id="user-modal-error" class="hidden"></div>
      <button type="button" id="user-modal-cancel"></button>
      <button type="submit" id="user-modal-save"></button>
    </form>
  </div>
`;

describe('Project Management', () => {
  beforeEach(() => {
    document.body.innerHTML = PROJECT_DOM;
    state.currentUser = { role: 'admin' };
    vi.clearAllMocks();
    api.fetchLabels.mockResolvedValue([]);
    api.fetchUsers.mockResolvedValue([]);
    api.fetchProjects.mockResolvedValue([]);
    permissions.userCan.mockReturnValue(true);
    vi.spyOn(console, 'error').mockImplementation(() => { });

    setupSetupView();
  });

  describe('setupProjectModal', () => {
    it('should open project modal for new project on add-project-btn click', () => {
      document.getElementById('add-project-btn').click();
      expect(document.getElementById('project-modal-overlay').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('project-modal-title').textContent).toBe('New Project');
      expect(document.getElementById('project-modal-delete').classList.contains('hidden')).toBe(true);
    });

    it('should close project modal on cancel click', () => {
      document.getElementById('add-project-btn').click();
      expect(document.getElementById('project-modal-overlay').classList.contains('hidden')).toBe(false);
      document.getElementById('project-modal-cancel').click();
      expect(document.getElementById('project-modal-overlay').classList.contains('hidden')).toBe(true);
    });
  });

  describe('openProjectModal for edit', () => {
    it('should populate form when opening for an existing project', async () => {
      const project = { id: 2, name: 'My Project', description: 'desc' };
      api.fetchProjects.mockResolvedValue([project]);
      await renderSetupView();

      const editBtn = document.querySelector('.project-edit-btn');
      editBtn.click();

      expect(document.getElementById('project-modal-overlay').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('project-modal-title').textContent).toBe('Edit Project');
      expect(document.getElementById('project-name').value).toBe('My Project');
      expect(document.getElementById('project-description').value).toBe('desc');
    });

    it('should hide delete button for the default project (id 1)', async () => {
      const project = { id: 1, name: 'default', description: '' };
      api.fetchProjects.mockResolvedValue([project]);
      await renderSetupView();

      document.querySelector('.project-edit-btn').click();

      expect(document.getElementById('project-modal-delete').classList.contains('hidden')).toBe(true);
    });

    it('should show delete button for non-default project with permission', async () => {
      const project = { id: 2, name: 'Other', description: '' };
      api.fetchProjects.mockResolvedValue([project]);
      await renderSetupView();

      document.querySelector('.project-edit-btn').click();

      expect(document.getElementById('project-modal-delete').classList.contains('hidden')).toBe(false);
    });
  });

  describe('handleProjectSubmit', () => {
    it('should show error when name is empty', () => {
      document.getElementById('add-project-btn').click();
      document.getElementById('project-name').value = '';
      document.getElementById('project-form').dispatchEvent(new Event('submit'));

      const err = document.getElementById('project-modal-error');
      expect(err.textContent).toBe('Project name is required.');
      expect(err.classList.contains('hidden')).toBe(false);
    });

    it('should show error when name exceeds 15 characters', () => {
      document.getElementById('add-project-btn').click();
      document.getElementById('project-name').value = 'a'.repeat(16);
      document.getElementById('project-form').dispatchEvent(new Event('submit'));

      expect(document.getElementById('project-modal-error').textContent)
        .toBe('Project name must not exceed 15 characters.');
    });

    it('should show error when description exceeds 100 characters', () => {
      document.getElementById('add-project-btn').click();
      document.getElementById('project-name').value = 'Valid';
      document.getElementById('project-description').value = 'a'.repeat(101);
      document.getElementById('project-form').dispatchEvent(new Event('submit'));

      expect(document.getElementById('project-modal-error').textContent)
        .toBe('Project description must not exceed 100 characters.');
    });

    it('should create project and show success notification', async () => {
      api.createProject.mockResolvedValue({ id: 5, name: 'New' });
      document.getElementById('add-project-btn').click();
      document.getElementById('project-name').value = 'New';
      document.getElementById('project-form').dispatchEvent(new Event('submit'));

      await new Promise(process.nextTick);

      expect(api.createProject).toHaveBeenCalledWith(expect.objectContaining({ name: 'New' }));
      expect(utils.showNotification).toHaveBeenCalledWith('Project created', 'success');
      expect(document.getElementById('project-modal-overlay').classList.contains('hidden')).toBe(true);
    });

    it('should update project and show success notification', async () => {
      const project = { id: 2, name: 'Existing', description: '' };
      api.fetchProjects.mockResolvedValue([project]);
      api.updateProject.mockResolvedValue({});
      await renderSetupView();

      document.querySelector('.project-edit-btn').click();
      document.getElementById('project-name').value = 'Updated';
      document.getElementById('project-form').dispatchEvent(new Event('submit'));

      await new Promise(process.nextTick);

      expect(api.updateProject).toHaveBeenCalledWith(2, expect.objectContaining({ name: 'Updated' }));
      expect(utils.showNotification).toHaveBeenCalledWith('Project updated', 'success');
    });

    it('should show error in modal when API call fails', async () => {
      api.createProject.mockRejectedValue(new Error('API Error'));
      document.getElementById('add-project-btn').click();
      document.getElementById('project-name').value = 'Fail';
      document.getElementById('project-form').dispatchEvent(new Event('submit'));

      await new Promise(process.nextTick);

      expect(document.getElementById('project-modal-error').textContent).toBe('API Error');
    });
  });

  describe('handleDeleteProject', () => {
    it('should show confirm modal and delete project on confirm', async () => {
      const project = { id: 2, name: 'To Delete', description: '' };
      api.fetchProjects.mockResolvedValue([project]);
      api.deleteProject.mockResolvedValue({});
      await renderSetupView();

      document.querySelector('.project-edit-btn').click();

      document.getElementById('project-modal-delete').click();

      expect(document.getElementById('confirm-modal').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('confirm-title').textContent).toBe('Delete Project');

      document.getElementById('confirm-ok-btn').click();
      await new Promise(process.nextTick);

      expect(api.deleteProject).toHaveBeenCalledWith(2);
      expect(utils.showNotification).toHaveBeenCalledWith('Project deleted', 'success');
      expect(document.getElementById('project-modal-overlay').classList.contains('hidden')).toBe(true);
      expect(document.getElementById('confirm-modal').classList.contains('hidden')).toBe(true);
    });

    it('should hide confirm modal on cancel without deleting', async () => {
      const project = { id: 3, name: 'Keep Me', description: '' };
      api.fetchProjects.mockResolvedValue([project]);
      await renderSetupView();

      document.querySelector('.project-edit-btn').click();
      document.getElementById('project-modal-delete').click();

      document.getElementById('confirm-cancel-btn').click();

      expect(api.deleteProject).not.toHaveBeenCalled();
      expect(document.getElementById('confirm-modal').classList.contains('hidden')).toBe(true);
    });

    it('should show error in project modal when delete API fails', async () => {
      const project = { id: 4, name: 'Fail Delete', description: '' };
      api.fetchProjects.mockResolvedValue([project]);
      api.deleteProject.mockRejectedValue(new Error('Delete failed'));
      await renderSetupView();

      document.querySelector('.project-edit-btn').click();
      document.getElementById('project-modal-delete').click();
      document.getElementById('confirm-ok-btn').click();

      await new Promise(process.nextTick);

      expect(document.getElementById('project-modal-error').textContent).toBe('Delete failed');
    });
  });

  describe('renderProjectList', () => {
    it('should hide project section when user lacks LIST_PROJECTS permission', async () => {
      permissions.userCan.mockImplementation((user, action) => {
        return action !== permissions.ACTION_LIST_PROJECTS;
      });
      await renderSetupView();

      expect(document.getElementById('project-management-section').style.display).toBe('none');
    });

    it('should render project rows', async () => {
      const projects = [
        { id: 1, name: 'default', description: '' },
        { id: 2, name: 'Alpha', description: 'Alpha project' }
      ];
      api.fetchProjects.mockResolvedValue(projects);
      await renderSetupView();

      const rows = document.querySelectorAll('#projects-list .user-row');
      expect(rows.length).toBe(2);
      expect(rows[0].textContent).toContain('default');
      expect(rows[1].textContent).toContain('Alpha');
    });

    it('should show "default" badge for project with id 1', async () => {
      api.fetchProjects.mockResolvedValue([{ id: 1, name: 'default', description: '' }]);
      await renderSetupView();

      const row = document.querySelector('#projects-list .user-row');
      expect(row.textContent).toContain('default');
      expect(row.innerHTML).toContain('admin');
    });

    it('should show error message when fetchProjects fails', async () => {
      api.fetchProjects.mockRejectedValue(new Error('Fetch failed'));
      await renderSetupView();

      expect(document.getElementById('projects-list').innerHTML).toContain('Failed to load projects');
    });

    it('should hide add-project-btn when user lacks CREATE_PROJECT permission', async () => {
      permissions.userCan.mockImplementation((user, action) => {
        return action !== permissions.ACTION_CREATE_PROJECT;
      });
      api.fetchProjects.mockResolvedValue([]);
      await renderSetupView();

      expect(document.getElementById('add-project-btn').style.display).toBe('none');
    });
  });
});
