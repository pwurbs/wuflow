import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupSystemSettingsView, renderSystemSettingsView, validatePasswordPolicy, isBlacklistedPassword, isLight } from '../components/system-settings.js';
import { getUnusedColor } from '../utils.js';
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
  fetchUsers: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  fetchProjects: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  logout: vi.fn()
}));

vi.mock('../utils.js', () => ({
  showNotification: vi.fn(),
  showConfirm: vi.fn(),
  getUserInitials: vi.fn().mockReturnValue('AD'),
  escapeHtml: vi.fn((str) => str),
  initCharCounter: vi.fn(() => ({ show: vi.fn(), hide: vi.fn() })),
  countCodepoints: vi.fn(s => [...s].length),
  getUnusedColor: (usedColors) => {
    const palette = [
      '#EF5350', '#EC407A', '#AB47BC', '#7E57C2', '#5C6BC0',
      '#42A5F5', '#29B6F6', '#26C6DA', '#26A69A', '#66BB6A',
      '#9CCC65', '#D4E157', '#FFEE58', '#FFCA28', '#FFA726',
      '#FF7043', '#8D6E63', '#78909C'
    ];
    const unused = palette.filter(c => !usedColors.includes(c));
    return unused.length > 0 ? unused[0] : palette[0];
  }
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

describe('system-settings.js component', () => {
  beforeEach(() => {
    // Setup DOM
    document.body.innerHTML = `
      <div id="system-settings-view">
        <div class="settings-section">
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

      <!-- Admin Confirm Modal -->
      <div id="admin-confirm-modal" class="hidden">
        <input type="password" id="admin-confirm-password">
        <div id="admin-confirm-error" class="hidden"></div>
        <button type="button" id="admin-confirm-ok-btn">Confirm</button>
        <button type="button" id="admin-confirm-cancel-btn">Cancel</button>
      </div>
    `;

    vi.clearAllMocks();
    // Default mock returns
    api.fetchUsers.mockResolvedValue([]);
    permissions.userCan.mockReturnValue(true);
    // Suppress console.error in tests
    vi.spyOn(console, 'error').mockImplementation(() => { });
  });

  describe('User Management Rendering', () => {
    beforeEach(() => {
      setupSystemSettingsView();
    });
    it('should hide user management section for non-sysadmins', async () => {
      // simulate userCan returning false for ACTION_LIST_USERS (non-sysadmin context)
      state.currentUser = { role: 'user' };
      permissions.userCan.mockImplementation((user, action) => {
        return !(action === permissions.ACTION_LIST_USERS && user.role !== 'sysadmin');
      });
      await renderSystemSettingsView();
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

      await renderSystemSettingsView();

      expect(document.getElementById('user-management-section').classList.contains('hidden')).toBe(false);
      const rows = document.querySelectorAll('.settings-entry');
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

      await renderSystemSettingsView();

      expect(utils.getUserInitials).toHaveBeenCalled();
      expect(utils.escapeHtml).toHaveBeenCalledWith('<S');

      // Reset mocks to avoid breaking subsequent tests
      utils.getUserInitials.mockReturnValue('AD');
    });

    it('should render a formatted last login for a user who has logged in', async () => {
      state.currentUser = { role: 'sysadmin' };
      const users = [
        { id: 1, email: 'seen@test.com', first_name: 'Seen', last_name: 'User', role: 'user', active: true, last_login: '2026-07-02T17:27:00Z' }
      ];
      api.fetchUsers.mockResolvedValue(users);

      await renderSystemSettingsView();

      const row = document.querySelector('.settings-entry');
      expect(row.textContent).toContain('Last login:');
      expect(row.textContent).not.toContain('Last login: Never');
    });

    it('should render "Never" as the last login for a user who has not logged in', async () => {
      state.currentUser = { role: 'sysadmin' };
      const users = [
        { id: 1, email: 'unseen@test.com', first_name: 'Unseen', last_name: 'User', role: 'user', active: true, last_login: null }
      ];
      api.fetchUsers.mockResolvedValue(users);

      await renderSystemSettingsView();

      const row = document.querySelector('.settings-entry');
      expect(row.textContent).toContain('Last login: Never');
    });

    it('should show a "User" badge for the base user role, matching admin/sysadmin badges', async () => {
      state.currentUser = { role: 'sysadmin' };
      const users = [
        { id: 1, email: 'plain@test.com', first_name: 'Plain', last_name: 'User', role: 'user', active: true }
      ];
      api.fetchUsers.mockResolvedValue(users);

      await renderSystemSettingsView();

      const row = document.querySelector('.settings-entry');
      expect(row.innerHTML).toContain('settings-entry-badge user');
      expect(row.textContent).toContain('User');
    });

    it('should render the role badge before the last-login column', async () => {
      state.currentUser = { role: 'sysadmin' };
      const users = [
        { id: 1, email: 'order@test.com', first_name: 'Order', last_name: 'Test', role: 'admin', active: true, last_login: null }
      ];
      api.fetchUsers.mockResolvedValue(users);

      await renderSystemSettingsView();

      const row = document.querySelector('.settings-entry');
      const roleIndex = row.innerHTML.indexOf('settings-entry-badge admin');
      const lastLoginIndex = row.innerHTML.indexOf('Last login:');
      expect(roleIndex).toBeGreaterThan(-1);
      expect(lastLoginIndex).toBeGreaterThan(roleIndex);
    });
  });

  describe('User Modal', () => {
    it('should open modal for new user', () => {
      setupSystemSettingsView();
      document.getElementById('add-user-btn').click();

      expect(document.getElementById('user-modal-overlay').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('user-modal-title').textContent).toBe('New User');
      expect(document.getElementById('user-password').required).toBe(true);
    });

    it('should open modal for editing user', async () => {
      state.currentUser = { role: 'admin' };
      const user = { id: 1, email: 'edit@test.com', first_name: 'E', last_name: 'D', role: 'user', active: true };
      api.fetchUsers.mockResolvedValue([user]);

      await renderSystemSettingsView();

      document.querySelector('.settings-entry').click();

      expect(document.getElementById('user-modal-overlay').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('user-modal-title').textContent).toBe('Edit User');
      expect(document.getElementById('user-email').value).toBe('edit@test.com');
      expect(document.getElementById('user-password').required).toBe(false);
    });

    it('should handle user form submission (create)', async () => {
      setupSystemSettingsView();
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
      setupSystemSettingsView();
      await renderSystemSettingsView();
      document.querySelector('.settings-entry').click();

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
      setupSystemSettingsView();
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
      setupSystemSettingsView();
      document.getElementById('add-user-btn').click();
      document.getElementById('user-email').value = 'invalid-email';

      const form = document.getElementById('user-form');
      form.dispatchEvent(new Event('submit'));

      expect(document.getElementById('user-modal-error').textContent).toBe('A valid email address is required.');
      expect(document.getElementById('user-modal-error').classList.contains('hidden')).toBe(false);
    });

    it('should show error for long names', async () => {
      setupSystemSettingsView();
      document.getElementById('add-user-btn').click();
      document.getElementById('user-email').value = 'valid@test.com';
      document.getElementById('user-first-name').value = 'a'.repeat(51); // Max 50
      document.getElementById('user-last-name').value = 'Valid';

      const form = document.getElementById('user-form');
      form.dispatchEvent(new Event('submit'));

      expect(document.getElementById('user-modal-error').textContent).toBe('First and last name must not exceed 50 characters.');
    });

    it('should NOT close on overlay click', () => {
      setupSystemSettingsView();
      document.getElementById('add-user-btn').click();
      const overlay = document.getElementById('user-modal-overlay');
      overlay.click();
      expect(overlay.classList.contains('hidden')).toBe(false);
    });
  });

  describe('Dropdowns and Support', () => {
    it('should toggle dropdown and close others', () => {
      setupSystemSettingsView();
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
      setupSystemSettingsView();
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
  describe('User Management Validation & Errors', () => {
    beforeEach(async () => {
      // Re-initialize DOM specifically for these tests to guarantee elements exist
      document.body.innerHTML = `
        <div id="system-settings-view">
          <div class="settings-section">
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

        <!-- Admin Confirm Modal -->
        <div id="admin-confirm-modal" class="hidden">
          <input type="password" id="admin-confirm-password">
          <div id="admin-confirm-error" class="hidden"></div>
          <button type="button" id="admin-confirm-ok-btn">Confirm</button>
          <button type="button" id="admin-confirm-cancel-btn">Cancel</button>
        </div>
      `;
      state.currentUser = { role: 'admin' };
      setupSystemSettingsView();
      await renderSystemSettingsView();
      document.getElementById('add-user-btn').click();
    });

    it('should handle user fetch failure', async () => {
      api.fetchUsers.mockRejectedValue(new Error('Fetch failed'));
      await renderSystemSettingsView();
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

const ADMIN_CONFIRM_MODAL = `
  <div id="admin-confirm-modal" class="hidden">
    <input type="password" id="admin-confirm-password">
    <div id="admin-confirm-error" class="hidden"></div>
    <button type="button" id="admin-confirm-ok-btn">Confirm</button>
    <button type="button" id="admin-confirm-cancel-btn">Cancel</button>
  </div>
`;

const USER_MODAL = `
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

describe('Admin Confirm Modal (promptAdminPasswordConfirmation)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="system-settings-view">
        <div id="user-management-section">
          <button id="add-user-btn"></button>
          <div id="users-list"></div>
        </div>
      </div>
      ${USER_MODAL}
      ${ADMIN_CONFIRM_MODAL}
    `;
    vi.clearAllMocks();
    api.fetchUsers.mockResolvedValue([]);
    permissions.userCan.mockReturnValue(true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    state.currentUser = { id: 99, role: 'sysadmin' };
    setupSystemSettingsView();
  });

  it('shows modal and resolves with password when OK clicked', async () => {
    const user = { id: 1, email: 'u@test.com', first_name: 'U', last_name: 'S', role: 'user', active: true };
    api.fetchUsers.mockResolvedValue([user]);
    api.updateUser.mockResolvedValue({});
    await renderSystemSettingsView();
    document.querySelector('.settings-entry').click();

    document.getElementById('user-password').value = generateRandomPassword();
    const submitPromise = new Promise(resolve => {
      const origUpdate = api.updateUser.getMockImplementation();
      api.updateUser.mockImplementation(async (...args) => {
        resolve();
        return origUpdate ? origUpdate(...args) : {};
      });
    });

    document.getElementById('user-form').dispatchEvent(new Event('submit'));
    await Promise.resolve();

    const modal = document.getElementById('admin-confirm-modal');
    expect(modal.classList.contains('hidden')).toBe(false);

    document.getElementById('admin-confirm-password').value = 'AdminPass123!';
    document.getElementById('admin-confirm-ok-btn').click();

    await submitPromise;
    expect(modal.classList.contains('hidden')).toBe(true);
    expect(api.updateUser).toHaveBeenCalledWith(1, expect.objectContaining({ admin_password: 'AdminPass123!' }));
  });

  it('shows error when OK clicked with empty password', async () => {
    const user = { id: 1, email: 'u@test.com', first_name: 'U', last_name: 'S', role: 'user', active: true };
    api.fetchUsers.mockResolvedValue([user]);
    await renderSystemSettingsView();
    document.querySelector('.settings-entry').click();

    document.getElementById('user-password').value = generateRandomPassword();
    document.getElementById('user-form').dispatchEvent(new Event('submit'));
    await Promise.resolve();

    document.getElementById('admin-confirm-password').value = '';
    document.getElementById('admin-confirm-ok-btn').click();

    const errorDiv = document.getElementById('admin-confirm-error');
    expect(errorDiv.textContent).toBe('Password is required.');
    expect(errorDiv.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('admin-confirm-modal').classList.contains('hidden')).toBe(false);
  });

  it('submits when Enter is pressed in the password input', async () => {
    const user = { id: 1, email: 'u@test.com', first_name: 'U', last_name: 'S', role: 'user', active: true };
    api.fetchUsers.mockResolvedValue([user]);
    api.updateUser.mockResolvedValue({});
    await renderSystemSettingsView();
    document.querySelector('.settings-entry').click();

    document.getElementById('user-password').value = generateRandomPassword();
    document.getElementById('user-form').dispatchEvent(new Event('submit'));
    await Promise.resolve();

    const modal = document.getElementById('admin-confirm-modal');
    expect(modal.classList.contains('hidden')).toBe(false);

    document.getElementById('admin-confirm-password').value = 'AdminPass123!';
    document.getElementById('admin-confirm-password').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(process.nextTick);

    expect(modal.classList.contains('hidden')).toBe(true);
    expect(api.updateUser).toHaveBeenCalledWith(1, expect.objectContaining({ admin_password: 'AdminPass123!' }));
  });

  it('resolves null and closes modal when Cancel clicked', async () => {
    const user = { id: 1, email: 'u@test.com', first_name: 'U', last_name: 'S', role: 'user', active: true };
    api.fetchUsers.mockResolvedValue([user]);
    await renderSystemSettingsView();
    document.querySelector('.settings-entry').click();

    document.getElementById('user-password').value = generateRandomPassword();
    document.getElementById('user-form').dispatchEvent(new Event('submit'));
    await Promise.resolve();

    expect(document.getElementById('admin-confirm-modal').classList.contains('hidden')).toBe(false);

    document.getElementById('admin-confirm-cancel-btn').click();
    await Promise.resolve();

    expect(document.getElementById('admin-confirm-modal').classList.contains('hidden')).toBe(true);
    expect(api.updateUser).not.toHaveBeenCalled();
  });

  it('requires confirmation for role promotion', async () => {
    const user = { id: 1, email: 'u@test.com', first_name: 'U', last_name: 'S', role: 'user', active: true };
    api.fetchUsers.mockResolvedValue([user]);
    await renderSystemSettingsView();
    document.querySelector('.settings-entry').click();

    // Promote user → admin (no password change)
    document.getElementById('user-role').value = 'admin';
    document.getElementById('user-form').dispatchEvent(new Event('submit'));
    await Promise.resolve();

    expect(document.getElementById('admin-confirm-modal').classList.contains('hidden')).toBe(false);
    document.getElementById('admin-confirm-cancel-btn').click();
    expect(api.updateUser).not.toHaveBeenCalled();
  });

  it('does not require confirmation for role demotion', async () => {
    const user = { id: 1, email: 'u@test.com', first_name: 'U', last_name: 'S', role: 'admin', active: true };
    api.fetchUsers.mockResolvedValue([user]);
    api.updateUser.mockResolvedValue({});
    await renderSystemSettingsView();
    document.querySelector('.settings-entry').click();

    // Demote admin → user (no password change)
    document.getElementById('user-role').value = 'user';
    document.getElementById('user-form').dispatchEvent(new Event('submit'));
    await new Promise(process.nextTick);

    expect(document.getElementById('admin-confirm-modal').classList.contains('hidden')).toBe(true);
    expect(api.updateUser).toHaveBeenCalled();
  });

  it('requires confirmation for deactivating a user', async () => {
    const user = { id: 1, email: 'u@test.com', first_name: 'U', last_name: 'S', role: 'user', active: true };
    api.fetchUsers.mockResolvedValue([user]);
    api.updateUser.mockResolvedValue({});
    await renderSystemSettingsView();
    document.querySelector('.settings-entry').click();

    // Deactivate (no password/role change)
    document.getElementById('user-active').checked = false;
    document.getElementById('user-form').dispatchEvent(new Event('submit'));
    await Promise.resolve();

    expect(document.getElementById('admin-confirm-modal').classList.contains('hidden')).toBe(false);
    expect(api.updateUser).not.toHaveBeenCalled();

    document.getElementById('admin-confirm-password').value = 'AdminPass123!';
    document.getElementById('admin-confirm-ok-btn').click();
    await new Promise(process.nextTick);

    expect(api.updateUser).toHaveBeenCalledWith(1, expect.objectContaining({ active: false, admin_password: 'AdminPass123!' }));
  });

  it('requires confirmation for reactivating a user', async () => {
    const user = { id: 1, email: 'u@test.com', first_name: 'U', last_name: 'S', role: 'user', active: false };
    api.fetchUsers.mockResolvedValue([user]);
    api.updateUser.mockResolvedValue({});
    await renderSystemSettingsView();
    document.querySelector('.settings-entry').click();

    // Reactivate (no password/role change)
    document.getElementById('user-active').checked = true;
    document.getElementById('user-form').dispatchEvent(new Event('submit'));
    await Promise.resolve();

    expect(document.getElementById('admin-confirm-modal').classList.contains('hidden')).toBe(false);
    expect(api.updateUser).not.toHaveBeenCalled();

    document.getElementById('admin-confirm-password').value = 'AdminPass123!';
    document.getElementById('admin-confirm-ok-btn').click();
    await new Promise(process.nextTick);

    expect(api.updateUser).toHaveBeenCalledWith(1, expect.objectContaining({ active: true, admin_password: 'AdminPass123!' }));
  });

  it('does not require confirmation when active status is unchanged', async () => {
    const user = { id: 1, email: 'u@test.com', first_name: 'U', last_name: 'S', role: 'user', active: true };
    api.fetchUsers.mockResolvedValue([user]);
    api.updateUser.mockResolvedValue({});
    await renderSystemSettingsView();
    document.querySelector('.settings-entry').click();

    // No changes at all besides re-submitting the form
    document.getElementById('user-form').dispatchEvent(new Event('submit'));
    await new Promise(process.nextTick);

    expect(document.getElementById('admin-confirm-modal').classList.contains('hidden')).toBe(true);
    expect(api.updateUser).toHaveBeenCalled();
  });

  it('logs out when sysadmin changes their own password', async () => {
    const { logout } = await import('../api.js');
    const self = { id: 99, email: 'self@test.com', first_name: 'S', last_name: 'A', role: 'sysadmin', active: true };
    api.fetchUsers.mockResolvedValue([self]);
    api.updateUser.mockResolvedValue({});
    await renderSystemSettingsView();
    document.querySelector('.settings-entry').click();

    document.getElementById('user-password').value = generateRandomPassword();
    document.getElementById('user-form').dispatchEvent(new Event('submit'));
    await Promise.resolve();

    document.getElementById('admin-confirm-password').value = 'AdminPass123!';
    document.getElementById('admin-confirm-ok-btn').click();
    await new Promise(process.nextTick);

    expect(logout).toHaveBeenCalled();
  });
});

const PROJECT_DOM = `
  <div id="system-settings-view">
    <div class="settings-section">
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

  <!-- Admin Confirm Modal (required by promptAdminPasswordConfirmation) -->
  <div id="admin-confirm-modal" class="hidden">
    <input type="password" id="admin-confirm-password">
    <div id="admin-confirm-error" class="hidden"></div>
    <button type="button" id="admin-confirm-ok-btn">Confirm</button>
    <button type="button" id="admin-confirm-cancel-btn">Cancel</button>
  </div>
`;

describe('Project Management', () => {
  beforeEach(() => {
    document.body.innerHTML = PROJECT_DOM;
    state.currentUser = { role: 'admin' };
    vi.clearAllMocks();
    api.fetchUsers.mockResolvedValue([]);
    api.fetchProjects.mockResolvedValue([]);
    permissions.userCan.mockReturnValue(true);
    vi.spyOn(console, 'error').mockImplementation(() => { });

    setupSystemSettingsView();
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
      await renderSystemSettingsView();

      document.querySelector('.settings-entry').click();

      expect(document.getElementById('project-modal-overlay').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('project-modal-title').textContent).toBe('Edit Project');
      expect(document.getElementById('project-name').value).toBe('My Project');
      expect(document.getElementById('project-description').value).toBe('desc');
    });

    it('should hide delete button for the default project (id 1)', async () => {
      const project = { id: 1, name: 'default', description: '' };
      api.fetchProjects.mockResolvedValue([project]);
      await renderSystemSettingsView();

      document.querySelector('.settings-entry').click();

      expect(document.getElementById('project-modal-delete').classList.contains('hidden')).toBe(true);
    });

    it('should show delete button for non-default project with permission', async () => {
      const project = { id: 2, name: 'Other', description: '' };
      api.fetchProjects.mockResolvedValue([project]);
      await renderSystemSettingsView();

      document.querySelector('.settings-entry').click();

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
      await renderSystemSettingsView();

      document.querySelector('.settings-entry').click();
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
    it('should show confirm modal, then admin password prompt, and delete project on confirm', async () => {
      const project = { id: 2, name: 'To Delete', description: '' };
      api.fetchProjects.mockResolvedValue([project]);
      api.deleteProject.mockResolvedValue({});
      await renderSystemSettingsView();

      document.querySelector('.settings-entry').click();

      document.getElementById('project-modal-delete').click();

      expect(document.getElementById('confirm-modal').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('confirm-title').textContent).toBe('Delete Project');

      document.getElementById('confirm-ok-btn').click();
      await Promise.resolve();

      expect(document.getElementById('confirm-modal').classList.contains('hidden')).toBe(true);
      expect(document.getElementById('admin-confirm-modal').classList.contains('hidden')).toBe(false);
      expect(api.deleteProject).not.toHaveBeenCalled();

      document.getElementById('admin-confirm-password').value = 'AdminPass123!';
      document.getElementById('admin-confirm-ok-btn').click();
      await new Promise(process.nextTick);

      expect(api.deleteProject).toHaveBeenCalledWith(2, 'AdminPass123!');
      expect(utils.showNotification).toHaveBeenCalledWith('Project deleted', 'success');
      expect(document.getElementById('project-modal-overlay').classList.contains('hidden')).toBe(true);
      expect(document.getElementById('admin-confirm-modal').classList.contains('hidden')).toBe(true);
    });

    it('should hide confirm modal on cancel without deleting', async () => {
      const project = { id: 3, name: 'Keep Me', description: '' };
      api.fetchProjects.mockResolvedValue([project]);
      await renderSystemSettingsView();

      document.querySelector('.settings-entry').click();
      document.getElementById('project-modal-delete').click();

      document.getElementById('confirm-cancel-btn').click();

      expect(api.deleteProject).not.toHaveBeenCalled();
      expect(document.getElementById('confirm-modal').classList.contains('hidden')).toBe(true);
    });

    it('should not delete when admin password prompt is cancelled', async () => {
      const project = { id: 5, name: 'Keep Me Too', description: '' };
      api.fetchProjects.mockResolvedValue([project]);
      await renderSystemSettingsView();

      document.querySelector('.settings-entry').click();
      document.getElementById('project-modal-delete').click();
      document.getElementById('confirm-ok-btn').click();
      await Promise.resolve();

      expect(document.getElementById('admin-confirm-modal').classList.contains('hidden')).toBe(false);

      document.getElementById('admin-confirm-cancel-btn').click();
      await new Promise(process.nextTick);

      expect(api.deleteProject).not.toHaveBeenCalled();
      expect(document.getElementById('admin-confirm-modal').classList.contains('hidden')).toBe(true);
    });

    it('should show error in project modal when delete API fails', async () => {
      const project = { id: 4, name: 'Fail Delete', description: '' };
      api.fetchProjects.mockResolvedValue([project]);
      api.deleteProject.mockRejectedValue(new Error('Delete failed'));
      await renderSystemSettingsView();

      document.querySelector('.settings-entry').click();
      document.getElementById('project-modal-delete').click();
      document.getElementById('confirm-ok-btn').click();
      await Promise.resolve();

      document.getElementById('admin-confirm-password').value = 'AdminPass123!';
      document.getElementById('admin-confirm-ok-btn').click();
      await new Promise(process.nextTick);

      expect(document.getElementById('project-modal-error').textContent).toBe('Delete failed');
    });
  });

  describe('renderProjectList', () => {
    it('should hide project section when user lacks LIST_PROJECTS permission', async () => {
      permissions.userCan.mockImplementation((user, action) => {
        return action !== permissions.ACTION_LIST_PROJECTS;
      });
      await renderSystemSettingsView();

      expect(document.getElementById('project-management-section').style.display).toBe('none');
    });

    it('should render project rows', async () => {
      const projects = [
        { id: 1, name: 'default', description: '' },
        { id: 2, name: 'Alpha', description: 'Alpha project' }
      ];
      api.fetchProjects.mockResolvedValue(projects);
      await renderSystemSettingsView();

      const rows = document.querySelectorAll('#projects-list .settings-entry');
      expect(rows.length).toBe(2);
      expect(rows[0].textContent).toContain('default');
      expect(rows[1].textContent).toContain('Alpha');
    });

    it('should show "default" badge for project with id 1', async () => {
      api.fetchProjects.mockResolvedValue([{ id: 1, name: 'default', description: '' }]);
      await renderSystemSettingsView();

      const row = document.querySelector('#projects-list .settings-entry');
      expect(row.textContent).toContain('default');
      expect(row.innerHTML).toContain('admin');
    });

    it('should render the default badge as the last column, after name and description', async () => {
      api.fetchProjects.mockResolvedValue([{ id: 1, name: 'default', description: 'The default project' }]);
      await renderSystemSettingsView();

      const row = document.querySelector('#projects-list .settings-entry');
      const nameIndex = row.innerHTML.indexOf('settings-entry-col-name');
      const descIndex = row.innerHTML.indexOf('settings-entry-col-description');
      const badgeIndex = row.innerHTML.indexOf('settings-entry-badge admin');
      expect(nameIndex).toBeGreaterThan(-1);
      expect(descIndex).toBeGreaterThan(nameIndex);
      expect(badgeIndex).toBeGreaterThan(descIndex);
    });

    it('should show error message when fetchProjects fails', async () => {
      api.fetchProjects.mockRejectedValue(new Error('Fetch failed'));
      await renderSystemSettingsView();

      expect(document.getElementById('projects-list').innerHTML).toContain('Failed to load projects');
    });

    it('should hide add-project-btn when user lacks CREATE_PROJECT permission', async () => {
      permissions.userCan.mockImplementation((user, action) => {
        return action !== permissions.ACTION_CREATE_PROJECT;
      });
      api.fetchProjects.mockResolvedValue([]);
      await renderSystemSettingsView();

      expect(document.getElementById('add-project-btn').style.display).toBe('none');
    });
  });
});
