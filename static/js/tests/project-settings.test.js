import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupProjectSettingsView, renderProjectSettingsView } from '../components/project-settings.js';
import * as api from '../api.js';
import * as utils from '../utils.js';
import * as permissions from '../permissions.js';

vi.mock('../api.js', () => ({
  fetchLabelsByProject: vi.fn(),
  createLabel: vi.fn(),
  deleteLabel: vi.fn(),
}));

vi.mock('../utils.js', () => ({
  showNotification: vi.fn(),
  showConfirm: vi.fn(),
  escapeHtml: vi.fn((str) => str),
  initCharCounter: vi.fn(() => ({ show: vi.fn(), hide: vi.fn() })),
  countCodepoints: vi.fn(s => [...s].length),
  getUnusedColor: vi.fn(() => '#EF5350'),
}));

vi.mock('../permissions.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, userCan: vi.fn() };
});

vi.mock('../state.js', () => ({
  state: { currentUser: { role: 'admin' }, selectedProjectId: 1 },
}));

const DOM = `
  <div id="project-settings-view">
    <div class="settings-section">
      <div id="ps-labels-list"></div>
      <div class="label-input-group">
        <input type="text" id="ps-new-label-input">
        <button id="ps-add-label-btn"></button>
      </div>
    </div>
  </div>
`;

describe('project-settings.js component', () => {
  beforeEach(() => {
    document.body.innerHTML = DOM;
    vi.clearAllMocks();
    utils.countCodepoints.mockImplementation(s => [...s].length);
    permissions.userCan.mockReturnValue(true);
    api.fetchLabelsByProject.mockResolvedValue([]);
  });

  // ── setupProjectSettingsView ──────────────────────────────────────────────

  describe('setupProjectSettingsView()', () => {
    it('initializes char counter when user can create labels', () => {
      setupProjectSettingsView();
      expect(utils.initCharCounter).toHaveBeenCalledWith(
        document.getElementById('ps-new-label-input'), 15
      );
    });

    it('hides input group when user cannot create labels', () => {
      permissions.userCan.mockReturnValue(false);
      setupProjectSettingsView();
      expect(document.querySelector('.label-input-group').style.display).toBe('none');
    });

    it('creates a label on button click', async () => {
      api.createLabel.mockResolvedValue({ id: 1, name: 'Bug', color: '#EF5350' });
      setupProjectSettingsView();

      document.getElementById('ps-new-label-input').value = 'Bug';
      document.getElementById('ps-add-label-btn').click();
      await new Promise(process.nextTick);

      expect(api.createLabel).toHaveBeenCalledWith(1, expect.objectContaining({ name: 'Bug' }));
    });

    it('does nothing when label name is empty on button click', async () => {
      setupProjectSettingsView();

      document.getElementById('ps-new-label-input').value = '';
      document.getElementById('ps-add-label-btn').click();
      await new Promise(process.nextTick);

      expect(api.createLabel).not.toHaveBeenCalled();
    });

    it('shows error when label name exceeds 15 characters', async () => {
      utils.countCodepoints.mockReturnValue(16);
      setupProjectSettingsView();

      document.getElementById('ps-new-label-input').value = 'TooLongLabelName';
      document.getElementById('ps-add-label-btn').click();
      await new Promise(process.nextTick);

      expect(utils.showNotification).toHaveBeenCalledWith(
        'Label name must not exceed 15 characters.', 'error'
      );
    });

    it('shows error notification when createLabel fails', async () => {
      api.createLabel.mockRejectedValue(new Error('Network error'));
      setupProjectSettingsView();

      document.getElementById('ps-new-label-input').value = 'Bug';
      document.getElementById('ps-add-label-btn').click();
      await new Promise(process.nextTick);

      expect(utils.showNotification).toHaveBeenCalledWith('Failed to create label', 'error');
    });

    it('creates a label on Enter keypress', async () => {
      api.createLabel.mockResolvedValue({ id: 1, name: 'Bug', color: '#EF5350' });
      setupProjectSettingsView();

      const input = document.getElementById('ps-new-label-input');
      input.value = 'Bug';
      input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));
      await new Promise(process.nextTick);

      expect(api.createLabel).toHaveBeenCalledWith(1, expect.objectContaining({ name: 'Bug' }));
    });

    it('does not create label on non-Enter keypress', async () => {
      setupProjectSettingsView();
      const input = document.getElementById('ps-new-label-input');
      input.value = 'Bug';
      input.dispatchEvent(new KeyboardEvent('keypress', { key: 'a', bubbles: true }));
      await new Promise(process.nextTick);
      expect(api.createLabel).not.toHaveBeenCalled();
    });
  });

  // ── renderProjectSettingsView ─────────────────────────────────────────────

  describe('renderProjectSettingsView()', () => {
    beforeEach(() => {
      setupProjectSettingsView();
    });

    it('renders labels returned from the API', async () => {
      api.fetchLabelsByProject.mockResolvedValue([{ id: 1, name: 'Bug', color: '#EF5350' }]);
      await renderProjectSettingsView();
      expect(document.querySelector('.label-name').textContent).toBe('Bug');
    });

    it('renders delete button when user has DELETE permission', async () => {
      api.fetchLabelsByProject.mockResolvedValue([{ id: 1, name: 'Bug', color: '#EF5350' }]);
      await renderProjectSettingsView();
      expect(document.querySelector('.delete-label-btn')).not.toBeNull();
    });

    it('omits delete button when user cannot delete labels', async () => {
      permissions.userCan.mockImplementation((user, action) => action !== permissions.ACTION_DELETE_LABEL);
      api.fetchLabelsByProject.mockResolvedValue([{ id: 1, name: 'Bug', color: '#EF5350' }]);
      await renderProjectSettingsView();
      expect(document.querySelector('.delete-label-btn')).toBeNull();
    });

    it('hides labels section when user cannot list labels', async () => {
      permissions.userCan.mockReturnValue(false);
      await renderProjectSettingsView();
      const section = document.getElementById('ps-labels-list').closest('.settings-section');
      expect(section.style.display).toBe('none');
    });

    it('shows error message when fetchLabelsByProject fails', async () => {
      api.fetchLabelsByProject.mockRejectedValue(new Error('Network error'));
      await renderProjectSettingsView();
      expect(document.getElementById('ps-labels-list').innerHTML).toContain('Failed to load labels');
    });

    it('sanitizes invalid label color', async () => {
      api.fetchLabelsByProject.mockResolvedValue([{ id: 1, name: 'Bug', color: 'notacolor' }]);
      await renderProjectSettingsView();
      const labelEl = document.querySelector('.label-item');
      expect(labelEl.style.color).toBe('rgb(128, 128, 128)');
    });

    it('deletes a label after confirmation', async () => {
      utils.showConfirm.mockResolvedValue(true);
      api.fetchLabelsByProject.mockResolvedValue([{ id: 1, name: 'Bug', color: '#EF5350' }]);
      api.deleteLabel.mockResolvedValue({});

      await renderProjectSettingsView();
      document.querySelector('.delete-label-btn').click();
      await new Promise(process.nextTick);

      expect(api.deleteLabel).toHaveBeenCalledWith(1, 1);
    });

    it('does not delete when confirmation is cancelled', async () => {
      utils.showConfirm.mockResolvedValue(false);
      api.fetchLabelsByProject.mockResolvedValue([{ id: 1, name: 'Bug', color: '#EF5350' }]);

      await renderProjectSettingsView();
      document.querySelector('.delete-label-btn').click();
      await new Promise(process.nextTick);

      expect(api.deleteLabel).not.toHaveBeenCalled();
    });

    it('shows error notification when deleteLabel fails', async () => {
      utils.showConfirm.mockResolvedValue(true);
      api.fetchLabelsByProject.mockResolvedValue([{ id: 1, name: 'Bug', color: '#EF5350' }]);
      api.deleteLabel.mockRejectedValue(new Error('Network error'));

      await renderProjectSettingsView();
      document.querySelector('.delete-label-btn').click();
      await new Promise(process.nextTick);

      expect(utils.showNotification).toHaveBeenCalledWith('Failed to delete label', 'error');
    });

    it('does not delete when user lost DELETE permission at click time', async () => {
      api.fetchLabelsByProject.mockResolvedValue([{ id: 1, name: 'Bug', color: '#EF5350' }]);
      await renderProjectSettingsView();

      permissions.userCan.mockReturnValue(false);
      document.querySelector('.delete-label-btn').click();
      await new Promise(process.nextTick);

      expect(utils.showConfirm).not.toHaveBeenCalled();
      expect(api.deleteLabel).not.toHaveBeenCalled();
    });

    it('returns early without error when container is not set up', async () => {
      document.body.innerHTML = '';
      await renderProjectSettingsView();
      expect(document.querySelector('.delete-label-btn')).toBeNull();
    });
  });
});
