const API_URL = '/api';

/**
 * Auth-aware fetch wrapper.
 * On 401: attempts to refresh the access token and retries the request once.
 * If refresh also fails: redirects to /login.
 */
let isRefreshing = false;
let refreshPromise = null;

/**
 * Auth-aware fetch wrapper.
 * On 401: attempts to refresh the access token and retries the request once.
 * If refresh also fails: redirects to /login.
 * Implements a mutex to prevent multiple concurrent refresh calls (Token Reuse Protection).
 */
async function authFetch(url, options = {}) {
  let res = await fetch(url, options);

  if (res.status === 429) {
    // Return a synthetic response so every caller's error path shows a clear message.
    return new Response('Too many requests. Please slow down and try again.', {
      status: 429,
      statusText: 'Too Many Requests',
    });
  }

  if (res.status === 401) {
    if (!isRefreshing) {
      isRefreshing = true;
      refreshPromise = fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      })
        .then(r => {
          if (!r.ok) throw new Error('Refresh failed');
          return true;
        })
        .catch(err => {
          // If refresh fails, redirect to login
          globalThis.location.href = '/login';
          throw err;
        })
        .finally(() => {
          isRefreshing = false;
          refreshPromise = null;
        });
    }

    try {
      // Wait for the ongoing refresh to complete
      await refreshPromise;
      // Retry original request with fresh token (cookies are handled by browser)
      res = await fetch(url, options);
    } catch {
      // If refresh failed, return the original 401 response (or we already redirected)
      return res;
    }
  }

  return res;
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

export async function moveIssue(currentProjectId, issueId, newProjectId) {
  const res = await authFetch(`${API_URL}/projects/${currentProjectId}/issues/${issueId}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_project_id: newProjectId })
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

export async function deleteTask(projectId, issueId, taskId) {
  const res = await authFetch(`${API_URL}/projects/${projectId}/issues/${issueId}/tasks/${taskId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await res.text() || 'Failed to delete task');
}

export async function deleteIssue(projectId, id) {
  const res = await authFetch(`${API_URL}/projects/${projectId}/issues/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await res.text() || 'Failed to delete issue');
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

export async function deleteLabel(projectId, labelId) {
  const response = await authFetch(`${API_URL}/projects/${projectId}/labels/${labelId}`, {
    method: 'DELETE',
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
  await fetch(`${API_URL}/auth/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  globalThis.location.href = '/login';
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

export async function deleteProject(id) {
  const res = await authFetch(`${API_URL}/projects/${id}`, {
    method: 'DELETE'
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

export async function deleteRelease(projectId, id) {
  const res = await authFetch(`${API_URL}/projects/${projectId}/releases/${id}`, {
    method: 'DELETE'
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


