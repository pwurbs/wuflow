import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupSetupView, renderSetupView, validatePasswordPolicy, isBlacklistedPassword, isLight } from '../components/setup.js';
import * as api from '../api.js';
import * as utils from '../utils.js';
import { state } from '../state.js';

// Mock dependencies
vi.mock('../api.js', () => ({
  fetchLabels: vi.fn(),
  createLabel: vi.fn(),
  deleteLabel: vi.fn(),
  fetchUsers: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn()
}));

vi.mock('../utils.js', () => ({
  showModalNotification: vi.fn(),
  showConfirm: vi.fn(),
  getUserInitials: vi.fn().mockReturnValue('AD')
}));

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
      expect(utils.showModalNotification).toHaveBeenCalledWith('Label created', 'success');
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
      expect(utils.showModalNotification).toHaveBeenCalledWith('Label deleted', 'success');
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

      expect(utils.showModalNotification).toHaveBeenCalledWith('Failed to create label', 'error');
    });
  });

  describe('User Management Rendering', () => {
    it('should hide user management section for non-admins', async () => {
      state.currentUser = { role: 'user' };
      await renderSetupView();
      expect(document.getElementById('user-management-section').classList.contains('hidden')).toBe(true);
    });

    it('should show and render user list for admins', async () => {
      state.currentUser = { role: 'admin' };
      const users = [
        { id: 1, email: 'admin@test.com', first_name: 'Ad', last_name: 'Min', role: 'admin', active: true },
        { id: 2, email: 'user@test.com', first_name: 'Us', last_name: 'Er', role: 'user', active: true }
      ];
      api.fetchUsers.mockResolvedValue(users);

      await renderSetupView();

      expect(document.getElementById('user-management-section').classList.contains('hidden')).toBe(false);
      const rows = document.querySelectorAll('.user-row');
      expect(rows.length).toBe(2);
      expect(rows[0].textContent).toContain('admin@test.com');
      expect(rows[0].textContent).toContain('Admin');
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
      const password = `Pass${Math.random().toString(36).slice(2)}LongEnough`;
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
      document.getElementById('user-password').value = '';

      const form = document.getElementById('user-form');
      form.dispatchEvent(new Event('submit'));

      expect(document.getElementById('user-modal-error').textContent).toBe('Password is required for new users');
      expect(document.getElementById('user-modal-error').classList.contains('hidden')).toBe(false);
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
      trigger.click();

      expect(options.classList.contains('hidden')).toBe(false);
      expect(otherOptions.classList.contains('hidden')).toBe(true);

      trigger.click();
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
});
