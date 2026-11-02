import { describe, it, expect, vi, beforeEach, assert } from 'vitest';
import { setupProjectSettingsView, renderProjectSettingsView } from '../components/project-settings.ts';
import * as api from '../api.ts';
import { byId, bySelector } from '../utils.ts';
import * as utils from '../utils.ts';
import * as permissions from '../permissions.ts';
import * as stateModule from '../state.ts';
import { makeIssue, makeLabel, makeStatusConfig } from './fixtures.ts';
import type { Label } from '../models.ts';

vi.mock('../api.ts', () => ({
  fetchLabelsByProject: vi.fn(),
  createLabel: vi.fn(),
  deleteLabel: vi.fn(),
  fetchStatusConfig: vi.fn(),
  updateStatusConfig: vi.fn(),
}));

vi.mock('../components/toolbar.ts', () => ({
  updateLabelFilterOptions: vi.fn(),
}));

vi.mock('../utils.ts', async (importOriginal) => ({
  byId: (await importOriginal<typeof import('../utils.ts')>()).byId,
  bySelector: (await importOriginal<typeof import('../utils.ts')>()).bySelector,
  guardSubmit: (await importOriginal<typeof import('../utils.ts')>()).guardSubmit,
  errorMessage: (await importOriginal<typeof import('../utils.ts')>()).errorMessage,
  showNotification: vi.fn(),
  showConfirm: vi.fn(),
  escapeHtml: vi.fn((str) => str),
  initCharCounter: vi.fn(() => ({ show: vi.fn(), hide: vi.fn() })),
  countCodepoints: vi.fn(s => [...s].length),
  getUnusedColor: vi.fn(() => '#EF5350'),
  promptAdminPasswordConfirmation: vi.fn(async (title, message, onConfirm) => {
    await onConfirm('AdminPass123!');
    return true;
  }),
}));

vi.mock('../permissions.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../permissions.ts')>();
  return { ...actual, userCan: vi.fn() };
});

vi.mock('../state.ts', () => ({
  state: { currentUser: { role: 'admin' }, selectedProjectId: 1, issues: [], filter: { labelId: null } },
  setStatusConfig: vi.fn(),
  setLabels: vi.fn(),
}));

const DEFAULT_CFG = makeStatusConfig({
  stage1_name: 'Pending',
  stage2_name: 'Working',
  stage3_name: '',
  stage4_name: '',
});

const DOM = `
  <div id="project-settings-view">
    <div class="settings-section">
      <div id="ps-status-config-content"></div>
    </div>
    <div class="settings-section">
      <div id="ps-labels-list"></div>
      <div class="label-input-group">
        <input type="text" id="ps-new-label-input">
        <button id="ps-add-label-btn"></button>
      </div>
    </div>
  </div>
`;

describe('project-settings.ts component', () => {
  beforeEach(() => {
    document.body.innerHTML = DOM;
    vi.clearAllMocks();
    vi.mocked(utils.countCodepoints).mockImplementation(s => [...s].length);
    vi.mocked(permissions.userCan).mockReturnValue(true);
    vi.mocked(api.fetchLabelsByProject).mockResolvedValue([]);
    vi.mocked(api.fetchStatusConfig).mockResolvedValue(DEFAULT_CFG);
    stateModule.state.issues = [];
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
      vi.mocked(permissions.userCan).mockReturnValue(false);
      setupProjectSettingsView();
      expect(bySelector(document, '.label-input-group').style.display).toBe('none');
    });

    it('creates a label on Enter keypress', async () => {
      vi.mocked(api.createLabel).mockResolvedValue(makeLabel({ id: 1, name: 'Bug', color: '#EF5350' }));
      setupProjectSettingsView();

      const input = byId('ps-new-label-input', HTMLInputElement);
      input.value = 'Bug';
      input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));
      await new Promise(process.nextTick);

      expect(api.createLabel).toHaveBeenCalledWith(1, expect.objectContaining({ name: 'Bug' }));
    });

    it('creates a label only once when Enter is pressed again while the first add is in flight', async () => {
      const { promise: pendingCreate, resolve: resolveCreate } = Promise.withResolvers<Label>();
      vi.mocked(api.createLabel).mockReturnValue(pendingCreate);
      setupProjectSettingsView();

      const input = byId('ps-new-label-input', HTMLInputElement);
      input.value = 'Bug';
      const group = input.closest('.label-input-group');
      assert(group);
      input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));
      await new Promise(process.nextTick);
      expect(group.getAttribute('aria-busy')).toBe('true');
      input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));
      await new Promise(process.nextTick);

      resolveCreate(makeLabel({ id: 1, name: 'Bug', color: '#EF5350' }));
      await new Promise(process.nextTick);

      expect(api.createLabel).toHaveBeenCalledTimes(1);
      expect(group.hasAttribute('aria-busy')).toBe(false);
    });

    it('does nothing when label name is empty on Enter keypress', async () => {
      setupProjectSettingsView();

      const input = byId('ps-new-label-input', HTMLInputElement);
      input.value = '';
      input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));
      await new Promise(process.nextTick);

      expect(api.createLabel).not.toHaveBeenCalled();
    });

    it('shows error when label name exceeds 15 characters', async () => {
      vi.mocked(utils.countCodepoints).mockReturnValue(16);
      setupProjectSettingsView();

      const input = byId('ps-new-label-input', HTMLInputElement);
      input.value = 'TooLongLabelName';
      input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));
      await new Promise(process.nextTick);

      expect(utils.showNotification).toHaveBeenCalledWith(
        'Label name must not exceed 15 characters.', 'error'
      );
    });

    it('shows error notification when createLabel fails', async () => {
      vi.mocked(api.createLabel).mockRejectedValue(new Error('Network error'));
      setupProjectSettingsView();

      const input = byId('ps-new-label-input', HTMLInputElement);
      input.value = 'Bug';
      input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));
      await new Promise(process.nextTick);

      expect(utils.showNotification).toHaveBeenCalledWith('Failed to create label', 'error');
    });

    it('does not create label on non-Enter keypress', async () => {
      setupProjectSettingsView();
      const input = byId('ps-new-label-input', HTMLInputElement);
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
      vi.mocked(api.fetchLabelsByProject).mockResolvedValue([makeLabel({ id: 1, name: 'Bug', color: '#EF5350' })]);
      await renderProjectSettingsView();
      expect(bySelector(document, '.label-name').textContent).toBe('Bug');
    });

    it('renders delete button when user has DELETE permission', async () => {
      vi.mocked(api.fetchLabelsByProject).mockResolvedValue([makeLabel({ id: 1, name: 'Bug', color: '#EF5350' })]);
      await renderProjectSettingsView();
      expect(document.querySelector('.delete-label-btn')).not.toBeNull();
    });

    it('omits delete button when user cannot delete labels', async () => {
      vi.mocked(permissions.userCan).mockImplementation((user, action) => action !== permissions.ACTION_DELETE_LABEL);
      vi.mocked(api.fetchLabelsByProject).mockResolvedValue([makeLabel({ id: 1, name: 'Bug', color: '#EF5350' })]);
      await renderProjectSettingsView();
      expect(document.querySelector('.delete-label-btn')).toBeNull();
    });

    it('hides labels section when user cannot list labels', async () => {
      vi.mocked(permissions.userCan).mockReturnValue(false);
      await renderProjectSettingsView();
      const section = byId('ps-labels-list').closest<HTMLElement>('.settings-section');
      expect(section?.style.display).toBe('none');
    });

    it('shows error message when fetchLabelsByProject fails', async () => {
      vi.mocked(api.fetchLabelsByProject).mockRejectedValue(new Error('Network error'));
      await renderProjectSettingsView();
      expect(byId('ps-labels-list').innerHTML).toContain('Failed to load labels');
    });

    it('sanitizes invalid label color', async () => {
      vi.mocked(api.fetchLabelsByProject).mockResolvedValue([makeLabel({ id: 1, name: 'Bug', color: 'notacolor' })]);
      await renderProjectSettingsView();
      const labelEl = bySelector(document, '.label-item');
      expect(labelEl.style.color).toBe('rgb(128, 128, 128)');
    });

    it('deletes a label after confirmation', async () => {
      vi.mocked(api.fetchLabelsByProject).mockResolvedValue([makeLabel({ id: 1, name: 'Bug', color: '#EF5350' })]);
      vi.mocked(api.deleteLabel).mockResolvedValue(undefined);

      await renderProjectSettingsView();
      bySelector(document, '.delete-label-btn').click();
      await new Promise(process.nextTick);

      expect(api.deleteLabel).toHaveBeenCalledWith(1, 1, 'AdminPass123!');
    });

    it('does not delete when confirmation is cancelled', async () => {
      vi.mocked(utils.promptAdminPasswordConfirmation).mockResolvedValue(false);
      vi.mocked(api.fetchLabelsByProject).mockResolvedValue([makeLabel({ id: 1, name: 'Bug', color: '#EF5350' })]);

      await renderProjectSettingsView();
      bySelector(document, '.delete-label-btn').click();
      await new Promise(process.nextTick);

      expect(api.deleteLabel).not.toHaveBeenCalled();
    });

    it('does not delete when user lost DELETE permission at click time', async () => {
      vi.mocked(api.fetchLabelsByProject).mockResolvedValue([makeLabel({ id: 1, name: 'Bug', color: '#EF5350' })]);
      await renderProjectSettingsView();

      vi.mocked(permissions.userCan).mockReturnValue(false);
      bySelector(document, '.delete-label-btn').click();
      await new Promise(process.nextTick);

      expect(utils.promptAdminPasswordConfirmation).not.toHaveBeenCalled();
      expect(api.deleteLabel).not.toHaveBeenCalled();
    });

    it('returns early without error when container is not set up', async () => {
      document.body.innerHTML = '';
      await renderProjectSettingsView();
      expect(document.querySelector('.delete-label-btn')).toBeNull();
    });
  });

  // ── renderStatusConfigSection ─────────────────────────────────────────────

  describe('renderStatusConfigSection()', () => {
    beforeEach(() => {
      setupProjectSettingsView();
    });

    it('renders 6 boxes (Todo, Stage1–4, Done)', async () => {
      await renderProjectSettingsView();
      expect(document.querySelectorAll('.sc-box')).toHaveLength(6);
    });

    it('marks Stage1 and Stage2 as active when they have names', async () => {
      await renderProjectSettingsView();
      expect(document.querySelectorAll('.sc-box--active')).toHaveLength(2);
    });

    it('marks Stage3 and Stage4 as inactive when names are empty', async () => {
      await renderProjectSettingsView();
      expect(document.querySelectorAll('.sc-box--inactive')).toHaveLength(2);
    });

    it('populates inputs with stage names from config', async () => {
      await renderProjectSettingsView();
      expect(bySelector(document, '.sc-name-input[data-field="stage1_name"]', HTMLInputElement).value).toBe('Pending');
      expect(bySelector(document, '.sc-name-input[data-field="stage2_name"]', HTMLInputElement).value).toBe('Working');
      expect(bySelector(document, '.sc-name-input[data-field="stage3_name"]', HTMLInputElement).value).toBe('');
    });

    it('shows save button when user has UPDATE_STATUS_CONFIG permission', async () => {
      await renderProjectSettingsView();
      expect(document.getElementById('ps-save-status-config-btn')).not.toBeNull();
    });

    it('hides save button when user lacks UPDATE_STATUS_CONFIG permission', async () => {
      vi.mocked(permissions.userCan).mockImplementation(
        (_user, action) => action !== permissions.ACTION_UPDATE_STATUS_CONFIG
      );
      await renderProjectSettingsView();
      expect(document.getElementById('ps-save-status-config-btn')).toBeNull();
    });

    it('disables inputs when user lacks UPDATE_STATUS_CONFIG permission', async () => {
      vi.mocked(permissions.userCan).mockImplementation(
        (_user, action) => action !== permissions.ACTION_UPDATE_STATUS_CONFIG
      );
      await renderProjectSettingsView();
      document.querySelectorAll<HTMLInputElement>('.sc-name-input').forEach(input => {
        expect(input.disabled).toBe(true);
      });
    });

    it('shows orphan badge on inactive stage that has hidden issues', async () => {
      stateModule.state.issues = [makeIssue({ id: 1, status: 'Stage3' }), makeIssue({ id: 2, status: 'Stage3' })];
      await renderProjectSettingsView();

      const stage3Box = bySelector(document, '.sc-name-input[data-field="stage3_name"]').closest('.sc-box');
      assert(stage3Box);
      const badge = bySelector(stage3Box, '.sc-orphan-badge');
      expect(badge).not.toBeNull();
      expect(badge.textContent).toBe('2');
    });

    it('does not show orphan badge on active stage', async () => {
      stateModule.state.issues = [makeIssue({ id: 1, status: 'Stage1' })];
      await renderProjectSettingsView();

      const stage1Box = bySelector(document, '.sc-name-input[data-field="stage1_name"]').closest('.sc-box');
      assert(stage1Box);
      expect(stage1Box.querySelector('.sc-orphan-badge')).toBeNull();
    });

    it('input event activates box when a name is typed', async () => {
      await renderProjectSettingsView();

      const input = bySelector(document, '.sc-name-input[data-field="stage3_name"]', HTMLInputElement);
      const box = input.closest('.sc-box');
      assert(box);
      expect(box.classList.contains('sc-box--inactive')).toBe(true);

      input.value = 'QA';
      input.dispatchEvent(new Event('input'));

      expect(box.classList.contains('sc-box--active')).toBe(true);
      expect(box.classList.contains('sc-box--inactive')).toBe(false);
    });

    it('input event deactivates box when name is cleared', async () => {
      await renderProjectSettingsView();

      const input = bySelector(document, '.sc-name-input[data-field="stage1_name"]', HTMLInputElement);
      const box = input.closest('.sc-box');
      assert(box);
      expect(box.classList.contains('sc-box--active')).toBe(true);

      input.value = '';
      input.dispatchEvent(new Event('input'));

      expect(box.classList.contains('sc-box--inactive')).toBe(true);
      expect(box.classList.contains('sc-box--active')).toBe(false);
    });

    it('input event hides orphan badge when user types a name', async () => {
      stateModule.state.issues = [makeIssue({ id: 1, status: 'Stage3' })];
      await renderProjectSettingsView();

      const input = bySelector(document, '.sc-name-input[data-field="stage3_name"]', HTMLInputElement);
      const box = input.closest('.sc-box');
      assert(box);
      const badge = bySelector(box, '.sc-orphan-badge');
      expect(badge).not.toBeNull();

      input.value = 'QA';
      input.dispatchEvent(new Event('input'));

      expect(badge.style.display).toBe('none');
    });

    it('input event restores orphan badge visibility when name is cleared again', async () => {
      stateModule.state.issues = [makeIssue({ id: 1, status: 'Stage3' })];
      await renderProjectSettingsView();

      const input = bySelector(document, '.sc-name-input[data-field="stage3_name"]', HTMLInputElement);
      const box = input.closest('.sc-box');
      assert(box);
      const badge = bySelector(box, '.sc-orphan-badge');

      input.value = 'QA';
      input.dispatchEvent(new Event('input'));
      expect(badge.style.display).toBe('none');

      input.value = '';
      input.dispatchEvent(new Event('input'));
      expect(badge.style.display).toBe('');
    });
  });

  // ── handleSaveStatusConfig ────────────────────────────────────────────────

  describe('handleSaveStatusConfig()', () => {
    const updatedCfg = makeStatusConfig({ stage1_name: 'Review', stage2_name: 'Working', stage3_name: '', stage4_name: '' });

    beforeEach(() => {
      setupProjectSettingsView();
      vi.mocked(api.updateStatusConfig).mockResolvedValue(updatedCfg);
    });

    it('saves config and shows success notification', async () => {
      await renderProjectSettingsView();

      bySelector(document, '.sc-name-input[data-field="stage1_name"]', HTMLInputElement).value = 'Review';
      byId('ps-save-status-config-btn').click();
      await new Promise(process.nextTick);

      expect(api.updateStatusConfig).toHaveBeenCalledWith(
        1, expect.objectContaining({ stage1_name: 'Review' })
      );
      expect(utils.showNotification).toHaveBeenCalledWith('Column configuration saved', 'success');
    });

    it('sends the names of all four stage columns', async () => {
      await renderProjectSettingsView();

      byId('ps-save-status-config-btn').click();
      await new Promise(process.nextTick);

      const [, payload] = vi.mocked(api.updateStatusConfig).mock.calls[0];
      expect(Object.keys(payload).sort()).toEqual(['stage1_name', 'stage2_name', 'stage3_name', 'stage4_name']);
    });

    it('calls setStatusConfig with the API response', async () => {
      await renderProjectSettingsView();

      byId('ps-save-status-config-btn').click();
      await new Promise(process.nextTick);

      expect(stateModule.setStatusConfig).toHaveBeenCalledWith(updatedCfg);
    });

    it('shows error notification when updateStatusConfig fails', async () => {
      vi.mocked(api.updateStatusConfig).mockRejectedValue(new Error('Server error'));
      await renderProjectSettingsView();

      byId('ps-save-status-config-btn').click();
      await new Promise(process.nextTick);

      expect(utils.showNotification).toHaveBeenCalledWith('Server error', 'error');
    });

    it('shows error notification using message from error when available', async () => {
      vi.mocked(api.updateStatusConfig).mockRejectedValue(new Error('Validation failed'));
      await renderProjectSettingsView();

      byId('ps-save-status-config-btn').click();
      await new Promise(process.nextTick);

      expect(utils.showNotification).toHaveBeenCalledWith('Validation failed', 'error');
    });

    it('saves without confirmation when deactivating a column that has no issues', async () => {
      stateModule.state.issues = [];
      await renderProjectSettingsView();

      bySelector(document, '.sc-name-input[data-field="stage1_name"]', HTMLInputElement).value = '';
      byId('ps-save-status-config-btn').click();
      await new Promise(process.nextTick);

      expect(utils.showConfirm).not.toHaveBeenCalled();
      expect(api.updateStatusConfig).toHaveBeenCalled();
    });

    it('prompts confirmation when deactivating a column that has hidden issues', async () => {
      stateModule.state.issues = [makeIssue({ id: 1, status: 'Stage1' })];
      vi.mocked(utils.showConfirm).mockResolvedValue(true);
      await renderProjectSettingsView();

      bySelector(document, '.sc-name-input[data-field="stage1_name"]', HTMLInputElement).value = '';
      byId('ps-save-status-config-btn').click();
      await new Promise(process.nextTick);

      expect(utils.showConfirm).toHaveBeenCalled();
      expect(api.updateStatusConfig).toHaveBeenCalled();
    });

    it('does not save when deactivation confirmation is cancelled', async () => {
      stateModule.state.issues = [makeIssue({ id: 1, status: 'Stage1' })];
      vi.mocked(utils.showConfirm).mockResolvedValue(false);
      await renderProjectSettingsView();

      bySelector(document, '.sc-name-input[data-field="stage1_name"]', HTMLInputElement).value = '';
      byId('ps-save-status-config-btn').click();
      await new Promise(process.nextTick);

      expect(utils.showConfirm).toHaveBeenCalled();
      expect(api.updateStatusConfig).not.toHaveBeenCalled();
    });

    it('confirmation message lists column name and issue count', async () => {
      stateModule.state.issues = [makeIssue({ id: 1, status: 'Stage1' }), makeIssue({ id: 2, status: 'Stage1' })];
      vi.mocked(utils.showConfirm).mockResolvedValue(true);
      await renderProjectSettingsView();

      bySelector(document, '.sc-name-input[data-field="stage1_name"]', HTMLInputElement).value = '';
      byId('ps-save-status-config-btn').click();
      await new Promise(process.nextTick);

      const [, message] = vi.mocked(utils.showConfirm).mock.calls[0];
      expect(message).toContain('"Pending"');
      expect(message).toContain('2 issues');
    });

    it('shows error for name with invalid characters', async () => {
      await renderProjectSettingsView();

      bySelector(document, '.sc-name-input[data-field="stage1_name"]', HTMLInputElement).value = 'Bad!';
      byId('ps-save-status-config-btn').click();
      await new Promise(process.nextTick);

      expect(utils.showNotification).toHaveBeenCalledWith(
        'Column names must contain only letters, digits and single spaces.', 'error'
      );
      expect(api.updateStatusConfig).not.toHaveBeenCalled();
    });

    it('shows error for name with consecutive spaces', async () => {
      await renderProjectSettingsView();

      bySelector(document, '.sc-name-input[data-field="stage1_name"]', HTMLInputElement).value = 'In  Progress';
      byId('ps-save-status-config-btn').click();
      await new Promise(process.nextTick);

      expect(utils.showNotification).toHaveBeenCalledWith(
        'Column names must contain only letters, digits and single spaces.', 'error'
      );
      expect(api.updateStatusConfig).not.toHaveBeenCalled();
    });

    it('shows error for name exceeding max length', async () => {
      await renderProjectSettingsView();

      bySelector(document, '.sc-name-input[data-field="stage1_name"]', HTMLInputElement).value = 'A'.repeat(16);
      byId('ps-save-status-config-btn').click();
      await new Promise(process.nextTick);

      expect(utils.showNotification).toHaveBeenCalledWith(
        'Column names must not exceed 15 characters.', 'error'
      );
      expect(api.updateStatusConfig).not.toHaveBeenCalled();
    });

    it('saves successfully with a name containing a single space', async () => {
      await renderProjectSettingsView();

      bySelector(document, '.sc-name-input[data-field="stage1_name"]', HTMLInputElement).value = 'In Progress';
      byId('ps-save-status-config-btn').click();
      await new Promise(process.nextTick);

      expect(api.updateStatusConfig).toHaveBeenCalledWith(
        1, expect.objectContaining({ stage1_name: 'In Progress' })
      );
      expect(utils.showNotification).toHaveBeenCalledWith('Column configuration saved', 'success');
    });
  });
});
