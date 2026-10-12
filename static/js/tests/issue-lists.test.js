import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadIssues, ensureIssueLists, resetIssueLists } from '../issue-lists.js';
import { state } from '../state.js';
import * as api from '../api.js';

vi.mock('../api.js', () => ({
  fetchActiveIssuesByProject: vi.fn(),
  fetchOpenIssuesByProject: vi.fn(),
  fetchArchivedIssuesByProject: vi.fn(),
}));

// A promise the test resolves by hand, to control the order in which responses arrive.
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

const ids = () => state.issues.map(i => i.id).sort((a, b) => a - b);

describe('issue-lists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.selectedProjectId = 7;
    state.issues = [];
    // Fresh arrays per call, like real responses: merging pushes into state.issues.
    api.fetchActiveIssuesByProject.mockImplementation(async () => [{ id: 1, status: 'Todo' }]);
    api.fetchOpenIssuesByProject.mockImplementation(async () => [{ id: 2, status: 'Open' }]);
    api.fetchArchivedIssuesByProject.mockImplementation(async () => [{ id: 3, status: 'Archive' }]);
    resetIssueLists();
  });

  describe('loadIssues', () => {
    it('starts the active fetch and the requested lists in the same tick', () => {
      void loadIssues(['open', 'archived']);
      expect(api.fetchActiveIssuesByProject).toHaveBeenCalledWith(7);
      expect(api.fetchOpenIssuesByProject).toHaveBeenCalledWith(7);
      expect(api.fetchArchivedIssuesByProject).toHaveBeenCalledWith(7);
    });

    it('replaces state.issues with the active issues plus the requested lists', async () => {
      state.issues = [{ id: 99, status: 'Todo' }];
      await loadIssues(['open']);
      expect(ids()).toEqual([1, 2]);
      expect(api.fetchArchivedIssuesByProject).not.toHaveBeenCalled();
    });

    it('drops lists loaded before, so they are fetched again on the next ensure', async () => {
      await loadIssues(['open']);
      await loadIssues();
      expect(ids()).toEqual([1]);
      await ensureIssueLists(['open']);
      expect(api.fetchOpenIssuesByProject).toHaveBeenCalledTimes(2);
      expect(ids()).toEqual([1, 2]);
    });

    it('keeps a list that arrives before the active issues', async () => {
      const active = deferred();
      api.fetchActiveIssuesByProject.mockReturnValueOnce(active.promise);
      const load = loadIssues(['open']);
      await Promise.resolve(); // open list resolves first
      active.resolve([{ id: 1, status: 'Todo' }]);
      await load;
      expect(ids()).toEqual([1, 2]);
    });

    it('discards the results of a superseded load', async () => {
      const staleActive = deferred();
      const staleOpen = deferred();
      api.fetchActiveIssuesByProject.mockReturnValueOnce(staleActive.promise);
      api.fetchOpenIssuesByProject.mockReturnValueOnce(staleOpen.promise);
      const stale = loadIssues(['open']);

      await loadIssues(); // e.g. project switch while the first load is in flight
      staleActive.resolve([{ id: 50, status: 'Todo' }]);
      staleOpen.resolve([{ id: 51, status: 'Open' }]);
      await stale;
      expect(ids()).toEqual([1]);
    });
  });

  describe('ensureIssueLists', () => {
    it('merges a list into state.issues without duplicating issues already there', async () => {
      state.issues = [{ id: 2, status: 'Todo' }];
      await ensureIssueLists(['open']);
      expect(state.issues).toEqual([{ id: 2, status: 'Todo' }]);
    });

    it('does not refetch a list that is already loaded', async () => {
      await ensureIssueLists(['open', 'archived']);
      await ensureIssueLists(['open']);
      await ensureIssueLists(['archived']);
      expect(api.fetchOpenIssuesByProject).toHaveBeenCalledTimes(1);
      expect(api.fetchArchivedIssuesByProject).toHaveBeenCalledTimes(1);
    });

    it('joins a list request that is still in flight instead of fetching it again', async () => {
      const load = loadIssues(['open']);
      const ensure = ensureIssueLists(['open', 'archived']);
      await Promise.all([load, ensure]);
      expect(api.fetchOpenIssuesByProject).toHaveBeenCalledTimes(1);
      expect(api.fetchArchivedIssuesByProject).toHaveBeenCalledTimes(1);
      expect(ids()).toEqual([1, 2, 3]);
    });

    it('waits for a pending active load before merging, so the list survives it', async () => {
      const active = deferred();
      api.fetchActiveIssuesByProject.mockReturnValueOnce(active.promise);
      const load = loadIssues();
      const ensure = ensureIssueLists(['archived']);
      await Promise.resolve();
      active.resolve([{ id: 1, status: 'Todo' }]);
      await Promise.all([load, ensure]);
      expect(ids()).toEqual([1, 3]);
    });
  });
});
