const API_URL = '/api';

export async function fetchIssues() {
  try {
    const res = await fetch(`${API_URL}/issues`);
    const data = await res.json();
    return data || [];
  } catch (err) {
    console.error('Failed to fetch issues:', err);
    return [];
  }
}

/**
 * Fetch a single issue by ID. Returns { issue, etag } or { issue: null } if not found.
 */
export async function fetchIssueById(id) {
  try {
    const res = await fetch(`${API_URL}/issues/${id}`);
    if (res.status === 404) {
      return { issue: null, etag: null };
    }
    if (!res.ok) {
      throw new Error(`Failed to fetch issue ${id}`);
    }
    const issue = await res.json();
    const etag = res.headers.get('ETag');
    return { issue, etag };
  } catch (err) {
    console.error('Failed to fetch issue:', err);
    return { issue: null, etag: null };
  }
}

export async function createIssue(issue) {
  const res = await fetch(`${API_URL}/issues`, {
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

  const res = await fetch(`${API_URL}/issues/${issue.id}`, {
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

export async function createTask(task) {
  const res = await fetch(`${API_URL}/issues/${task.issue_id}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(task)
  });
  return res.json();
}

export async function updateTask(task) {
  const res = await fetch(`${API_URL}/tasks/${task.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(task)
  });
  return res.json();
}

export async function deleteTask(id) {
  await fetch(`${API_URL}/tasks/${id}`, { method: 'DELETE' });
}

export async function deleteIssue(id) {
  await fetch(`${API_URL}/issues/${id}`, { method: 'DELETE' });
}

export async function fetchLabels() {
  const response = await fetch(`${API_URL}/labels`);
  if (!response.ok) {
    throw new Error('Failed to fetch labels');
  }
  return await response.json();
}

export async function createLabel(label) {
  const response = await fetch(`${API_URL}/labels`, {
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
  const response = await fetch(`${API_URL}/labels/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete label');
  }
}

export async function fetchVersion() {
  try {
    const res = await fetch(`${API_URL}/version`);
    const data = await res.json();
    return data.version || 'Unknown';
  } catch (err) {
    console.warn('Failed to fetch version:', err);
    return 'Unknown';
  }
}
