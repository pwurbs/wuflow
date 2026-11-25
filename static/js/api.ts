import { singleFlight, errorMessage } from './utils.ts';
import type { CalendarDate, Comment, HistoryEntry, Issue, Label, MyIssue, PositionUpdate, Project, Release, StatusConfig, Task, User } from './models.ts';
import type { IssueStatus } from './status-config.ts';
import type { Priority } from './domain-constants.ts';

// Request bodies (the *Request schemas in docs/swagger.json).
export interface IssueWrite {
  title: string;
  description: string;
  status: IssueStatus;
  priority: Priority;
  position: number;
  deadline: CalendarDate | null;
  planned_dates: CalendarDate[] | null;
  assignee_id: number | null;
  label: Pick<Label, 'id'> | null;
  release_id: number | null;
}

export interface TaskWrite {
  title: string;
  done?: boolean;
  deadline: CalendarDate | null;
  position: number;
}

export type UserWrite = Pick<User, 'email' | 'first_name' | 'last_name' | 'role' | 'active'> & {
  password?: string;
  admin_password?: string;
};

export type ReleaseWrite = Pick<Release, 'name' | 'description' | 'start_date' | 'release_date' | 'owner_id'>;

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
  constructor(message = 'Connection to the server failed.') {
    super(message);
    this.name = 'NetworkError';
  }
}

let sessionExpiredHandler: (() => Promise<void>) | null = null;
let connectionListener: ((ok: boolean) => void) | null = null;

/**
 * Registers the handler called when the session can no longer be refreshed.
 * It must return a promise that resolves once the user is logged in again;
 * the failed request is then replayed. Without a handler the app redirects to /login.
 */
export function setSessionExpiredHandler(handler: (() => Promise<void>) | null) {
  sessionExpiredHandler = handler;
}

/**
 * Registers a listener called with true/false whenever a request reached / failed to
 * reach the server, so the UI can show or hide a connection banner.
 */
export function setConnectionListener(listener: ((ok: boolean) => void) | null) {
  connectionListener = listener;
}

function notifyConnection(ok: boolean) {
  connectionListener?.(ok);
}

/**
 * Plain fetch with timeout and network-error mapping, without any auth handling.
 * timeoutMs = 0 disables the timeout.
 */
async function rawFetch(url: string, options: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = timeoutMs ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
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
async function renewSession(): Promise<boolean> {
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
 *   Other methods are never retried automatically, as their outcome is unknown. Their
 *   error says that the change was not saved.
 * - On 401: refreshes the session (or re-authenticates the user) and replays the
 *   request once. The replay is safe because a 401 request was never executed.
 * All concurrent 401s share one renewal (Token Reuse Protection).
 */
async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  if ((options.method ?? 'GET').toUpperCase() === 'GET') return sendWithSession(url, options, true);
  try {
    return await sendWithSession(url, options, false);
  } catch (err) {
    if (err instanceof NetworkError) throw new NetworkError(`${err.message} The change was not saved.`);
    throw err;
  }
}

async function sendWithSession(url: string, options: RequestInit, isRead: boolean): Promise<Response> {
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
export async function hasValidSession(): Promise<boolean> {
  try {
    const res = await rawFetch(`${API_URL}/auth/me`);
    return res.ok;
  } catch {
    // Only decides whether the re-login dialog may close: without an answer it stays open.
    return false;
  }
}

/**
 * Logs in again with the given credentials (used by the re-login dialog).
 * Returns null on success, otherwise a user-facing error message.
 */
export async function reauthenticate(email: string, password: string): Promise<string | null> {
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
    return errorMessage(err);
  }
}

async function fetchIssueList(projectId: number, list: 'active' | 'open' | 'archived'): Promise<Issue[]> {
  const res = await authFetch(`${API_URL}/projects/${projectId}/issues/${list}`);
  if (!res.ok) throw new Error(await res.text() || `Failed to fetch ${list} issues`);
  return await res.json() || []; // the backend sends null for an empty list
}

export function fetchActiveIssuesByProject(projectId: number): Promise<Issue[]> {
  return fetchIssueList(projectId, 'active');
}

export function fetchArchivedIssuesByProject(projectId: number): Promise<Issue[]> {
  return fetchIssueList(projectId, 'archived');
}

export function fetchOpenIssuesByProject(projectId: number): Promise<Issue[]> {
  return fetchIssueList(projectId, 'open');
}

/**
 * Fetch a single issue by ID. Returns { issue, etag }, or { issue: null } if it does not exist.
 */
export async function fetchIssueById(projectId: number, id: number): Promise<{ issue: Issue | null, etag: string | null }> {
  const res = await authFetch(`${API_URL}/projects/${projectId}/issues/${id}`);
  if (res.status === 404) return { issue: null, etag: null };
  if (!res.ok) throw new Error(await res.text() || `Failed to fetch issue ${id}`);
  const issue = await res.json();
  const etag = res.headers.get('ETag');
  return { issue, etag };
}

export async function createIssue(projectId: number, issue: IssueWrite): Promise<Issue> {
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
export async function updateIssue(projectId: number, issue: IssueWrite & { id: number }, etag: string | null = null): Promise<{ issue: Issue | null, etag: string | null, conflict: boolean }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
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
export async function updateIssuePositions(projectId: number, positions: PositionUpdate[]): Promise<void> {
  await putPositions(`${API_URL}/projects/${projectId}/issues/positions`, positions, 'Failed to save the new order');
}

async function putPositions(url: string, positions: PositionUpdate[], failMessage: string): Promise<void> {
  const res = await authFetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(positions)
  });
  if (!res.ok) throw new Error(await res.text() || failMessage);
}

export async function archiveIssue(projectId: number, id: number): Promise<Issue> {
  const res = await authFetch(`${API_URL}/projects/${projectId}/issues/${id}/archive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  if (!res.ok) throw new Error(await res.text() || 'Failed to archive issue');
  return await res.json();
}

export async function unarchiveIssue(projectId: number, id: number): Promise<Issue> {
  const res = await authFetch(`${API_URL}/projects/${projectId}/issues/${id}/unarchive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  if (!res.ok) throw new Error(await res.text() || 'Failed to unarchive issue');
  return await res.json();
}

export async function moveIssue(currentProjectId: number, issueId: number, newProjectId: number, adminPassword: string): Promise<{ issue: Issue, etag: string | null }> {
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

export async function createTask(projectId: number, issueId: number, task: TaskWrite): Promise<Task> {
  const res = await authFetch(`${API_URL}/projects/${projectId}/issues/${issueId}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(task)
  });
  if (!res.ok) throw new Error(await res.text() || 'Failed to create task');
  return res.json();
}

export async function updateTask(projectId: number, issueId: number, task: TaskWrite & { id: number }): Promise<Task> {
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
export async function updateTaskPositions(projectId: number, issueId: number, positions: PositionUpdate[]): Promise<void> {
  await putPositions(`${API_URL}/projects/${projectId}/issues/${issueId}/tasks/positions`, positions, 'Failed to save the task order');
}

export async function deleteTask(projectId: number, issueId: number, taskId: number): Promise<void> {
  const res = await authFetch(`${API_URL}/projects/${projectId}/issues/${issueId}/tasks/${taskId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await res.text() || 'Failed to delete task');
}

export async function deleteIssue(projectId: number, id: number, adminPassword: string): Promise<void> {
  const res = await authFetch(`${API_URL}/projects/${projectId}/issues/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ admin_password: adminPassword })
  });
  if (!res.ok) throw new Error(await res.text() || 'Failed to delete issue');
}

// --- Issue activity: history (audit trail) + comments ---------------------

export async function fetchHistory(projectId: number, issueId: number): Promise<HistoryEntry[]> {
  const res = await authFetch(`${API_URL}/projects/${projectId}/issues/${issueId}/history`);
  if (!res.ok) throw new Error(await res.text() || 'Failed to fetch history');
  return res.json();
}

export async function fetchComments(projectId: number, issueId: number): Promise<Comment[]> {
  const res = await authFetch(`${API_URL}/projects/${projectId}/issues/${issueId}/comments`);
  if (!res.ok) throw new Error(await res.text() || 'Failed to fetch comments');
  return res.json();
}

export async function createComment(projectId: number, issueId: number, body: string): Promise<Comment> {
  const res = await authFetch(`${API_URL}/projects/${projectId}/issues/${issueId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body })
  });
  if (!res.ok) throw new Error(await res.text() || 'Failed to add comment');
  return res.json();
}

export async function updateComment(projectId: number, issueId: number, commentId: number, body: string): Promise<Comment> {
  const res = await authFetch(`${API_URL}/projects/${projectId}/issues/${issueId}/comments/${commentId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body })
  });
  if (!res.ok) throw new Error(await res.text() || 'Failed to update comment');
  return res.json();
}

export async function deleteComment(projectId: number, issueId: number, commentId: number): Promise<void> {
  const res = await authFetch(`${API_URL}/projects/${projectId}/issues/${issueId}/comments/${commentId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await res.text() || 'Failed to delete comment');
}

export async function fetchLabelsByProject(projectId: number): Promise<Label[]> {
  const response = await authFetch(`${API_URL}/projects/${projectId}/labels`);
  if (!response.ok) throw new Error(await response.text() || 'Failed to fetch labels');
  return await response.json();
}

export async function createLabel(projectId: number, label: Pick<Label, 'name' | 'color'>): Promise<Label> {
  const response = await authFetch(`${API_URL}/projects/${projectId}/labels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(label),
  });
  if (!response.ok) throw new Error(await response.text() || 'Failed to create label');
  return await response.json();
}

export async function deleteLabel(projectId: number, labelId: number, adminPassword: string): Promise<void> {
  const response = await authFetch(`${API_URL}/projects/${projectId}/labels/${labelId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ admin_password: adminPassword })
  });
  if (!response.ok) throw new Error(await response.text() || 'Failed to delete label');
}

export async function fetchVersion(): Promise<string> {
  try {
    const res = await authFetch(`${API_URL}/version`);
    const data = await res.json();
    return data.version || 'Unknown';
  } catch {
    // Shown only as information, nothing depends on it.
    return 'Unknown';
  }
}

// --- User Management API functions ---

export async function fetchUsers(): Promise<User[]> {
  const res = await authFetch(`${API_URL}/users`);
  if (!res.ok) {
    throw new Error('Failed to fetch users');
  }
  return await res.json();
}

export async function createUser(user: UserWrite): Promise<User> {
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

export async function updateUser(id: number, user: UserWrite): Promise<User> {
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

export async function deleteUser(id: number, adminPassword: string): Promise<void> {
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
 * Returns the user object, or null if not authenticated (401) or deleted meanwhile (404).
 */
export async function fetchCurrentUser(): Promise<User | null> {
  const res = await authFetch(`${API_URL}/auth/me`);
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) throw new Error(await res.text() || 'Failed to fetch the current user');
  return await res.json();
}

/**
 * Log out the current user by clearing auth cookies.
 */
export async function logout(): Promise<void> {
  try {
    await fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
  } catch {
    // Still leave the app: the server-side session expires on its own.
  } finally {
    globalThis.location.href = '/login';
  }
}

export async function updateCurrentUser(data: { password: string, current_password: string }): Promise<User> {
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

export async function fetchProjects(): Promise<Project[]> {
  const res = await authFetch(`${API_URL}/projects`);
  if (!res.ok) throw new Error(await res.text() || 'Failed to fetch projects');
  return await res.json() || [];
}

export async function createProject(project: Omit<Project, 'id'>): Promise<Project> {
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

export async function updateProject(id: number, project: Omit<Project, 'id'>): Promise<Project> {
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

export async function deleteProject(id: number, adminPassword: string): Promise<void> {
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

export async function fetchStatusConfig(projectId: number): Promise<StatusConfig> {
  const res = await authFetch(`${API_URL}/projects/${projectId}/statusconfig`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to fetch status config');
  }
  return await res.json();
}

export async function updateStatusConfig(projectId: number, config: Partial<Omit<StatusConfig, 'project_id'>>): Promise<StatusConfig> {
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

// The active issues assigned to the current user across all projects (My Work).
export async function fetchMyIssues(): Promise<MyIssue[]> {
  const res = await authFetch(`${API_URL}/me/issues`);
  if (!res.ok) throw new Error(await res.text() || 'Failed to load your issues');
  return await res.json();
}

export async function fetchReleases(projectId: number): Promise<Release[]> {
  const res = await authFetch(`${API_URL}/projects/${projectId}/releases`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to fetch releases');
  }
  return await res.json();
}

export async function createRelease(projectId: number, data: ReleaseWrite): Promise<Release> {
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

export async function updateRelease(projectId: number, id: number, data: ReleaseWrite): Promise<Release> {
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

export async function deleteRelease(projectId: number, id: number, adminPassword: string): Promise<void> {
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

export async function reopenRelease(projectId: number, id: number): Promise<Release> {
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

export async function triggerRelease(projectId: number, id: number, archiveDone: boolean): Promise<Release> {
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


