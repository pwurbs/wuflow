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

export async function createIssue(issue) {
  const res = await fetch(`${API_URL}/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(issue)
  });
  return res.json();
}

export async function updateIssue(issue) {
  const res = await fetch(`${API_URL}/issues/${issue.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(issue)
  });
  return res.json();
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
