import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  invalidateReleaseIssueCache,
  setupReleasesView,
  renderReleaseOwnerOptions,
  renderReleasesView,
} from '../components/releases.js';

vi.mock('../api.js', () => ({
  createRelease: vi.fn(),
  updateRelease: vi.fn(),
  deleteRelease: vi.fn(),
  triggerRelease: vi.fn(),
  reopenRelease: vi.fn(),
  fetchArchivedIssuesByProject: vi.fn().mockResolvedValue([]),
  fetchOpenIssuesByProject: vi.fn().mockResolvedValue([]),
}));

vi.mock('../utils.js', () => ({
  showNotification: vi.fn(),
  showConfirm: vi.fn(),
  escapeHtml: vi.fn(s => String(s ?? '')),
  initCharCounter: vi.fn(),
  updateDateInputStyle: vi.fn(),
  getUserInitials: vi.fn(() => 'AB'),
}));

vi.mock('../validation-config.js', () => ({
  MAX_RELEASE_NAME_LEN: 100,
  MAX_RELEASE_DESC_LEN: 500,
}));

vi.mock('../state.js', () => ({
  state: {
    releases: [],
    currentUser: { id: 1, role: 'admin', first_name: 'Alice', last_name: 'Smith' },
    selectedProjectId: 1,
    issues: [],
    filter: { releaseOwnerFilter: null, releaseSearch: '' },
  },
}));

vi.mock('../permissions.js', () => ({
  userCan: vi.fn().mockReturnValue(true),
  ACTION_CREATE_RELEASE: 'create_release',
  ACTION_UPDATE_RELEASE: 'update_release',
  ACTION_DELETE_RELEASE: 'delete_release',
  ACTION_TRIGGER_RELEASE: 'trigger_release',
}));

vi.mock('../status-config.js', () => ({
  getStatusLabel: vi.fn(s => s),
  STATUS_OPEN:    'Open',
  STATUS_TODO:    'Todo',
  STATUS_STAGE1:  'Stage1',
  STATUS_STAGE2:  'Stage2',
  STATUS_STAGE3:  'Stage3',
  STATUS_STAGE4:  'Stage4',
  STATUS_DONE:    'Done',
  STATUS_ARCHIVE: 'Archive',
}));

import { state } from '../state.js';
import * as api from '../api.js';
import * as utils from '../utils.js';

function buildDOM() {
  document.body.innerHTML = `
    <div id="releases-view"></div>
    <div id="release-modal-overlay" class="hidden">
      <form id="release-form">
        <h2 id="release-modal-title"></h2>
        <input id="release-modal-name" type="text">
        <textarea id="release-modal-desc"></textarea>
        <input id="release-modal-start" type="date">
        <input id="release-modal-date" type="date">
        <div id="release-modal-closed-at-group" class="hidden">
          <input id="release-modal-closed-at" type="date" data-permanent-readonly>
        </div>
        <div id="release-modal-stats" class="hidden"></div>
        <div id="release-modal-error" class="hidden"></div>
        <div id="release-owner-dropdown">
          <button id="release-owner-trigger" type="button">
            <span id="release-owner-text">No Owner</span>
          </button>
          <div id="release-owner-options" class="hidden"></div>
        </div>
        <input id="release-owner-input" type="hidden">
        <button id="release-modal-cancel" type="button">Cancel</button>
        <button id="release-modal-save" type="submit">Save</button>
        <button id="release-modal-delete" type="button" class="hidden">Delete</button>
        <button id="release-modal-reopen" type="button" class="hidden">Reopen</button>
      </form>
    </div>
  `;
}

describe('releases', () => {
  beforeEach(() => {
    buildDOM();
    state.releases = [];
    state.currentUser = { id: 1, role: 'admin', first_name: 'Alice', last_name: 'Smith' };
    state.selectedProjectId = 1;
    state.issues = [];
    state.filter = { releaseOwnerFilter: null, releaseSearch: '' };
    vi.clearAllMocks();
    api.fetchArchivedIssuesByProject.mockResolvedValue([]);
    api.fetchOpenIssuesByProject.mockResolvedValue([]);
    invalidateReleaseIssueCache();
  });

  // ─── invalidateReleaseIssueCache ─────────────────────────────────────────────

  describe('invalidateReleaseIssueCache', () => {
    it('forces the issue cache to refresh on the next renderReleasesView call', async () => {
      await renderReleasesView();
      const callsAfterFirst = api.fetchArchivedIssuesByProject.mock.calls.length;

      await renderReleasesView(); // should use cache — no extra fetch
      expect(api.fetchArchivedIssuesByProject.mock.calls.length).toBe(callsAfterFirst);

      invalidateReleaseIssueCache();
      await renderReleasesView(); // cache cleared — must refetch
      expect(api.fetchArchivedIssuesByProject.mock.calls.length).toBe(callsAfterFirst + 1);
    });
  });

  // ─── renderReleaseOwnerOptions ────────────────────────────────────────────────

  describe('renderReleaseOwnerOptions', () => {
    it('renders "No Owner" and "Assign to me" when currentUser is set', () => {
      renderReleaseOwnerOptions([]);
      const opts = document.querySelectorAll('#release-owner-options .custom-option');
      expect(opts).toHaveLength(2);
      expect(opts[0].textContent).toBe('No Owner');
      expect(opts[1].textContent).toBe('Assign to me');
    });

    it('renders active users other than the current user', () => {
      const users = [
        { id: 2, first_name: 'Bob', last_name: 'Jones', active: true },
        { id: 3, first_name: 'Carol', last_name: 'White', active: false }, // inactive — excluded
      ];
      renderReleaseOwnerOptions(users);
      const opts = document.querySelectorAll('#release-owner-options .custom-option');
      expect(opts).toHaveLength(3); // No Owner + Assign to me + Bob
      expect(opts[2].textContent).toBe('Bob Jones');
    });

    it('excludes the current user from the list of selectable users', () => {
      const users = [{ id: 1, first_name: 'Alice', last_name: 'Smith', active: true }];
      renderReleaseOwnerOptions(users);
      const opts = document.querySelectorAll('#release-owner-options .custom-option');
      expect(opts).toHaveLength(2); // No Owner + Assign to me; Alice excluded
    });

    it('clears owner input and sets "No Owner" text when "No Owner" is clicked', () => {
      renderReleaseOwnerOptions([]);
      document.querySelector('#release-owner-options .custom-option').click();
      expect(document.getElementById('release-owner-input').value).toBe('');
      expect(document.getElementById('release-owner-text').textContent).toBe('No Owner');
      expect(document.getElementById('release-owner-options').classList.contains('hidden')).toBe(true);
    });

    it('sets owner input to current user id when "Assign to me" is clicked', () => {
      renderReleaseOwnerOptions([]);
      const opts = document.querySelectorAll('#release-owner-options .custom-option');
      opts[1].click();
      expect(document.getElementById('release-owner-input').value).toBe('1');
      expect(document.getElementById('release-owner-text').textContent).toBe('Alice Smith');
    });

    it('sets owner input to the selected user id when a user option is clicked', () => {
      renderReleaseOwnerOptions([{ id: 2, first_name: 'Bob', last_name: 'Jones', active: true }]);
      const opts = document.querySelectorAll('#release-owner-options .custom-option');
      opts[2].click(); // Bob
      expect(document.getElementById('release-owner-input').value).toBe('2');
      expect(document.getElementById('release-owner-text').textContent).toBe('Bob Jones');
    });

    it('returns early without throwing when the container element is absent', () => {
      document.getElementById('release-owner-options').remove();
      expect(() => renderReleaseOwnerOptions([])).not.toThrow();
    });

    it('toggles the dropdown when the trigger is clicked', async () => {
      await setupReleasesView(vi.fn()); // registers the click listener on the trigger
      renderReleaseOwnerOptions([]);
      const options = document.getElementById('release-owner-options');
      const trigger = document.getElementById('release-owner-trigger');
      options.classList.add('hidden');
      trigger.click();
      expect(options.classList.contains('hidden')).toBe(false);
    });

    it('closes the dropdown on outside click', async () => {
      await setupReleasesView(vi.fn()); // registers the document-level outside-click listener
      renderReleaseOwnerOptions([]);
      const options = document.getElementById('release-owner-options');
      options.classList.remove('hidden');
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(options.classList.contains('hidden')).toBe(true);
    });
  });

  // ─── renderReleasesView ───────────────────────────────────────────────────────

  describe('renderReleasesView', () => {
    it('returns early without throwing when the container is absent', async () => {
      document.getElementById('releases-view').remove();
      await expect(renderReleasesView()).resolves.not.toThrow();
    });

    it('renders "Open Releases" section with empty state text when there are no releases', async () => {
      await renderReleasesView();
      const container = document.getElementById('releases-view');
      expect(container.innerHTML).toContain('Open Releases');
      expect(container.innerHTML).toContain('No releases.');
    });

    it('renders an open release row', async () => {
      state.releases = [{ id: 1, name: 'v1.0', status: 'open', description: 'First', owner: null }];
      await renderReleasesView();
      expect(document.getElementById('releases-view').innerHTML).toContain('v1.0');
    });

    it('renders a closed releases section with a divider when closed releases exist', async () => {
      state.releases = [
        { id: 1, name: 'v1.0', status: 'closed', closed_at: '2026-01-01T00:00:00Z', description: '', owner: null },
      ];
      await renderReleasesView();
      const container = document.getElementById('releases-view');
      expect(container.innerHTML).toContain('Closed Releases');
      expect(container.querySelector('.releases-divider')).not.toBeNull();
    });

    it('forces a cache refresh when forceRefresh is true', async () => {
      await renderReleasesView(); // populate cache
      const callsBefore = api.fetchArchivedIssuesByProject.mock.calls.length;
      await renderReleasesView(true);
      expect(api.fetchArchivedIssuesByProject.mock.calls.length).toBe(callsBefore + 1);
    });

    it('filters releases by owner "me"', async () => {
      state.filter.releaseOwnerFilter = 'me';
      state.releases = [
        { id: 1, name: 'Mine', status: 'open', owner_id: 1, description: '', owner: null },
        { id: 2, name: 'Others', status: 'open', owner_id: 2, description: '', owner: null },
      ];
      await renderReleasesView();
      const html = document.getElementById('releases-view').innerHTML;
      expect(html).toContain('Mine');
      expect(html).not.toContain('Others');
    });

    it('filters releases by owner "unassigned"', async () => {
      state.filter.releaseOwnerFilter = 'unassigned';
      state.releases = [
        { id: 1, name: 'Unowned', status: 'open', owner_id: null, description: '', owner: null },
        { id: 2, name: 'Owned', status: 'open', owner_id: 2, description: '', owner: null },
      ];
      await renderReleasesView();
      const html = document.getElementById('releases-view').innerHTML;
      expect(html).toContain('Unowned');
      expect(html).not.toContain('Owned');
    });

    it('filters releases by a specific owner id', async () => {
      state.filter.releaseOwnerFilter = '2';
      state.releases = [
        { id: 1, name: 'ByTwo', status: 'open', owner_id: 2, description: '', owner: null },
        { id: 2, name: 'ByOne', status: 'open', owner_id: 1, description: '', owner: null },
      ];
      await renderReleasesView();
      const html = document.getElementById('releases-view').innerHTML;
      expect(html).toContain('ByTwo');
      expect(html).not.toContain('ByOne');
    });

    it('filters releases by search term (name match)', async () => {
      state.filter.releaseSearch = 'beta';
      state.releases = [
        { id: 1, name: 'v1.0-beta', status: 'open', owner_id: null, description: '', owner: null },
        { id: 2, name: 'v2.0', status: 'open', owner_id: null, description: '', owner: null },
      ];
      await renderReleasesView();
      const html = document.getElementById('releases-view').innerHTML;
      expect(html).toContain('v1.0-beta');
      expect(html).not.toContain('v2.0');
    });

    it('filters releases by search term (description match)', async () => {
      state.filter.releaseSearch = 'hotfix';
      state.releases = [
        { id: 1, name: 'v1.1', status: 'open', owner_id: null, description: 'hotfix release', owner: null },
        { id: 2, name: 'v2.0', status: 'open', owner_id: null, description: '', owner: null },
      ];
      await renderReleasesView();
      const html = document.getElementById('releases-view').innerHTML;
      expect(html).toContain('v1.1');
      expect(html).not.toContain('v2.0');
    });

    it('shows filtered count when some releases are hidden by filter', async () => {
      state.filter.releaseOwnerFilter = 'me';
      state.releases = [
        { id: 1, name: 'Mine', status: 'open', owner_id: 1, description: '', owner: null },
        { id: 2, name: 'Others', status: 'open', owner_id: 2, description: '', owner: null },
      ];
      await renderReleasesView();
      expect(document.getElementById('releases-view').innerHTML).toContain('1/2');
    });
  });

  // ─── setupReleasesView ────────────────────────────────────────────────────────

  describe('setupReleasesView', () => {
    it('sets up cancel button to close the modal overlay', async () => {
      await setupReleasesView(vi.fn());
      document.getElementById('release-modal-overlay').classList.remove('hidden');
      document.getElementById('release-modal-cancel').click();
      expect(document.getElementById('release-modal-overlay').classList.contains('hidden')).toBe(true);
    });

    it('shows an error notification when form is submitted with an empty name', async () => {
      await setupReleasesView(vi.fn());
      document.getElementById('release-modal-name').value = '';
      document.getElementById('release-form').dispatchEvent(new Event('submit'));
      await new Promise(process.nextTick);
      expect(utils.showNotification).toHaveBeenCalledWith('Release name is required.', 'error');
    });

    it('shows an error notification when release date is before start date', async () => {
      await setupReleasesView(vi.fn());
      document.getElementById('release-modal-name').value = 'Valid Name';
      document.getElementById('release-modal-start').value = '2026-06-01';
      document.getElementById('release-modal-date').value = '2026-05-01';
      document.getElementById('release-form').dispatchEvent(new Event('submit'));
      await new Promise(process.nextTick);
      expect(utils.showNotification).toHaveBeenCalledWith(
        'Release date must not be before start date.',
        'error'
      );
    });

    it('calls createRelease and refresh callback on successful new release submit', async () => {
      api.createRelease.mockResolvedValue({ id: 99, name: 'v1.0' });
      const callback = vi.fn();
      await setupReleasesView(callback);
      document.getElementById('release-modal-name').value = 'v1.0';
      document.getElementById('release-form').dispatchEvent(new Event('submit'));
      await new Promise(process.nextTick);
      expect(api.createRelease).toHaveBeenCalled();
      expect(callback).toHaveBeenCalled();
    });

    it('shows inline error when createRelease rejects', async () => {
      api.createRelease.mockRejectedValue(new Error('Duplicate name'));
      await setupReleasesView(vi.fn());
      document.getElementById('release-modal-name').value = 'v1.0';
      document.getElementById('release-form').dispatchEvent(new Event('submit'));
      await new Promise(process.nextTick);
      const errorEl = document.getElementById('release-modal-error');
      expect(errorEl.textContent).toBe('Duplicate name');
      expect(errorEl.classList.contains('hidden')).toBe(false);
    });

    it('sets up delete button when userCan returns true', async () => {
      const { userCan } = await import('../permissions.js');
      userCan.mockReturnValue(true);
      state.releases = [{ id: 5, name: 'ToDelete', status: 'open' }];
      utils.showConfirm.mockResolvedValue(false); // cancel the confirm
      await setupReleasesView(vi.fn());
      document.getElementById('release-modal-delete').classList.remove('hidden');
      document.getElementById('release-modal-delete').click();
      await new Promise(process.nextTick);
      // editingReleaseId is null so rel is not found — handler returns early
      expect(api.deleteRelease).not.toHaveBeenCalled();
    });

    it('fires updateDateInputStyle when a date input changes', async () => {
      await setupReleasesView(vi.fn());
      const startInput = document.getElementById('release-modal-start');
      startInput.dispatchEvent(new Event('change'));
      expect(utils.updateDateInputStyle).toHaveBeenCalledWith(startInput);
    });
  });

  // ─── openReleaseModal ─────────────────────────────────────────────────────────

  describe('openReleaseModal', () => {
    it('opens modal with "New Release" title when the add button is clicked', async () => {
      await setupReleasesView(vi.fn());
      await renderReleasesView();
      document.querySelector('.release-add-btn').click();
      const overlay = document.getElementById('release-modal-overlay');
      expect(overlay.classList.contains('hidden')).toBe(false);
      expect(document.getElementById('release-modal-title').textContent).toBe('New Release');
      expect(document.getElementById('release-modal-save').textContent).toBe('Save');
    });

    it('opens modal with release data when an open release card is clicked', async () => {
      state.releases = [{
        id: 10, name: 'v2.0', status: 'open', description: 'My desc',
        owner: { id: 2, first_name: 'Bob', last_name: 'Jones' },
        start_date: '2026-01-01T00:00:00Z', release_date: '2026-06-01T00:00:00Z',
      }];
      await setupReleasesView(vi.fn());
      await renderReleasesView();
      document.querySelector('.release-card-left').click();
      expect(document.getElementById('release-modal-overlay').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('release-modal-name').value).toBe('v2.0');
      expect(document.getElementById('release-modal-title').textContent).toBe('Release Details');
      expect(document.getElementById('release-modal-save').textContent).toBe('Save');
    });

    it('opens read-only modal for a closed release, showing the closed-at date', async () => {
      state.releases = [{
        id: 11, name: 'v1.0', status: 'closed', description: '',
        owner: null, closed_at: '2026-01-15T00:00:00Z',
        start_date: null, release_date: null,
      }];
      await setupReleasesView(vi.fn());
      await renderReleasesView();
      document.querySelector('.release-card-left').click();
      expect(document.getElementById('release-modal-overlay').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('release-modal-save').textContent).toBe('Done');
      expect(document.getElementById('release-modal-cancel').classList.contains('hidden')).toBe(true);
      expect(document.getElementById('release-modal-closed-at-group').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('release-modal-closed-at').value).toBe('2026-01-15');
    });

    it('shows modal stats when a release with issues is opened', async () => {
      api.fetchArchivedIssuesByProject.mockResolvedValue([
        { id: 1, release_id: 10, status: 'Done' },
        { id: 2, release_id: 10, status: 'Open' },
      ]);
      state.releases = [{
        id: 10, name: 'v2.0', status: 'open', description: '', owner: null,
        start_date: null, release_date: null,
      }];
      await setupReleasesView(vi.fn());
      await renderReleasesView();
      document.querySelector('.release-card-left').click();
      const stats = document.getElementById('release-modal-stats');
      expect(stats.classList.contains('hidden')).toBe(false);
      expect(stats.innerHTML).toContain('2 issues');
    });

    it('hides stats when no release is passed (new release modal)', async () => {
      await setupReleasesView(vi.fn());
      await renderReleasesView();
      document.querySelector('.release-add-btn').click();
      expect(document.getElementById('release-modal-stats').classList.contains('hidden')).toBe(true);
    });

    it('dispatches nav-to-release event when the stats nav icon is clicked', async () => {
      state.releases = [{
        id: 10, name: 'v2.0', status: 'open', description: '', owner: null,
        start_date: null, release_date: null,
      }];
      await renderReleasesView();
      let eventDetail = null;
      document.addEventListener('nav-to-release', e => { eventDetail = e.detail; }, { once: true });
      document.querySelector('.release-stats-nav-icon').click();
      expect(eventDetail).toEqual({ releaseId: 10 });
    });
  });

  // ─── handleReleaseSubmit (update / closed) ────────────────────────────────────

  describe('handleReleaseSubmit (update)', () => {
    it('calls updateRelease and refresh callback when editing an open release', async () => {
      api.updateRelease.mockResolvedValue({});
      const callback = vi.fn();
      state.releases = [{
        id: 10, name: 'v2.0', status: 'open', description: '', owner: null,
        start_date: null, release_date: null,
      }];
      await setupReleasesView(callback);
      await renderReleasesView();
      document.querySelector('.release-card-left').click();
      document.getElementById('release-modal-name').value = 'v2.1';
      document.getElementById('release-form').dispatchEvent(new Event('submit'));
      await new Promise(process.nextTick);
      expect(api.updateRelease).toHaveBeenCalledWith(1, 10, expect.objectContaining({ name: 'v2.1' }));
      expect(callback).toHaveBeenCalled();
    });

    it('closes the modal immediately when save is clicked for a closed release', async () => {
      state.releases = [{
        id: 11, name: 'v1.0', status: 'closed', description: '', owner: null,
        closed_at: '2026-01-15T00:00:00Z', start_date: null, release_date: null,
      }];
      await setupReleasesView(vi.fn());
      await renderReleasesView();
      document.querySelector('.release-card-left').click();
      document.getElementById('release-form').dispatchEvent(new Event('submit'));
      await new Promise(process.nextTick);
      expect(document.getElementById('release-modal-overlay').classList.contains('hidden')).toBe(true);
      expect(api.updateRelease).not.toHaveBeenCalled();
    });
  });

  // ─── handleDeleteRelease ──────────────────────────────────────────────────────

  describe('handleDeleteRelease', () => {
    it('calls deleteRelease and refresh callback when deletion is confirmed', async () => {
      api.deleteRelease.mockResolvedValue({});
      utils.showConfirm.mockResolvedValue(true);
      const callback = vi.fn();
      state.releases = [{
        id: 10, name: 'v2.0', status: 'open', description: '', owner: null,
        start_date: null, release_date: null,
      }];
      await setupReleasesView(callback);
      await renderReleasesView();
      document.querySelector('.release-card-left').click(); // sets editingReleaseId = 10
      document.getElementById('release-modal-delete').click();
      await new Promise(process.nextTick);
      await new Promise(process.nextTick);
      expect(api.deleteRelease).toHaveBeenCalledWith(undefined, 10);
      expect(callback).toHaveBeenCalled();
    });

    it('does not call deleteRelease when the confirm is cancelled', async () => {
      utils.showConfirm.mockResolvedValue(false);
      state.releases = [{
        id: 10, name: 'v2.0', status: 'open', description: '', owner: null,
        start_date: null, release_date: null,
      }];
      await setupReleasesView(vi.fn());
      await renderReleasesView();
      document.querySelector('.release-card-left').click();
      document.getElementById('release-modal-delete').click();
      await new Promise(process.nextTick);
      await new Promise(process.nextTick);
      expect(api.deleteRelease).not.toHaveBeenCalled();
    });

    it('shows error notification when deleteRelease throws', async () => {
      api.deleteRelease.mockRejectedValue(new Error('Delete failed'));
      utils.showConfirm.mockResolvedValue(true);
      state.releases = [{
        id: 10, name: 'v2.0', status: 'open', description: '', owner: null,
        start_date: null, release_date: null,
      }];
      await setupReleasesView(vi.fn());
      await renderReleasesView();
      document.querySelector('.release-card-left').click();
      document.getElementById('release-modal-delete').click();
      await new Promise(process.nextTick);
      await new Promise(process.nextTick);
      expect(utils.showNotification).toHaveBeenCalledWith('Delete failed', 'error');
    });
  });

  // ─── handleTriggerReleaseDialog ───────────────────────────────────────────────

  describe('handleTriggerReleaseDialog', () => {
    it('shows the release dialog when the Release button is clicked', async () => {
      state.releases = [{
        id: 10, name: 'v2.0', status: 'open', description: '', owner: null,
        start_date: null, release_date: null,
      }];
      await renderReleasesView();
      document.querySelector('.release-trigger-btn').click();
      await new Promise(process.nextTick);
      expect(document.querySelector('.release-dialog')).not.toBeNull();
    });

    it('removes the dialog and does not call triggerRelease when Cancel is clicked', async () => {
      state.releases = [{
        id: 10, name: 'v2.0', status: 'open', description: '', owner: null,
        start_date: null, release_date: null,
      }];
      await renderReleasesView();
      document.querySelector('.release-trigger-btn').click();
      await new Promise(process.nextTick);
      document.getElementById('release-dialog-cancel').click();
      await new Promise(process.nextTick);
      expect(document.querySelector('.release-dialog')).toBeNull();
      expect(api.triggerRelease).not.toHaveBeenCalled();
    });

    it('calls triggerRelease and refresh callback when Confirm Release is clicked', async () => {
      api.triggerRelease.mockResolvedValue({});
      const callback = vi.fn();
      await setupReleasesView(callback);
      state.releases = [{
        id: 10, name: 'v2.0', status: 'open', description: '', owner: null,
        start_date: null, release_date: null,
      }];
      await renderReleasesView();
      document.querySelector('.release-trigger-btn').click();
      await new Promise(process.nextTick);
      document.getElementById('release-dialog-confirm').click();
      await new Promise(process.nextTick);
      expect(api.triggerRelease).toHaveBeenCalledWith(undefined, 10, false);
      expect(callback).toHaveBeenCalled();
    });

    it('shows status breakdown in dialog for releases with issues', async () => {
      api.fetchArchivedIssuesByProject.mockResolvedValue([
        { id: 1, release_id: 10, status: 'Done' },
        { id: 2, release_id: 10, status: 'Open' },
        { id: 3, release_id: 10, status: 'Done' },
      ]);
      state.releases = [{
        id: 10, name: 'v2.0', status: 'open', description: '', owner: null,
        start_date: null, release_date: null,
      }];
      await renderReleasesView();
      document.querySelector('.release-trigger-btn').click();
      await new Promise(process.nextTick);
      const dialog = document.querySelector('.release-dialog');
      expect(dialog.innerHTML).toContain('release-stat-row');
      expect(dialog.innerHTML).toContain('Done');
      expect(dialog.innerHTML).toContain('3 issues');
    });

    it('shows error notification when triggerRelease throws', async () => {
      api.triggerRelease.mockRejectedValue(new Error('Release failed'));
      state.releases = [{
        id: 10, name: 'v2.0', status: 'open', description: '', owner: null,
        start_date: null, release_date: null,
      }];
      await renderReleasesView();
      document.querySelector('.release-trigger-btn').click();
      await new Promise(process.nextTick);
      document.getElementById('release-dialog-confirm').click();
      await new Promise(process.nextTick);
      expect(utils.showNotification).toHaveBeenCalledWith('Release failed', 'error');
    });
  });

  // ─── setupReleasesView (reopen button) ───────────────────────────────────────

  describe('setupReleasesView (reopen button)', () => {
    it('calls reopenRelease and refresh callback when reopen is confirmed', async () => {
      api.reopenRelease.mockResolvedValue({});
      utils.showConfirm.mockResolvedValue(true);
      const callback = vi.fn();
      state.releases = [{
        id: 11, name: 'v1.0', status: 'closed', description: '', owner: null,
        closed_at: '2026-01-15T00:00:00Z', start_date: null, release_date: null,
      }];
      await setupReleasesView(callback);
      await renderReleasesView();
      document.querySelector('.release-card-left').click(); // opens modal for closed release
      document.getElementById('release-modal-reopen').click();
      await new Promise(process.nextTick);
      await new Promise(process.nextTick);
      expect(api.reopenRelease).toHaveBeenCalledWith(undefined, 11);
      expect(callback).toHaveBeenCalled();
    });

    it('does not call reopenRelease when reopen confirm is cancelled', async () => {
      utils.showConfirm.mockResolvedValue(false);
      state.releases = [{
        id: 11, name: 'v1.0', status: 'closed', description: '', owner: null,
        closed_at: '2026-01-15T00:00:00Z', start_date: null, release_date: null,
      }];
      await setupReleasesView(vi.fn());
      await renderReleasesView();
      document.querySelector('.release-card-left').click();
      document.getElementById('release-modal-reopen').click();
      await new Promise(process.nextTick);
      await new Promise(process.nextTick);
      expect(api.reopenRelease).not.toHaveBeenCalled();
    });

    it('shows error notification when reopenRelease throws', async () => {
      api.reopenRelease.mockRejectedValue(new Error('Reopen failed'));
      utils.showConfirm.mockResolvedValue(true);
      state.releases = [{
        id: 11, name: 'v1.0', status: 'closed', description: '', owner: null,
        closed_at: '2026-01-15T00:00:00Z', start_date: null, release_date: null,
      }];
      await setupReleasesView(vi.fn());
      await renderReleasesView();
      document.querySelector('.release-card-left').click();
      document.getElementById('release-modal-reopen').click();
      await new Promise(process.nextTick);
      await new Promise(process.nextTick);
      expect(utils.showNotification).toHaveBeenCalledWith('Reopen failed', 'error');
    });
  });

  // ─── misc coverage ────────────────────────────────────────────────────────────

  describe('misc', () => {
    it('sorts closed releases newest-first', async () => {
      state.releases = [
        { id: 1, name: 'EarlyRelease', status: 'closed', closed_at: '2026-01-01T00:00:00Z', description: '', owner: null },
        { id: 2, name: 'LateRelease', status: 'closed', closed_at: '2026-03-01T00:00:00Z', description: '', owner: null },
      ];
      await renderReleasesView();
      const names = [...document.querySelectorAll('.release-card-name')].map(el => el.textContent);
      expect(names.indexOf('LateRelease')).toBeLessThan(names.indexOf('EarlyRelease'));
    });

    it('sorts open releases with a release date soonest-first', async () => {
      state.releases = [
        { id: 1, name: 'FarRelease', status: 'open', release_date: '2026-12-01T00:00:00Z', description: '', owner: null },
        { id: 2, name: 'NearRelease', status: 'open', release_date: '2026-06-01T00:00:00Z', description: '', owner: null },
      ];
      await renderReleasesView();
      const names = [...document.querySelectorAll('.release-card-name')].map(el => el.textContent);
      expect(names.indexOf('NearRelease')).toBeLessThan(names.indexOf('FarRelease'));
    });

    it('places open releases without a release date after those with one', async () => {
      state.releases = [
        { id: 1, name: 'Undated', status: 'open', release_date: null, description: '', owner: null },
        { id: 2, name: 'Dated', status: 'open', release_date: '2026-06-01T00:00:00Z', description: '', owner: null },
      ];
      await renderReleasesView();
      const names = [...document.querySelectorAll('.release-card-name')].map(el => el.textContent);
      expect(names.indexOf('Dated')).toBeLessThan(names.indexOf('Undated'));
    });

    it('sorts undated open releases by creation date oldest-first', async () => {
      state.releases = [
        { id: 1, name: 'NewerUndated', status: 'open', release_date: null, created_at: '2026-05-01T00:00:00Z', description: '', owner: null },
        { id: 2, name: 'OlderUndated', status: 'open', release_date: null, created_at: '2026-01-01T00:00:00Z', description: '', owner: null },
      ];
      await renderReleasesView();
      const names = [...document.querySelectorAll('.release-card-name')].map(el => el.textContent);
      expect(names.indexOf('OlderUndated')).toBeLessThan(names.indexOf('NewerUndated'));
    });

    it('deduplicates issues from archive, open fetch, and state when refreshing cache', async () => {
      const shared = { id: 1, release_id: 10, status: 'Done' };
      api.fetchArchivedIssuesByProject.mockResolvedValue([shared]);
      api.fetchOpenIssuesByProject.mockResolvedValue([shared]);
      state.issues = [shared];
      state.releases = [{
        id: 10, name: 'v2.0', status: 'open', description: '', owner: null,
        start_date: null, release_date: null,
      }];
      await renderReleasesView();
      document.querySelector('.release-trigger-btn').click();
      await new Promise(process.nextTick);
      expect(document.querySelector('.release-dialog-intro').textContent).toContain('1 issue');
    });
  });
});
