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

  if (res.status === 401) {
    if (!isRefreshing) {
      isRefreshing = true;
      refreshPromise = fetch(`${API_URL}/auth/refresh`, { method: 'POST' })
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

export async function fetchActiveIssues() {
  try {
    const res = await authFetch(`${API_URL}/issues/active`);
    const data = await res.json();
    return data || [];
  } catch {
    // Failed to fetch issues, return empty list to prevent crash
    return [];
  }
}

export async function fetchArchivedIssues() {
  try {
    const res = await authFetch(`${API_URL}/issues/archived`);
    const data = await res.json();
    return data || [];
  } catch {
    // Failed to fetch archived issues, return empty list to prevent crash
    return [];
  }
}

/**
 * Fetch a single issue by ID. Returns { issue, etag } or { issue: null } if not found.
 */
export async function fetchIssueById(id) {
  try {
    const res = await authFetch(`${API_URL}/issues/${id}`);
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

export async function createIssue(issue) {
  const res = await authFetch(`${API_URL}/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(issue)
  });
  return res.json();
}

/**
 * Update an issue. If etag is provided, uses If-Match header for conflict detection.
 * Returns { issue, etag, conflict } where conflict is true if 409 was returned.
 */
export async function updateIssue(issue, etag = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (etag) {
    headers['If-Match'] = etag;
  }

  const res = await authFetch(`${API_URL}/issues/${issue.id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(issue)
  });

  if (res.status === 409) {
    return { issue: null, etag: null, conflict: true };
  }

  const updatedIssue = await res.json();
  const newEtag = res.headers.get('ETag');
  return { issue: updatedIssue, etag: newEtag, conflict: false };
}

export async function archiveIssue(id) {
  const res = await authFetch(`${API_URL}/issues/${id}/archive`, { method: 'POST' });
  return await res.json();
}

export async function unarchiveIssue(id) {
  const res = await authFetch(`${API_URL}/issues/${id}/unarchive`, { method: 'POST' });
  return await res.json();
}

export async function createTask(task) {
  const res = await authFetch(`${API_URL}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(task)
  });
  return res.json();
}

export async function updateTask(task) {
  const res = await authFetch(`${API_URL}/tasks/${task.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(task)
  });
  return res.json();
}

export async function deleteTask(id) {
  await authFetch(`${API_URL}/tasks/${id}`, { method: 'DELETE' });
}

export async function deleteIssue(id) {
  await authFetch(`${API_URL}/issues/${id}`, { method: 'DELETE' });
}

export async function fetchLabels() {
  const response = await authFetch(`${API_URL}/labels`);
  if (!response.ok) {
    throw new Error('Failed to fetch labels');
  }
  return await response.json();
}

export async function createLabel(label) {
  const response = await authFetch(`${API_URL}/labels`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(label),
  });
  if (!response.ok) {
    throw new Error('Failed to create label');
  }
  return await response.json();
}

export async function deleteLabel(id) {
  const response = await authFetch(`${API_URL}/labels/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete label');
  }
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
  await fetch(`${API_URL}/auth/logout`, { method: 'POST' });
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
