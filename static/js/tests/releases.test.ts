import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  setupReleasesView,
  renderReleaseOwnerOptions,
  renderReleasesView,
} from '../components/releases.ts';
import { resetIssueLists } from '../issue-lists.ts';

vi.mock('../api.ts', () => ({
  createRelease: vi.fn(),
  updateRelease: vi.fn(),
  deleteRelease: vi.fn(),
  triggerRelease: vi.fn(),
  reopenRelease: vi.fn(),
  fetchArchivedIssuesByProject: vi.fn(async () => []),
  fetchOpenIssuesByProject: vi.fn(async () => []),
  fetchActiveIssuesByProject: vi.fn(async () => []),
  fetchReleases: vi.fn(async () => []),
}));

vi.mock('../components/toolbar.ts', () => ({
  updateReleaseFilterOptions: vi.fn(),
}));

vi.mock('../utils.ts', async (importOriginal) => ({
  byId: (await importOriginal<typeof import('../utils.ts')>()).byId,
  bySelector: (await importOriginal<typeof import('../utils.ts')>()).bySelector,
  toDateInputValue: (await importOriginal<typeof import('../utils.ts')>()).toDateInputValue,
  onGuardedSubmit: (await importOriginal<typeof import('../utils.ts')>()).onGuardedSubmit,
  errorMessage: (await importOriginal<typeof import('../utils.ts')>()).errorMessage,
  containsTarget: (await importOriginal<typeof import('../utils.ts')>()).containsTarget,
  showNotification: vi.fn(),
  showConfirm: vi.fn(),
  escapeHtml: vi.fn(s => String(s ?? '')),
  initCharCounter: vi.fn(),
  updateDateInputStyle: vi.fn(),
  getUserInitials: vi.fn(() => 'AB'),
  promptAdminPasswordConfirmation: vi.fn(async (title, message, onConfirm) => {
    await onConfirm('AdminPass123!');
    return true;
  }),
}));

vi.mock('../validation-config.ts', () => ({
  MAX_RELEASE_NAME_LEN: 100,
  MAX_RELEASE_DESC_LEN: 500,
}));

vi.mock('../state.ts', () => ({
  state: {
    releases: [],
    currentUser: { id: 1, role: 'admin', first_name: 'Alice', last_name: 'Smith' },
    selectedProjectId: 1,
    issues: [],
    filter: { releaseOwnerFilter: null, releaseSearch: '' },
  },
  setIssues: vi.fn(),
  setReleases: vi.fn(),
}));

vi.mock('../permissions.ts', () => ({
  userCan: vi.fn(() => true),
  ACTION_CREATE_RELEASE: 'create_release',
  ACTION_UPDATE_RELEASE: 'update_release',
  ACTION_DELETE_RELEASE: 'delete_release',
  ACTION_TRIGGER_RELEASE: 'trigger_release',
}));

vi.mock('../status-config.ts', () => ({
  getStatusLabel: vi.fn(s => s),
  STATUS_OPEN:    'Open',
  STATUS_TODO:    'Todo',
  STATUS_STAGE1:  'Stage1',
  STATUS_STAGE2:  'Stage2',
  STATUS_STAGE3:  'Stage3',
  STATUS_STAGE4:  'Stage4',
  STATUS_DONE:    'Done',
  STATUS_ARCHIVE: 'Archive',
  IN_PROGRESS_STATUSES: ['Stage1', 'Stage2', 'Stage3', 'Stage4'],
}));

import { state } from '../state.ts';
import * as api from '../api.ts';
import { byId, bySelector } from '../utils.ts';
import * as utils from '../utils.ts';
import * as toolbar from '../components/toolbar.ts';
import { makeIssue, makeRelease, makeUser, makeUserRef } from './fixtures.ts';
import type { Release } from '../models.ts';

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
    state.currentUser = makeUser({ id: 1, role: 'admin', first_name: 'Alice', last_name: 'Smith' });
    state.selectedProjectId = 1;
    state.issues = [];
    state.filter = { ...state.filter, releaseOwnerFilter: null, releaseSearch: '' };
    vi.clearAllMocks();
    vi.mocked(api.fetchArchivedIssuesByProject).mockResolvedValue([]);
    vi.mocked(api.fetchOpenIssuesByProject).mockResolvedValue([]);
    vi.mocked(api.fetchActiveIssuesByProject).mockResolvedValue([]);
    resetIssueLists();
  });

  // ─── shared issue-list cache ──────────────────────────────────────────────────

  describe('issue list cache', () => {
    it('fetches the open and archived lists once and reuses them on the next render', async () => {
      await renderReleasesView();
      await renderReleasesView();
      expect(api.fetchArchivedIssuesByProject).toHaveBeenCalledTimes(1);
      expect(api.fetchOpenIssuesByProject).toHaveBeenCalledTimes(1);

      resetIssueLists();
      await renderReleasesView(); // cache cleared — must refetch
      expect(api.fetchArchivedIssuesByProject).toHaveBeenCalledTimes(2);
      expect(api.fetchOpenIssuesByProject).toHaveBeenCalledTimes(2);
    });

    it('does not fetch the lists twice when renders overlap', async () => {
      await Promise.all([renderReleasesView(), renderReleasesView()]);
      expect(api.fetchArchivedIssuesByProject).toHaveBeenCalledTimes(1);
      expect(api.fetchOpenIssuesByProject).toHaveBeenCalledTimes(1);
    });
  });

  // ─── renderReleaseOwnerOptions ────────────────────────────────────────────────

  describe('renderReleaseOwnerOptions', () => {
    it('renders "No Owner" and "Assign to me" when currentUser is set', () => {
      renderReleaseOwnerOptions([]);
      const opts = document.querySelectorAll<HTMLElement>('#release-owner-options .custom-option');
      expect(opts).toHaveLength(2);
      expect(opts[0].textContent).toBe('No Owner');
      expect(opts[1].textContent).toBe('Assign to me');
    });

    it('renders active users other than the current user', () => {
      const users = [
        makeUser({ id: 2, first_name: 'Bob', last_name: 'Jones', active: true }),
        makeUser({ id: 3, first_name: 'Carol', last_name: 'White', active: false }), // inactive — excluded
      ];
      renderReleaseOwnerOptions(users);
      const opts = document.querySelectorAll<HTMLElement>('#release-owner-options .custom-option');
      expect(opts).toHaveLength(3); // No Owner + Assign to me + Bob
      expect(opts[2].textContent).toBe('Bob Jones');
    });

    it('excludes the current user from the list of selectable users', () => {
      const users = [makeUser({ id: 1, first_name: 'Alice', last_name: 'Smith', active: true })];
      renderReleaseOwnerOptions(users);
      const opts = document.querySelectorAll<HTMLElement>('#release-owner-options .custom-option');
      expect(opts).toHaveLength(2); // No Owner + Assign to me; Alice excluded
    });

    it('clears owner input and sets "No Owner" text when "No Owner" is clicked', () => {
      renderReleaseOwnerOptions([]);
      bySelector(document, '#release-owner-options .custom-option').click();
      expect(byId('release-owner-input', HTMLInputElement).value).toBe('');
      expect(byId('release-owner-text').textContent).toBe('No Owner');
      expect(byId('release-owner-options').classList.contains('hidden')).toBe(true);
    });

    it('sets owner input to current user id when "Assign to me" is clicked', () => {
      renderReleaseOwnerOptions([]);
      const opts = document.querySelectorAll<HTMLElement>('#release-owner-options .custom-option');
      opts[1].click();
      expect(byId('release-owner-input', HTMLInputElement).value).toBe('1');
      expect(byId('release-owner-text').textContent).toBe('Alice Smith');
    });

    it('sets owner input to the selected user id when a user option is clicked', () => {
      renderReleaseOwnerOptions([makeUser({ id: 2, first_name: 'Bob', last_name: 'Jones', active: true })]);
      const opts = document.querySelectorAll<HTMLElement>('#release-owner-options .custom-option');
      opts[2].click(); // Bob
      expect(byId('release-owner-input', HTMLInputElement).value).toBe('2');
      expect(byId('release-owner-text').textContent).toBe('Bob Jones');
    });

    it('toggles the dropdown when the trigger is clicked', async () => {
      setupReleasesView(); // registers the click listener on the trigger
      renderReleaseOwnerOptions([]);
      const options = byId('release-owner-options');
      const trigger = byId('release-owner-trigger');
      options.classList.add('hidden');
      trigger.click();
      expect(options.classList.contains('hidden')).toBe(false);
    });

    it('closes the dropdown on outside click', async () => {
      setupReleasesView(); // registers the document-level outside-click listener
      renderReleaseOwnerOptions([]);
      const options = byId('release-owner-options');
      options.classList.remove('hidden');
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(options.classList.contains('hidden')).toBe(true);
    });
  });

  // ─── renderReleasesView ───────────────────────────────────────────────────────

  describe('renderReleasesView', () => {
    it('renders "Open Releases" section with empty state text when there are no releases', async () => {
      await renderReleasesView();
      const container = byId('releases-view');
      expect(container.innerHTML).toContain('Open Releases');
      expect(container.innerHTML).toContain('No releases.');
    });

    it('renders an open release row', async () => {
      state.releases = [makeRelease({ id: 1, name: 'v1.0', status: 'open', description: 'First' })];
      await renderReleasesView();
      expect(byId('releases-view').innerHTML).toContain('v1.0');
    });

    it('renders a closed releases section with a divider when closed releases exist', async () => {
      state.releases = [
        makeRelease({ id: 1, name: 'v1.0', status: 'closed', closed_at: '2026-01-01T00:00:00Z', description: '' }),
      ];
      await renderReleasesView();
      const container = byId('releases-view');
      expect(container.innerHTML).toContain('Closed Releases');
      expect(container.querySelector('.releases-divider')).not.toBeNull();
    });

    it('suppresses the "view on board" nav icon for closed releases, since their issues are mostly archived', async () => {
      state.releases = [
        makeRelease({ id: 1, name: 'v1.0', status: 'closed', closed_at: '2026-01-01T00:00:00Z', description: '' }),
      ];
      await renderReleasesView();
      expect(document.querySelector('.release-stats-nav-icon')).toBeNull();
    });

    it('still shows the "view on board" nav icon for open releases', async () => {
      state.releases = [makeRelease({ id: 1, name: 'v1.0', status: 'open', description: '' })];
      await renderReleasesView();
      expect(document.querySelector('.release-stats-nav-icon')).not.toBeNull();
    });

    it('filters releases by owner "me"', async () => {
      state.filter.releaseOwnerFilter = 'me';
      state.releases = [
        makeRelease({ id: 1, name: 'Mine', status: 'open', owner_id: 1, description: '' }),
        makeRelease({ id: 2, name: 'Others', status: 'open', owner_id: 2, description: '' }),
      ];
      await renderReleasesView();
      const html = byId('releases-view').innerHTML;
      expect(html).toContain('Mine');
      expect(html).not.toContain('Others');
    });

    it('filters releases by owner "unassigned"', async () => {
      state.filter.releaseOwnerFilter = 'unassigned';
      state.releases = [
        makeRelease({ id: 1, name: 'Unowned', status: 'open', owner_id: null, description: '' }),
        makeRelease({ id: 2, name: 'Owned', status: 'open', owner_id: 2, description: '' }),
      ];
      await renderReleasesView();
      const html = byId('releases-view').innerHTML;
      expect(html).toContain('Unowned');
      expect(html).not.toContain('Owned');
    });

    it('filters releases by a specific owner id', async () => {
      state.filter.releaseOwnerFilter = 2;
      state.releases = [
        makeRelease({ id: 1, name: 'ByTwo', status: 'open', owner_id: 2, description: '' }),
        makeRelease({ id: 2, name: 'ByOne', status: 'open', owner_id: 1, description: '' }),
      ];
      await renderReleasesView();
      const html = byId('releases-view').innerHTML;
      expect(html).toContain('ByTwo');
      expect(html).not.toContain('ByOne');
    });

    it('filters releases by search term (name match)', async () => {
      state.filter.releaseSearch = 'beta';
      state.releases = [
        makeRelease({ id: 1, name: 'v1.0-beta', status: 'open', owner_id: null, description: '' }),
        makeRelease({ id: 2, name: 'v2.0', status: 'open', owner_id: null, description: '' }),
      ];
      await renderReleasesView();
      const html = byId('releases-view').innerHTML;
      expect(html).toContain('v1.0-beta');
      expect(html).not.toContain('v2.0');
    });

    it('filters releases by search term (description match)', async () => {
      state.filter.releaseSearch = 'hotfix';
      state.releases = [
        makeRelease({ id: 1, name: 'v1.1', status: 'open', owner_id: null, description: 'hotfix release' }),
        makeRelease({ id: 2, name: 'v2.0', status: 'open', owner_id: null, description: '' }),
      ];
      await renderReleasesView();
      const html = byId('releases-view').innerHTML;
      expect(html).toContain('v1.1');
      expect(html).not.toContain('v2.0');
    });

    it('shows filtered count when some releases are hidden by filter', async () => {
      state.filter.releaseOwnerFilter = 'me';
      state.releases = [
        makeRelease({ id: 1, name: 'Mine', status: 'open', owner_id: 1, description: '' }),
        makeRelease({ id: 2, name: 'Others', status: 'open', owner_id: 2, description: '' }),
      ];
      await renderReleasesView();
      expect(byId('releases-view').innerHTML).toContain('1/2');
    });
  });

  // ─── setupReleasesView ────────────────────────────────────────────────────────

  describe('setupReleasesView', () => {
    // Opens the "New Release" form the way the user does, so a submit creates a release.
    async function openNewReleaseForm() {
      setupReleasesView();
      await renderReleasesView();
      bySelector(document, '.release-add-btn').click();
    }

    it('sets up cancel button to close the modal overlay', async () => {
      setupReleasesView();
      byId('release-modal-overlay').classList.remove('hidden');
      byId('release-modal-cancel').click();
      expect(byId('release-modal-overlay').classList.contains('hidden')).toBe(true);
    });

    it('shows an error notification when form is submitted with an empty name', async () => {
      setupReleasesView();
      byId('release-modal-name', HTMLInputElement).value = '';
      byId('release-form').dispatchEvent(new Event('submit'));
      await new Promise(process.nextTick);
      expect(utils.showNotification).toHaveBeenCalledWith('Release name is required.', 'error');
    });

    it('shows an error notification when release date is before start date', async () => {
      setupReleasesView();
      byId('release-modal-name', HTMLInputElement).value = 'Valid Name';
      byId('release-modal-start', HTMLInputElement).value = '2026-06-01';
      byId('release-modal-date', HTMLInputElement).value = '2026-05-01';
      byId('release-form').dispatchEvent(new Event('submit'));
      await new Promise(process.nextTick);
      expect(utils.showNotification).toHaveBeenCalledWith(
        'Release date must not be before start date.',
        'error'
      );
    });

    it('creates a release only once when submitted again while the first save is in flight, with the form greyed out', async () => {
      const { promise: pendingCreate, resolve: resolveCreate } = Promise.withResolvers<Release>();
      vi.mocked(api.createRelease).mockReturnValue(pendingCreate);
      await openNewReleaseForm();
      byId('release-modal-name', HTMLInputElement).value = 'v1.0';
      const form = byId('release-form');

      form.dispatchEvent(new Event('submit'));
      expect(form.getAttribute('aria-busy')).toBe('true');
      form.dispatchEvent(new Event('submit'));

      resolveCreate(makeRelease({ id: 99, name: 'v1.0' }));
      await new Promise(process.nextTick);

      expect(api.createRelease).toHaveBeenCalledTimes(1);
      expect(form.hasAttribute('aria-busy')).toBe(false);
    });

    it('calls createRelease and refreshes the release list on successful new release submit', async () => {
      vi.mocked(api.createRelease).mockResolvedValue(makeRelease({ id: 99, name: 'v1.0' }));
      vi.mocked(api.fetchReleases).mockResolvedValue([makeRelease({ id: 99, name: 'v1.0' })]);
      await openNewReleaseForm();
      byId('release-modal-name', HTMLInputElement).value = 'v1.0';
      byId('release-form').dispatchEvent(new Event('submit'));
      await new Promise(process.nextTick);
      expect(api.createRelease).toHaveBeenCalled();
      // Create doesn't return an owner-hydrated release, so it re-fetches the list instead.
      expect(api.fetchReleases).toHaveBeenCalledWith(1);
      expect(toolbar.updateReleaseFilterOptions).toHaveBeenCalled();
    });

    it('shows inline error when createRelease rejects', async () => {
      vi.mocked(api.createRelease).mockRejectedValue(new Error('Duplicate name'));
      await openNewReleaseForm();
      byId('release-modal-name', HTMLInputElement).value = 'v1.0';
      byId('release-form').dispatchEvent(new Event('submit'));
      await new Promise(process.nextTick);
      const errorEl = byId('release-modal-error');
      expect(errorEl.textContent).toBe('Duplicate name');
      expect(errorEl.classList.contains('hidden')).toBe(false);
    });

    it('sets up delete button when userCan returns true', async () => {
      const { userCan } = await import('../permissions.ts');
      vi.mocked(userCan).mockReturnValue(true);
      state.releases = [makeRelease({ id: 5, name: 'ToDelete', status: 'open' })];
      vi.mocked(utils.showConfirm).mockResolvedValue(false); // cancel the confirm
      setupReleasesView();
      byId('release-modal-delete').classList.remove('hidden');
      byId('release-modal-delete').click();
      await new Promise(process.nextTick);
      // editingReleaseId is null so rel is not found — handler returns early
      expect(api.deleteRelease).not.toHaveBeenCalled();
    });

    it('fires updateDateInputStyle when a date input changes', async () => {
      setupReleasesView();
      const startInput = byId('release-modal-start');
      startInput.dispatchEvent(new Event('change'));
      expect(utils.updateDateInputStyle).toHaveBeenCalledWith(startInput);
    });
  });

  // ─── openReleaseModal ─────────────────────────────────────────────────────────

  describe('openReleaseModal', () => {
    it('opens modal with "New Release" title when the add button is clicked', async () => {
      setupReleasesView();
      await renderReleasesView();
      bySelector(document, '.release-add-btn').click();
      const overlay = byId('release-modal-overlay');
      expect(overlay.classList.contains('hidden')).toBe(false);
      expect(byId('release-modal-title').textContent).toBe('New Release');
      expect(byId('release-modal-save').textContent).toBe('Save');
    });

    it('opens modal with release data when an open release card is clicked', async () => {
      state.releases = [makeRelease({
        id: 10, name: 'v2.0', status: 'open', description: 'My desc',
        owner: makeUserRef({ id: 2, first_name: 'Bob', last_name: 'Jones' }),
        start_date: '2026-01-01T00:00:00Z', release_date: '2026-06-01T00:00:00Z',
      })];
      setupReleasesView();
      await renderReleasesView();
      bySelector(document, '.release-card-left').click();
      expect(byId('release-modal-overlay').classList.contains('hidden')).toBe(false);
      expect(byId('release-modal-name', HTMLInputElement).value).toBe('v2.0');
      expect(byId('release-modal-title').textContent).toBe('Release Details');
      expect(byId('release-modal-save').textContent).toBe('Save');
    });

    it('opens read-only modal for a closed release, showing the closed-at date', async () => {
      state.releases = [makeRelease({
        id: 11, name: 'v1.0', status: 'closed', description: '',
        closed_at: '2026-01-15T00:00:00Z',
        start_date: null, release_date: null,
      })];
      setupReleasesView();
      await renderReleasesView();
      bySelector(document, '.release-card-left').click();
      expect(byId('release-modal-overlay').classList.contains('hidden')).toBe(false);
      expect(byId('release-modal-save').textContent).toBe('Done');
      expect(byId('release-modal-cancel').classList.contains('hidden')).toBe(true);
      expect(byId('release-modal-closed-at-group').classList.contains('hidden')).toBe(false);
      expect(byId('release-modal-closed-at', HTMLInputElement).value).toBe('2026-01-15');
    });

    it('shows modal stats when a release with issues is opened', async () => {
      vi.mocked(api.fetchArchivedIssuesByProject).mockResolvedValue([
        makeIssue({ id: 1, release_id: 10, status: 'Done' }),
        makeIssue({ id: 2, release_id: 10, status: 'Open' }),
      ]);
      state.releases = [makeRelease({
        id: 10, name: 'v2.0', status: 'open', description: '',
        start_date: null, release_date: null,
      })];
      setupReleasesView();
      await renderReleasesView();
      bySelector(document, '.release-card-left').click();
      const stats = byId('release-modal-stats');
      expect(stats.classList.contains('hidden')).toBe(false);
      expect(stats.innerHTML).toContain('2 issues');
    });

    it('hides stats when no release is passed (new release modal)', async () => {
      setupReleasesView();
      await renderReleasesView();
      bySelector(document, '.release-add-btn').click();
      expect(byId('release-modal-stats').classList.contains('hidden')).toBe(true);
    });

    it('dispatches nav-to-release event when the stats nav icon is clicked', async () => {
      state.releases = [makeRelease({
        id: 10, name: 'v2.0', status: 'open', description: '',
        start_date: null, release_date: null,
      })];
      await renderReleasesView();
      let eventDetail = null;
      document.addEventListener('nav-to-release', e => { if (e instanceof CustomEvent) eventDetail = e.detail; }, { once: true });
      bySelector(document, '.release-stats-nav-icon').click();
      expect(eventDetail).toEqual({ releaseId: 10 });
    });
  });

  // ─── handleReleaseSubmit (update / closed) ────────────────────────────────────

  describe('handleReleaseSubmit (update)', () => {
    it('merges the updated release locally and refreshes the filter/view when editing an open release', async () => {
      vi.mocked(api.updateRelease).mockResolvedValue(makeRelease({ id: 10, name: 'v2.1', status: 'open' }));
      state.releases = [makeRelease({
        id: 10, name: 'v2.0', status: 'open', description: '',
        start_date: null, release_date: null,
      })];
      setupReleasesView();
      await renderReleasesView();
      bySelector(document, '.release-card-left').click();
      byId('release-modal-name', HTMLInputElement).value = 'v2.1';
      byId('release-form').dispatchEvent(new Event('submit'));
      await new Promise(process.nextTick);
      expect(api.updateRelease).toHaveBeenCalledWith(1, 10, expect.objectContaining({ name: 'v2.1' }));
      // The update response is already owner-hydrated, so it's merged in locally — no re-fetch.
      expect(api.fetchReleases).not.toHaveBeenCalled();
      expect(state.releases[0]).toEqual(expect.objectContaining({ id: 10, name: 'v2.1' }));
      expect(toolbar.updateReleaseFilterOptions).toHaveBeenCalled();
    });

    it('closes the modal immediately when save is clicked for a closed release', async () => {
      state.releases = [makeRelease({
        id: 11, name: 'v1.0', status: 'closed', description: '',
        closed_at: '2026-01-15T00:00:00Z', start_date: null, release_date: null,
      })];
      setupReleasesView();
      await renderReleasesView();
      bySelector(document, '.release-card-left').click();
      byId('release-form').dispatchEvent(new Event('submit'));
      await new Promise(process.nextTick);
      expect(byId('release-modal-overlay').classList.contains('hidden')).toBe(true);
      expect(api.updateRelease).not.toHaveBeenCalled();
    });
  });

  // ─── handleDeleteRelease ──────────────────────────────────────────────────────

  describe('handleDeleteRelease', () => {
    it('removes the release locally and refreshes issues/filter when deletion is confirmed', async () => {
      vi.mocked(api.deleteRelease).mockResolvedValue(undefined);
      state.releases = [makeRelease({
        id: 10, name: 'v2.0', status: 'open', description: '',
        start_date: null, release_date: null,
      })];
      setupReleasesView();
      await renderReleasesView();
      bySelector(document, '.release-card-left').click(); // sets editingReleaseId = 10
      byId('release-modal-delete').click();
      await new Promise(process.nextTick);
      await new Promise(process.nextTick);
      expect(api.deleteRelease).toHaveBeenCalledWith(1, 10, 'AdminPass123!');
      expect(state.releases).toHaveLength(0);
      // Deleting a release clears release_id on its issues server-side, so all issue
      // lists are re-fetched, in one parallel wave.
      expect(api.fetchActiveIssuesByProject).toHaveBeenCalledWith(1);
      expect(api.fetchOpenIssuesByProject).toHaveBeenCalledTimes(2);
      expect(api.fetchArchivedIssuesByProject).toHaveBeenCalledTimes(2);
      expect(toolbar.updateReleaseFilterOptions).toHaveBeenCalled();
    });

    it('does not call deleteRelease when the confirm is cancelled', async () => {
      vi.mocked(utils.promptAdminPasswordConfirmation).mockResolvedValue(false);
      state.releases = [makeRelease({
        id: 10, name: 'v2.0', status: 'open', description: '',
        start_date: null, release_date: null,
      })];
      setupReleasesView();
      await renderReleasesView();
      bySelector(document, '.release-card-left').click();
      byId('release-modal-delete').click();
      await new Promise(process.nextTick);
      await new Promise(process.nextTick);
      expect(api.deleteRelease).not.toHaveBeenCalled();
    });
  });

  // ─── handleTriggerReleaseDialog ───────────────────────────────────────────────

  describe('handleTriggerReleaseDialog', () => {
    it('shows the release dialog when the Release button is clicked', async () => {
      state.releases = [makeRelease({
        id: 10, name: 'v2.0', status: 'open', description: '',
        start_date: null, release_date: null,
      })];
      await renderReleasesView();
      bySelector(document, '.release-trigger-btn').click();
      await new Promise(process.nextTick);
      expect(document.querySelector('.release-dialog')).not.toBeNull();
    });

    it('removes the dialog and does not call triggerRelease when Cancel is clicked', async () => {
      state.releases = [makeRelease({
        id: 10, name: 'v2.0', status: 'open', description: '',
        start_date: null, release_date: null,
      })];
      await renderReleasesView();
      bySelector(document, '.release-trigger-btn').click();
      await new Promise(process.nextTick);
      byId('release-dialog-cancel').click();
      await new Promise(process.nextTick);
      expect(document.querySelector('.release-dialog')).toBeNull();
      expect(api.triggerRelease).not.toHaveBeenCalled();
    });

    it('merges the closed release locally and refreshes issues/filter when Confirm Release is clicked', async () => {
      vi.mocked(api.triggerRelease).mockResolvedValue(makeRelease({ id: 10, name: 'v2.0', status: 'closed' }));
      setupReleasesView();
      state.releases = [makeRelease({
        id: 10, name: 'v2.0', status: 'open', description: '',
        start_date: null, release_date: null,
      })];
      await renderReleasesView();
      bySelector(document, '.release-trigger-btn').click();
      await new Promise(process.nextTick);
      byId('release-dialog-confirm').click();
      await new Promise(process.nextTick);
      expect(api.triggerRelease).toHaveBeenCalledWith(1, 10, false);
      expect(state.releases[0]).toEqual(expect.objectContaining({ id: 10, status: 'closed' }));
      // Triggering can archive Done issues server-side, so all issue lists are re-fetched.
      expect(api.fetchActiveIssuesByProject).toHaveBeenCalledWith(1);
      expect(api.fetchOpenIssuesByProject).toHaveBeenCalledTimes(2);
      expect(api.fetchArchivedIssuesByProject).toHaveBeenCalledTimes(2);
      expect(toolbar.updateReleaseFilterOptions).toHaveBeenCalled();
    });

    it('shows status breakdown in dialog for releases with issues', async () => {
      vi.mocked(api.fetchArchivedIssuesByProject).mockResolvedValue([
        makeIssue({ id: 1, release_id: 10, status: 'Done' }),
        makeIssue({ id: 2, release_id: 10, status: 'Open' }),
        makeIssue({ id: 3, release_id: 10, status: 'Done' }),
      ]);
      state.releases = [makeRelease({
        id: 10, name: 'v2.0', status: 'open', description: '',
        start_date: null, release_date: null,
      })];
      await renderReleasesView();
      bySelector(document, '.release-trigger-btn').click();
      await new Promise(process.nextTick);
      const dialog = bySelector(document, '.release-dialog');
      expect(dialog.innerHTML).toContain('release-stat-row');
      expect(dialog.innerHTML).toContain('Done');
      expect(dialog.innerHTML).toContain('3 issues');
    });

    it('shows error notification when triggerRelease throws', async () => {
      vi.mocked(api.triggerRelease).mockRejectedValue(new Error('Release failed'));
      state.releases = [makeRelease({
        id: 10, name: 'v2.0', status: 'open', description: '',
        start_date: null, release_date: null,
      })];
      await renderReleasesView();
      bySelector(document, '.release-trigger-btn').click();
      await new Promise(process.nextTick);
      byId('release-dialog-confirm').click();
      await new Promise(process.nextTick);
      expect(utils.showNotification).toHaveBeenCalledWith('Release failed', 'error');
    });
  });

  // ─── setupReleasesView (reopen button) ───────────────────────────────────────

  describe('setupReleasesView (reopen button)', () => {
    it('merges the reopened release locally and refreshes the filter/view when reopen is confirmed', async () => {
      vi.mocked(api.reopenRelease).mockResolvedValue(makeRelease({ id: 11, name: 'v1.0', status: 'open' }));
      vi.mocked(utils.showConfirm).mockResolvedValue(true);
      state.releases = [makeRelease({
        id: 11, name: 'v1.0', status: 'closed', description: '',
        closed_at: '2026-01-15T00:00:00Z', start_date: null, release_date: null,
      })];
      setupReleasesView();
      await renderReleasesView();
      bySelector(document, '.release-card-left').click(); // opens modal for closed release
      byId('release-modal-reopen').click();
      await new Promise(process.nextTick);
      await new Promise(process.nextTick);
      expect(api.reopenRelease).toHaveBeenCalledWith(1, 11);
      // Reopening doesn't touch issues, so only the release itself is merged in locally.
      expect(api.fetchActiveIssuesByProject).not.toHaveBeenCalled();
      expect(state.releases[0]).toEqual(expect.objectContaining({ id: 11, status: 'open' }));
      expect(toolbar.updateReleaseFilterOptions).toHaveBeenCalled();
    });

    it('does not call reopenRelease when reopen confirm is cancelled', async () => {
      vi.mocked(utils.showConfirm).mockResolvedValue(false);
      state.releases = [makeRelease({
        id: 11, name: 'v1.0', status: 'closed', description: '',
        closed_at: '2026-01-15T00:00:00Z', start_date: null, release_date: null,
      })];
      setupReleasesView();
      await renderReleasesView();
      bySelector(document, '.release-card-left').click();
      byId('release-modal-reopen').click();
      await new Promise(process.nextTick);
      await new Promise(process.nextTick);
      expect(api.reopenRelease).not.toHaveBeenCalled();
    });

    it('shows error notification when reopenRelease throws', async () => {
      vi.mocked(api.reopenRelease).mockRejectedValue(new Error('Reopen failed'));
      vi.mocked(utils.showConfirm).mockResolvedValue(true);
      state.releases = [makeRelease({
        id: 11, name: 'v1.0', status: 'closed', description: '',
        closed_at: '2026-01-15T00:00:00Z', start_date: null, release_date: null,
      })];
      setupReleasesView();
      await renderReleasesView();
      bySelector(document, '.release-card-left').click();
      byId('release-modal-reopen').click();
      await new Promise(process.nextTick);
      await new Promise(process.nextTick);
      expect(utils.showNotification).toHaveBeenCalledWith('Reopen failed', 'error');
    });
  });

  // ─── misc coverage ────────────────────────────────────────────────────────────

  describe('misc', () => {
    it('sorts closed releases newest-first', async () => {
      state.releases = [
        makeRelease({ id: 1, name: 'EarlyRelease', status: 'closed', closed_at: '2026-01-01T00:00:00Z', description: '' }),
        makeRelease({ id: 2, name: 'LateRelease', status: 'closed', closed_at: '2026-03-01T00:00:00Z', description: '' }),
      ];
      await renderReleasesView();
      const names = [...document.querySelectorAll('.release-card-name')].map(el => el.textContent);
      expect(names.indexOf('LateRelease')).toBeLessThan(names.indexOf('EarlyRelease'));
    });

    it('sorts open releases with a release date soonest-first', async () => {
      state.releases = [
        makeRelease({ id: 1, name: 'FarRelease', status: 'open', release_date: '2026-12-01T00:00:00Z', description: '' }),
        makeRelease({ id: 2, name: 'NearRelease', status: 'open', release_date: '2026-06-01T00:00:00Z', description: '' }),
      ];
      await renderReleasesView();
      const names = [...document.querySelectorAll('.release-card-name')].map(el => el.textContent);
      expect(names.indexOf('NearRelease')).toBeLessThan(names.indexOf('FarRelease'));
    });

    it('places open releases without a release date after those with one', async () => {
      state.releases = [
        makeRelease({ id: 1, name: 'Undated', status: 'open', release_date: null, description: '' }),
        makeRelease({ id: 2, name: 'Dated', status: 'open', release_date: '2026-06-01T00:00:00Z', description: '' }),
      ];
      await renderReleasesView();
      const names = [...document.querySelectorAll('.release-card-name')].map(el => el.textContent);
      expect(names.indexOf('Dated')).toBeLessThan(names.indexOf('Undated'));
    });

    it('sorts undated open releases by creation date oldest-first', async () => {
      state.releases = [
        makeRelease({ id: 1, name: 'NewerUndated', status: 'open', release_date: null, created_at: '2026-05-01T00:00:00Z', description: '' }),
        makeRelease({ id: 2, name: 'OlderUndated', status: 'open', release_date: null, created_at: '2026-01-01T00:00:00Z', description: '' }),
      ];
      await renderReleasesView();
      const names = [...document.querySelectorAll('.release-card-name')].map(el => el.textContent);
      expect(names.indexOf('OlderUndated')).toBeLessThan(names.indexOf('NewerUndated'));
    });

    it('deduplicates issues from archive, open fetch, and state when refreshing cache', async () => {
      const shared = makeIssue({ id: 1, release_id: 10, status: 'Done' });
      vi.mocked(api.fetchArchivedIssuesByProject).mockResolvedValue([shared]);
      vi.mocked(api.fetchOpenIssuesByProject).mockResolvedValue([shared]);
      state.issues = [shared];
      state.releases = [makeRelease({
        id: 10, name: 'v2.0', status: 'open', description: '',
        start_date: null, release_date: null,
      })];
      await renderReleasesView();
      bySelector(document, '.release-trigger-btn').click();
      await new Promise(process.nextTick);
      expect(bySelector(document, '.release-dialog-intro').textContent).toContain('1 issue');
    });
  });
});
