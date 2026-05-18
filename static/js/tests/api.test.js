import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchActiveIssuesByProject,
  fetchArchivedIssuesByProject,
  fetchOpenIssuesByProject,
  fetchIssueById,
  createIssue,
  updateIssue,
  archiveIssue,
  unarchiveIssue,
  fetchVersion,
  fetchCurrentUser,
  logout,
  fetchProjects,
  createProject,
  updateProject,
  deleteProject,
  fetchUsers,
  createUser,
  updateUser,
  fetchStatusConfig,
  updateStatusConfig,
  fetchReleases,
  createRelease,
  updateRelease,
  deleteRelease,
  reopenRelease,
  triggerRelease,
} from '../api.js';

function makeResponse(status, body, headers = {}) {
  const bodyInit = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(bodyInit, {
    status,
    headers: new Headers({ 'Content-Type': 'application/json', ...headers }),
  });
}

describe('api', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('location', { href: '' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // --- authFetch core behaviour ---

  describe('authFetch - 429', () => {
    it('returns rate-limit error message without retrying', async () => {
      fetch.mockResolvedValue(makeResponse(429, 'ignored'));
      await expect(createIssue({ title: 'x' })).rejects.toThrow('Too many requests');
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('authFetch - 401 handling', () => {
    it('refreshes token and retries original request on 401', async () => {
      const data = [{ id: 1, title: 'Issue' }];
      fetch
        .mockResolvedValueOnce(makeResponse(401, ''))
        .mockResolvedValueOnce(makeResponse(200, {}))
        .mockResolvedValueOnce(makeResponse(200, data));

      const result = await fetchActiveIssuesByProject(1);

      expect(fetch).toHaveBeenCalledTimes(3);
      expect(fetch.mock.calls[1][0]).toContain('/auth/refresh');
      expect(result).toEqual(data);
    });

    it('redirects to /login when token refresh fails', async () => {
      fetch
        .mockResolvedValueOnce(makeResponse(401, ''))
        .mockResolvedValueOnce(makeResponse(401, ''));

      await fetchActiveIssuesByProject(1);

      expect(location.href).toBe('/login');
    });

    it('issues only one refresh request for concurrent 401s (mutex)', async () => {
      let resolveRefresh;
      const deferredRefresh = new Promise(res => { resolveRefresh = res; });

      fetch.mockImplementation((url) => {
        if (url.includes('/issues/active')) return Promise.resolve(makeResponse(401, ''));
        if (url.includes('/refresh')) return deferredRefresh.then(() => makeResponse(200, {}));
        return Promise.resolve(makeResponse(200, []));
      });

      const p1 = fetchActiveIssuesByProject(1);
      const p2 = fetchActiveIssuesByProject(2);

      await Promise.resolve(); // let both requests hit 401 and queue refresh
      await Promise.resolve();
      resolveRefresh();

      await Promise.all([p1, p2]);

      const refreshCalls = fetch.mock.calls.filter(([url]) => url.includes('/refresh'));
      expect(refreshCalls).toHaveLength(1);
    });
  });

  // --- Issue fetchers ---

  describe('fetchActiveIssuesByProject', () => {
    it('returns issues on success', async () => {
      const issues = [{ id: 1 }, { id: 2 }];
      fetch.mockResolvedValue(makeResponse(200, issues));
      expect(await fetchActiveIssuesByProject(42)).toEqual(issues);
      expect(fetch).toHaveBeenCalledWith('/api/projects/42/issues/active', {});
    });

    it('returns empty array on network error', async () => {
      fetch.mockRejectedValue(new Error('network'));
      expect(await fetchActiveIssuesByProject(1)).toEqual([]);
    });
  });

  describe('fetchArchivedIssuesByProject', () => {
    it('returns archived issues on success', async () => {
      const issues = [{ id: 3 }];
      fetch.mockResolvedValue(makeResponse(200, issues));
      expect(await fetchArchivedIssuesByProject(5)).toEqual(issues);
    });

    it('returns empty array on error', async () => {
      fetch.mockRejectedValue(new Error('fail'));
      expect(await fetchArchivedIssuesByProject(1)).toEqual([]);
    });
  });

  describe('fetchOpenIssuesByProject', () => {
    it('returns open issues on success', async () => {
      fetch.mockResolvedValue(makeResponse(200, [{ id: 7 }]));
      expect(await fetchOpenIssuesByProject(3)).toEqual([{ id: 7 }]);
    });
  });

  describe('fetchIssueById', () => {
    it('returns issue and etag on success', async () => {
      const issue = { id: 10, title: 'Bug' };
      fetch.mockResolvedValue(makeResponse(200, issue, { ETag: '"abc123"' }));
      const result = await fetchIssueById(1, 10);
      expect(result.issue).toEqual(issue);
      expect(result.etag).toBe('"abc123"');
    });

    it('returns null issue on 404', async () => {
      fetch.mockResolvedValue(makeResponse(404, ''));
      expect(await fetchIssueById(1, 99)).toEqual({ issue: null, etag: null });
    });

    it('returns null issue on non-ok response', async () => {
      fetch.mockResolvedValue(makeResponse(500, ''));
      expect(await fetchIssueById(1, 1)).toEqual({ issue: null, etag: null });
    });

    it('returns null issue on network error', async () => {
      fetch.mockRejectedValue(new Error('fail'));
      expect(await fetchIssueById(1, 1)).toEqual({ issue: null, etag: null });
    });
  });

  describe('createIssue', () => {
    it('posts issue and returns created data', async () => {
      const created = { id: 5, title: 'New' };
      fetch.mockResolvedValue(makeResponse(201, created));
      const result = await createIssue(1, { title: 'New' });
      expect(result).toEqual(created);
      expect(fetch.mock.calls[0][1].method).toBe('POST');
    });

    it('throws with server message on failure', async () => {
      fetch.mockResolvedValue(makeResponse(400, 'Title required'));
      await expect(createIssue(1, { title: '' })).rejects.toThrow('Title required');
    });
  });

  describe('updateIssue', () => {
    it('returns updated issue and etag on success', async () => {
      const updated = { id: 1, title: 'Updated' };
      fetch.mockResolvedValue(makeResponse(200, updated, { ETag: '"v2"' }));
      const result = await updateIssue(1, { id: 1, title: 'Updated' });
      expect(result).toEqual({ issue: updated, etag: '"v2"', conflict: false });
    });

    it('includes If-Match header when etag is provided', async () => {
      fetch.mockResolvedValue(makeResponse(200, { id: 1 }));
      await updateIssue(1, { id: 1 }, '"v1"');
      expect(fetch.mock.calls[0][1].headers['If-Match']).toBe('"v1"');
    });

    it('returns conflict flag on 409', async () => {
      fetch.mockResolvedValue(makeResponse(409, ''));
      const result = await updateIssue(1, { id: 1 });
      expect(result).toEqual({ issue: null, etag: null, conflict: true });
    });

    it('throws on other failures', async () => {
      fetch.mockResolvedValue(makeResponse(500, 'Internal error'));
      await expect(updateIssue(1, { id: 1 })).rejects.toThrow('Internal error');
    });
  });

  describe('archiveIssue', () => {
    it('posts to archive endpoint and returns data', async () => {
      fetch.mockResolvedValue(makeResponse(200, { id: 1, status: 'archived' }));
      const result = await archiveIssue(1, 1);
      expect(result).toEqual({ id: 1, status: 'archived' });
      expect(fetch.mock.calls[0][0]).toContain('/projects/1/issues/1/archive');
    });

    it('throws on failure', async () => {
      fetch.mockResolvedValue(makeResponse(403, 'Forbidden'));
      await expect(archiveIssue(1, 1)).rejects.toThrow('Forbidden');
    });
  });

  describe('unarchiveIssue', () => {
    it('posts to unarchive endpoint and returns data', async () => {
      fetch.mockResolvedValue(makeResponse(200, { id: 1 }));
      const result = await unarchiveIssue(1, 1);
      expect(result).toEqual({ id: 1 });
      expect(fetch.mock.calls[0][0]).toContain('/projects/1/issues/1/unarchive');
    });

    it('throws on failure', async () => {
      fetch.mockResolvedValue(makeResponse(500, 'error'));
      await expect(unarchiveIssue(1, 1)).rejects.toThrow();
    });
  });

  // --- Version ---

  describe('fetchVersion', () => {
    it('returns version string', async () => {
      fetch.mockResolvedValue(makeResponse(200, { version: '1.2.3' }));
      expect(await fetchVersion()).toBe('1.2.3');
    });

    it('returns Unknown on network error', async () => {
      fetch.mockRejectedValue(new Error('down'));
      expect(await fetchVersion()).toBe('Unknown');
    });

    it('returns Unknown when version field is missing', async () => {
      fetch.mockResolvedValue(makeResponse(200, {}));
      expect(await fetchVersion()).toBe('Unknown');
    });
  });

  // --- Auth ---

  describe('fetchCurrentUser', () => {
    it('returns user object on success', async () => {
      const user = { id: 1, name: 'Alice' };
      fetch.mockResolvedValue(makeResponse(200, user));
      expect(await fetchCurrentUser()).toEqual(user);
    });

    it('returns null on non-ok response', async () => {
      fetch.mockResolvedValue(makeResponse(401, ''));
      expect(await fetchCurrentUser()).toBeNull();
    });

    it('returns null on network error', async () => {
      fetch.mockRejectedValue(new Error('down'));
      expect(await fetchCurrentUser()).toBeNull();
    });
  });

  describe('logout', () => {
    it('calls logout endpoint and redirects to /login', async () => {
      fetch.mockResolvedValue(makeResponse(200, {}));
      await logout();
      expect(fetch).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }));
      expect(location.href).toBe('/login');
    });
  });

  // --- Projects ---

  describe('fetchProjects', () => {
    it('returns project list on success', async () => {
      fetch.mockResolvedValue(makeResponse(200, [{ id: 1 }]));
      expect(await fetchProjects()).toEqual([{ id: 1 }]);
    });

    it('returns empty array on error', async () => {
      fetch.mockRejectedValue(new Error('fail'));
      expect(await fetchProjects()).toEqual([]);
    });
  });

  describe('createProject', () => {
    it('posts project and returns created data', async () => {
      const proj = { id: 1, name: 'Alpha' };
      fetch.mockResolvedValue(makeResponse(201, proj));
      expect(await createProject({ name: 'Alpha' })).toEqual(proj);
    });

    it('throws with server message on failure', async () => {
      fetch.mockResolvedValue(makeResponse(400, 'Name taken'));
      await expect(createProject({ name: 'Alpha' })).rejects.toThrow('Name taken');
    });
  });

  describe('updateProject', () => {
    it('puts project and returns updated data', async () => {
      const proj = { id: 1, name: 'Beta' };
      fetch.mockResolvedValue(makeResponse(200, proj));
      expect(await updateProject(1, { name: 'Beta' })).toEqual(proj);
      expect(fetch.mock.calls[0][1].method).toBe('PUT');
    });
  });

  describe('deleteProject', () => {
    it('sends DELETE and resolves on success', async () => {
      fetch.mockResolvedValue(makeResponse(200, ''));
      await expect(deleteProject(1)).resolves.not.toThrow();
    });

    it('throws on failure', async () => {
      fetch.mockResolvedValue(makeResponse(403, 'No permission'));
      await expect(deleteProject(1)).rejects.toThrow('No permission');
    });
  });

  // --- Status config ---

  describe('fetchStatusConfig', () => {
    it('returns config on success', async () => {
      const config = { columns: [] };
      fetch.mockResolvedValue(makeResponse(200, config));
      expect(await fetchStatusConfig(1)).toEqual(config);
    });

    it('throws on failure', async () => {
      fetch.mockResolvedValue(makeResponse(404, 'Not found'));
      await expect(fetchStatusConfig(1)).rejects.toThrow('Not found');
    });
  });

  describe('updateStatusConfig', () => {
    it('puts config and returns updated data', async () => {
      const config = { columns: ['Todo', 'Done'] };
      fetch.mockResolvedValue(makeResponse(200, config));
      expect(await updateStatusConfig(1, config)).toEqual(config);
      expect(fetch.mock.calls[0][1].method).toBe('PUT');
    });
  });

  // --- Users ---

  describe('fetchUsers', () => {
    it('returns user list on success', async () => {
      const users = [{ id: 1 }, { id: 2 }];
      fetch.mockResolvedValue(makeResponse(200, users));
      expect(await fetchUsers()).toEqual(users);
    });

    it('throws on failure', async () => {
      fetch.mockResolvedValue(makeResponse(500, ''));
      await expect(fetchUsers()).rejects.toThrow('Failed to fetch users');
    });
  });

  describe('createUser', () => {
    it('posts user and returns created data', async () => {
      const user = { id: 3, name: 'Bob' };
      fetch.mockResolvedValue(makeResponse(201, user));
      expect(await createUser({ name: 'Bob' })).toEqual(user);
    });

    it('throws with server message on failure', async () => {
      fetch.mockResolvedValue(makeResponse(409, 'Email already in use'));
      await expect(createUser({ name: 'Bob' })).rejects.toThrow('Email already in use');
    });
  });

  describe('updateUser', () => {
    it('puts user and returns updated data', async () => {
      const user = { id: 1, name: 'Alice Updated' };
      fetch.mockResolvedValue(makeResponse(200, user));
      expect(await updateUser(1, { name: 'Alice Updated' })).toEqual(user);
      expect(fetch.mock.calls[0][1].method).toBe('PUT');
    });
  });

  // --- Releases ---

  describe('fetchReleases', () => {
    it('returns releases on success', async () => {
      const releases = [{ id: 1, name: 'v1.0' }];
      fetch.mockResolvedValue(makeResponse(200, releases));
      expect(await fetchReleases(1)).toEqual(releases);
      expect(fetch).toHaveBeenCalledWith('/api/projects/1/releases', {});
    });

    it('throws with server message on failure', async () => {
      fetch.mockResolvedValue(makeResponse(404, 'Not found'));
      await expect(fetchReleases(1)).rejects.toThrow('Not found');
    });
  });

  describe('createRelease', () => {
    it('posts release and returns created data', async () => {
      const release = { id: 1, name: 'v1.0' };
      fetch.mockResolvedValue(makeResponse(201, release));
      const result = await createRelease(1, { name: 'v1.0' });
      expect(result).toEqual(release);
      expect(fetch.mock.calls[0][1].method).toBe('POST');
      expect(fetch.mock.calls[0][0]).toContain('/projects/1/releases');
    });

    it('throws with server message on failure', async () => {
      fetch.mockResolvedValue(makeResponse(400, 'Name required'));
      await expect(createRelease(1, {})).rejects.toThrow('Name required');
    });
  });

  describe('updateRelease', () => {
    it('puts release and returns updated data', async () => {
      const release = { id: 1, name: 'v1.1' };
      fetch.mockResolvedValue(makeResponse(200, release));
      const result = await updateRelease(1, 1, { name: 'v1.1' });
      expect(result).toEqual(release);
      expect(fetch.mock.calls[0][1].method).toBe('PUT');
      expect(fetch.mock.calls[0][0]).toContain('/releases/1');
    });

    it('throws with server message on failure', async () => {
      fetch.mockResolvedValue(makeResponse(500, 'Internal error'));
      await expect(updateRelease(1, 1, {})).rejects.toThrow('Internal error');
    });
  });

  describe('deleteRelease', () => {
    it('sends DELETE and resolves on success', async () => {
      fetch.mockResolvedValue(makeResponse(200, ''));
      await expect(deleteRelease(1, 1)).resolves.not.toThrow();
      expect(fetch.mock.calls[0][1].method).toBe('DELETE');
    });

    it('throws with server message on failure', async () => {
      fetch.mockResolvedValue(makeResponse(403, 'No permission'));
      await expect(deleteRelease(1, 1)).rejects.toThrow('No permission');
    });
  });

  describe('reopenRelease', () => {
    it('posts to reopen endpoint and returns data', async () => {
      const release = { id: 1, status: 'open' };
      fetch.mockResolvedValue(makeResponse(200, release));
      const result = await reopenRelease(1, 1);
      expect(result).toEqual(release);
      expect(fetch.mock.calls[0][0]).toContain('/releases/1/reopen');
    });

    it('throws with server message on failure', async () => {
      fetch.mockResolvedValue(makeResponse(400, 'Cannot reopen'));
      await expect(reopenRelease(1, 1)).rejects.toThrow('Cannot reopen');
    });
  });

  describe('triggerRelease', () => {
    it('posts to release endpoint and returns data', async () => {
      const release = { id: 1, status: 'closed' };
      fetch.mockResolvedValue(makeResponse(200, release));
      const result = await triggerRelease(1, 1, true);
      expect(result).toEqual(release);
      expect(fetch.mock.calls[0][0]).toContain('/releases/1/release');
      expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ archive_done: true });
    });

    it('throws with server message on failure', async () => {
      fetch.mockResolvedValue(makeResponse(500, 'Failed to trigger release'));
      await expect(triggerRelease(1, 1, false)).rejects.toThrow('Failed to trigger release');
    });
  });
});
