import readline from 'node:readline';
import process from 'node:process';

const API_BASE = 'http://localhost:8080';
const LOGIN_ENDPOINT = `${API_BASE}/api/auth/login`;
const ISSUES_ENDPOINT = `${API_BASE}/api/issues`;
const LABELS_ENDPOINT = `${API_BASE}/api/labels`;
const USERS_ENDPOINT = `${API_BASE}/api/users`;

const STATES = ['Open', 'Todo', 'Pending', 'Working', 'Done', 'Archive'];
const PRIORITIES = ['Normal', 'High'];

// No global readline interface to avoid interference with password prompt

function askPassword() {
  return new Promise((resolve) => {
    process.stdout.write('Admin Password: ');
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    let password = '';
    const onKeypress = (str, key) => {
      if (key.ctrl && key.name === 'c') {
        process.exit();
      } else if (key.name === 'return' || key.name === 'enter') {
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        process.stdin.removeListener('keypress', onKeypress);
        process.stdin.pause();
        process.stdout.write('\n');
        resolve(password);
      } else if (key.name === 'backspace') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else if (str && str.length === 1) {
        password += str;
        process.stdout.write('*');
      }
    };
    process.stdin.on('keypress', onKeypress);
  });
}

async function login(password) {
  console.log(`Logging in to ${LOGIN_ENDPOINT}...`);
  const response = await fetch(LOGIN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: 'admin@local',
      password: password
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Login failed (${response.status}): ${text}`);
  }

  const cookies = response.headers.getSetCookie();
  return cookies.join('; ');
}

async function getLabels(cookie) {
  const response = await fetch(LABELS_ENDPOINT, {
    headers: { 'Cookie': cookie }
  });
  if (response.ok) {
    return await response.json();
  }
  return [];
}

async function getUsers(cookie) {
  const response = await fetch(USERS_ENDPOINT, {
    headers: { 'Cookie': cookie }
  });
  if (response.ok) {
    return await response.json();
  }
  return [];
}

function getRandomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomDate() {
  const start = new Date(2024, 0, 1);
  const end = new Date(2025, 11, 31);
  const date = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
  return date.toISOString();
}

function getRandomPlannedDates() {
  const count = Math.floor(Math.random() * 3);
  const dates = [];
  for (let i = 0; i < count; i++) {
    const d = new Date();
    d.setDate(d.getDate() + Math.random() * 30);
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

const adjectives = ['Urgent', 'Critical', 'Minor', 'Internal', 'External', 'Legacy', 'New', 'Refactored', 'Broken', 'Polished'];
const nouns = ['Database', 'Frontend', 'Backend', 'Middleware', 'UI', 'UX', 'Security', 'Performance', 'API', 'Validation'];
const verbs = ['Fix', 'Implement', 'Improve', 'Refactor', 'Update', 'Remove', 'Audit', 'Test', 'Document', 'Optimize'];

function generateRandomTitle() {
  return `${getRandomElement(verbs)} ${getRandomElement(adjectives)} ${getRandomElement(nouns)}`;
}

async function createIssue(cookie, index, state, labels, users) {
  const label = Math.random() > 0.3 ? getRandomElement(labels) : null;
  const assignee = Math.random() > 0.5 ? getRandomElement(users) : null;

  const issue = {
    title: `${index}: ${generateRandomTitle()}`,
    description: `This is a randomly generated issue for testing purposes. It is issue number ${index}.
        <br>
        <b>Details:</b>
        <ul>
            <li>State: ${state}</li>
            <li>Random Factor: ${Math.random().toFixed(4)}</li>
        </ul>
        Check out this <a href="https://example.com">example link</a>.`,
    status: state,
    priority: getRandomElement(PRIORITIES),
    position: Math.floor(Math.random() * 1000),
    deadline: Math.random() > 0.7 ? getRandomDate() : null,
    planned_dates: getRandomPlannedDates(),
    label: label ? { id: label.id } : null,
    assignee_id: assignee ? assignee.id : null
  };

  const response = await fetch(ISSUES_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookie
    },
    body: JSON.stringify(issue)
  });

  if (response.ok) {
    if (index % 100 === 0) {
      console.log(`Progress: ${index}/1000 issues created...`);
    }
  } else {
    const text = await response.text();
    console.error(`Failed to create issue ${index}: ${text}`);
  }
}

try {
  const password = await askPassword();
  const cookie = await login(password);
  console.log('Login successful.');

  const labels = await getLabels(cookie);
  const users = await getUsers(cookie);

  console.log(`Generating 1000 issues... (Labels: ${labels.length}, Users: ${users.length})`);

  for (let i = 1; i <= 1000; i++) {
    // Cycle through states to ensure coverage
    const state = STATES[(i - 1) % STATES.length];
    await createIssue(cookie, i, state, labels, users);
  }

  console.log('Done!');
} catch (error) {
  console.error('Error:', error.message);
}
