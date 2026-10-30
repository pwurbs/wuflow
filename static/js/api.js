import { singleFlight } from './utils.js';

const API_URL = '/api';

// Client-side request timeout. Longer than the server's 15 s write timeout so a slow
// but successful request is not aborted on the client while the server completes it.
const REQUEST_TIMEOUT_MS = 20000;

// Gateway errors from a reverse proxy mean the request never reached the app (or its
// outcome is unknown), so they are treated like a lost connection.
const GATEWAY_ERROR_STATUSES = new Set([502, 503, 504]);

/**
 * Raised when the server could not be reached (offline, DNS, timeout, gateway error).
 * The message is shown as-is in error toasts.
 */
export class NetworkError extends Error {
  constructor(message = 'Connection to the server failed. The change was not saved.') {
    super(message);
    this.name = 'NetworkError';
  }
}

let sessionExpiredHandler = null;
let connectionListener = null;

/**
 * Registers the handler called when the session can no longer be refreshed.
 * It must return a promise that resolves once the user is logged in again;
 * the failed request is then replayed. Without a handler the app redirects to /login.
 */
export function setSessionExpiredHandler(handler) {
  sessionExpiredHandler = handler;
}

/**
 * Registers a listener called with true/false whenever a request reached / failed to
 * reach the server, so the UI can show or hide a connection banner.
 */
export function setConnectionListener(listener) {
  connectionListener = listener;
}

function notifyConnection(ok) {
  connectionListener?.(ok);
}

/**
 * Plain fetch with timeout and network-error mapping, without any auth handling.
 * timeoutMs = 0 disables the timeout.
 */
async function rawFetch(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = timeoutMs ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, controller ? { ...options, signal: controller.signal } : options);
    if (GATEWAY_ERROR_STATUSES.has(res.status)) {
      notifyConnection(false);
      throw new NetworkError();
    }
    notifyConnection(true);
    return res;
  } catch (err) {
    if (err instanceof NetworkError) throw err;
    notifyConnection(false);
    throw new NetworkError();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Refreshes the session, or — if the refresh token is no longer valid — waits until the
 * user has logged in again via the session-expired handler.
 * Returns true when the original request can be replayed, false after a redirect.
 * Throws NetworkError if the refresh request itself could not reach the server.
 */
async function renewSession() {
  // No timeout: aborting a refresh the server already processed would leave the browser
  // with a rotated-away refresh token.
  const res = await rawFetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  }, 0);
  if (res.ok) return true;
  if (sessionExpiredHandler) {
    await sessionExpiredHandler();
    return true;
  }
  globalThis.location.href = '/login';
  return false;
}

const renewSessionOnce = singleFlight(renewSession);

/**
 * Auth-aware fetch wrapper.
 * - Network failures throw NetworkError; GET requests are retried once first.
 *   Other methods are never retried automatically, as their outcome is unknown.
 * - On 401: refreshes the session (or re-authenticates the user) and replays the
 *   request once. The replay is safe because a 401 request was never executed.
 * All concurrent 401s share one renewal (Token Reuse Protection).
 */
async function authFetch(url, options = {}) {
  const isRead = (options.method ?? 'GET').toUpperCase() === 'GET';
  let res;
  try {
    res = await rawFetch(url, options);
  } catch (err) {
    if (!isRead || !(err instanceof NetworkError)) throw err;
    res = await rawFetch(url, options);
  }

  if (res.status === 401) {
    if (await renewSessionOnce()) {
      res = await rawFetch(url, options);
    }
  }

  if (res.status === 429) {
    // Return a synthetic response so every caller's error path shows a clear message.
    return new Response('Too many requests. Please slow down and try again.', {
      status: 429,
      statusText: 'Too Many Requests',
    });
  }

  return res;
}

/**
 * Checks whether the current access cookie is valid, without refreshing or
 * re-authenticating. Used to detect a login made in another tab.
 */
export async function hasValidSession() {
  try {
    const res = await rawFetch(`${API_URL}/auth/me`);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Logs in again with the given credentials (used by the re-login dialog).
 * Returns null on success, otherwise a user-facing error message.
 */
export async function reauthenticate(email, password) {
  try {
    const res = await rawFetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (res.ok) return null;
    if (res.status === 429) return 'Too many login attempts. Please wait a moment and try again.';
    return (await res.text()) || 'Login failed. Please try again.';
  } catch (err) {
    return err.message;
  }
}

export async function fetchActiveIssuesByProject(projectId) {
  try {
    const res = await authFetch(`${API_URL}/projects/${projectId}/issues/active`);
    const data = await res.json();
    return data || [];
  } catch {
    return [];
  }
}

export async function fetchArchivedIssuesByProject(projectId) {
  try {
    const res = await authFetch(`${API_URL}/projects/${projectId}/issues/archived`);
    const data = await res.json();
    return data || [];
  } catch {
    return [];
  }
}

export async function fetchOpenIssuesByProject(projectId) {
  try {
    const res = await authFetch(`${API_URL}/projects/${projectId}/issues/open`);
    const data = await res.json();
    return data || [];
  } catch {
    return [];
  }
}

/**
 * Fetch a single issue by ID. Returns { issue, etag } or { issue: null } if not found.
 */
export async function fetchIssueById(projectId, id) {
  try {
    const res = await authFetch(`${API_URL}/projects/${projectId}/issues/${id}`);
    if (res.status === 404) {
      return { issue: null, etag: null };
    }
    if (!res.ok) {
      throw new Error(`Failed to fetch issue ${id}`);
    }
    const issue = await res.json();
    const etag = res.headers.get('ETag');
    return { issue, etag };
  } catch {
    return { issue: null, etag: null };
  }
}

export async function createIssue(projectId, issue) {
  const res = await authFetch(`${API_URL}/projects/${projectId}/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(issue)
  });
  if (!res.ok) throw new Error(await res.text() || 'Failed to create issue');
  return res.json();
}

/**
 * Update an issue. If etag is provided, uses If-Match header for conflict detection.
 * Returns { issue, etag, conflict } where conflict is true if 409 was returned.
 */
export async function updateIssue(projectId, issue, etag = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (etag) {
    headers['If-Match'] = etag;
  }

  const res = await authFetch(`${API_URL}/projects/${projectId}/issues/${issue.id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(issue)
  });

  if (res.status === 409) {
    return { issue: null, etag: null, conflict: true };
  }

  if (!res.ok) throw new Error(await res.text() || 'Failed to update issue');

  const updatedIssue = await res.json();
  const newEtag = res.headers.get('ETag');
  return { issue: updatedIssue, etag: newEtag, conflict: false };
}

/**
 * Save a reorder in one request. positions: [{ id, position }, ...].
 * Only positions change; the server applies all of them or none.
 */
export async function updateIssuePositions(projectId, positions) {
  await putPositions(`${API_URL}/projects/${projectId}/issues/positions`, positions, 'Failed to save the new order');
}

async function putPositions(url, positions, errorMessage) {
  const res = await authFetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(positions)
  });
  if (!res.ok) throw new Error(await res.text() || errorMessage);
}

export async function archiveIssue(projectId, id) {
  const res = await authFetch(`${API_URL}/projects/${projectId}/issues/${id}/archive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  if (!res.ok) throw new Error(await res.text() || 'Failed to archive issue');
  return await res.json();
}

export async function unarchiveIssue(projectId, id) {
  const res = await authFetch(`${API_URL}/projects/${projectId}/issues/${id}/unarchive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  if (!res.ok) throw new Error(await res.text() || 'Failed to unarchive issue');
  return await res.json();
}

export async function moveIssue(currentProjectId, issueId, newProjectId, adminPassword) {
  const res = await authFetch(`${API_URL}/projects/${currentProjectId}/issues/${issueId}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_project_id: newProjectId, admin_password: adminPassword })
  });
  if (!res.ok) throw new Error(await res.text() || 'Failed to move issue');
  const issue = await res.json();
  const etag = res.headers.get('ETag');
  return { issue, etag };
}

export async function createTask(projectId, issueId, task) {
  const res = await authFetch(`${API_URL}/projects/${projectId}/issues/${issueId}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(task)
  });
  if (!res.ok) throw new Error(await res.text() || 'Failed to create task');
  return res.json();
}

export async function updateTask(projectId, issueId, task) {
  const res = await authFetch(`${API_URL}/projects/${projectId}/issues/${issueId}/tasks/${task.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(task)
  });
  if (!res.ok) throw new Error(await res.text() || 'Failed to update task');
  return res.json();
}

/**
 * Save a task reorder in one request. positions: [{ id, position }, ...].
 */
export async function updateTaskPositions(projectId, issueId, positions) {
  await putPositions(`${API_URL}/projects/${projectId}/issues/${issueId}/tasks/positions`, positions, 'Failed to save the task order');
}

export async function deleteTask(projectId, issueId, taskId) {
  const res = await authFetch(`${API_URL}/projects/${projectId}/issues/${issueId}/tasks/${taskId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await res.text() || 'Failed to delete task');
}

export async function deleteIssue(projectId, id, adminPassword) {
  const res = await authFetch(`${API_URL}/projects/${projectId}/issues/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ admin_password: adminPassword })
  });
  if (!res.ok) throw new Error(await res.text() || 'Failed to delete issue');
}

// --- Issue activity: history (audit trail) + comments ---------------------

export async function fetchHistory(projectId, issueId) {
  const res = await authFetch(`${API_URL}/projects/${projectId}/issues/${issueId}/history`);
  if (!res.ok) throw new Error(await res.text() || 'Failed to fetch history');
  return res.json();
}

export async function fetchComments(projectId, issueId) {
  const res = await authFetch(`${API_URL}/projects/${projectId}/issues/${issueId}/comments`);
  if (!res.ok) throw new Error(await res.text() || 'Failed to fetch comments');
  return res.json();
}

export async function createComment(projectId, issueId, body) {
  const res = await authFetch(`${API_URL}/projects/${projectId}/issues/${issueId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body })
  });
  if (!res.ok) throw new Error(await res.text() || 'Failed to add comment');
  return res.json();
}

export async function updateComment(projectId, issueId, commentId, body) {
  const res = await authFetch(`${API_URL}/projects/${projectId}/issues/${issueId}/comments/${commentId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body })
  });
  if (!res.ok) throw new Error(await res.text() || 'Failed to update comment');
  return res.json();
}

export async function deleteComment(projectId, issueId, commentId) {
  const res = await authFetch(`${API_URL}/projects/${projectId}/issues/${issueId}/comments/${commentId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await res.text() || 'Failed to delete comment');
}

export async function fetchLabelsByProject(projectId) {
  const response = await authFetch(`${API_URL}/projects/${projectId}/labels`);
  if (!response.ok) throw new Error(await response.text() || 'Failed to fetch labels');
  return await response.json();
}

export async function createLabel(projectId, label) {
  const response = await authFetch(`${API_URL}/projects/${projectId}/labels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(label),
  });
  if (!response.ok) throw new Error(await response.text() || 'Failed to create label');
  return await response.json();
}

export async function deleteLabel(projectId, labelId, adminPassword) {
  const response = await authFetch(`${API_URL}/projects/${projectId}/labels/${labelId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ admin_password: adminPassword })
  });
  if (!response.ok) throw new Error(await response.text() || 'Failed to delete label');
}

export async function fetchVersion() {
  try {
    const res = await authFetch(`${API_URL}/version`);
    const data = await res.json();
    return data.version || 'Unknown';
  } catch (err) {
    console.warn('Failed to fetch version:', err);
    return 'Unknown';
  }
}

// --- User Management API functions ---

export async function fetchUsers() {
  const res = await authFetch(`${API_URL}/users`);
  if (!res.ok) {
    throw new Error('Failed to fetch users');
  }
  return await res.json();
}

export async function createUser(user) {
  const res = await authFetch(`${API_URL}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(user),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to create user');
  }
  return await res.json();
}

export async function updateUser(id, user) {
  const res = await authFetch(`${API_URL}/users/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(user),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to update user');
  }
  return await res.json();
}

export async function deleteUser(id, adminPassword) {
  const res = await authFetch(`${API_URL}/users/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ admin_password: adminPassword })
  });
  if (!res.ok) throw new Error(await res.text() || 'Failed to delete user');
}

// --- Auth API functions ---

/**
 * Fetch the current authenticated user.
 * Returns the user object or null if not authenticated.
 */
export async function fetchCurrentUser() {
  try {
    const res = await authFetch(`${API_URL}/auth/me`);
    if (!res.ok) {
      return null;
    }
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Log out the current user by clearing auth cookies.
 */
export async function logout() {
  try {
    await fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
  } catch (err) {
    // Still leave the app: the server-side session expires on its own.
    console.warn('Logout request failed:', err);
  } finally {
    globalThis.location.href = '/login';
  }
}

export async function updateCurrentUser(data) {
  const res = await authFetch(`${API_URL}/auth/me`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to update user');
  }
  return await res.json();
}

// --- Project API functions ---

export async function fetchProjects() {
  try {
    const res = await authFetch(`${API_URL}/projects`);
    const data = await res.json();
    return data || [];
  } catch {
    return [];
  }
}

export async function createProject(project) {
  const res = await authFetch(`${API_URL}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(project)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to create project');
  }
  return await res.json();
}

export async function updateProject(id, project) {
  const res = await authFetch(`${API_URL}/projects/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(project)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to update project');
  }
  return await res.json();
}

export async function deleteProject(id, adminPassword) {
  const res = await authFetch(`${API_URL}/projects/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ admin_password: adminPassword })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to delete project');
  }
}

export async function fetchStatusConfig(projectId) {
  const res = await authFetch(`${API_URL}/projects/${projectId}/statusconfig`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to fetch status config');
  }
  return await res.json();
}

export async function updateStatusConfig(projectId, config) {
  const res = await authFetch(`${API_URL}/projects/${projectId}/statusconfig`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to update status config');
  }
  return await res.json();
}

export async function fetchReleases(projectId) {
  const res = await authFetch(`${API_URL}/projects/${projectId}/releases`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to fetch releases');
  }
  return await res.json();
}

export async function createRelease(projectId, data) {
  const res = await authFetch(`${API_URL}/projects/${projectId}/releases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to create release');
  }
  return await res.json();
}

export async function updateRelease(projectId, id, data) {
  const res = await authFetch(`${API_URL}/projects/${projectId}/releases/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to update release');
  }
  return await res.json();
}

export async function deleteRelease(projectId, id, adminPassword) {
  const res = await authFetch(`${API_URL}/projects/${projectId}/releases/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ admin_password: adminPassword })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to delete release');
  }
}

export async function reopenRelease(projectId, id) {
  const res = await authFetch(`${API_URL}/projects/${projectId}/releases/${id}/reopen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to reopen release');
  }
  return await res.json();
}

export async function triggerRelease(projectId, id, archiveDone) {
  const res = await authFetch(`${API_URL}/projects/${projectId}/releases/${id}/release`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ archive_done: archiveDone })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to trigger release');
  }
  return await res.json();
}


