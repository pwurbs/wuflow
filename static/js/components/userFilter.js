import { state, setFilterAssignee } from '../state.js';

let userFilterContainer;
let userFilterBtn;
let userFilterOptions;
let refreshAppCallback;

export function initUserFilter(refreshApp) {
  refreshAppCallback = refreshApp;

  userFilterContainer = document.getElementById('user-filter-wrapper');
  userFilterBtn = document.getElementById('user-filter-btn');
  userFilterOptions = document.getElementById('user-filter-options');

  if (!userFilterBtn) return;

  // User Filter Dropdown Toggle
  userFilterBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    userFilterOptions.classList.toggle('hidden');
  });

  // Close Dropdown on outside click
  document.addEventListener('click', (e) => {
    if (userFilterContainer && !userFilterContainer.contains(e.target)) {
      userFilterOptions.classList.add('hidden');
    }
  });
}

export function updateUserFilterOptions(users) {
  if (!userFilterOptions) return;
  const currentVal = state.filter.assigneeId;

  // Clear dropdown options
  userFilterOptions.innerHTML = '';

  // Add "My Issues"
  const myIssuesOption = createCustomOption('My Issues', 'me');
  userFilterOptions.appendChild(myIssuesOption);

  // Add "Unassigned"
  const unassignedOption = createCustomOption('Unassigned', 'unassigned');
  userFilterOptions.appendChild(unassignedOption);

  users.filter(u => u.active).forEach(user => {
    const option = createCustomOption(`${user.first_name} ${user.last_name}`, user.id);
    userFilterOptions.appendChild(option);
  });

  // Update button content
  userFilterBtn.innerHTML = '';
  if (currentVal !== null && currentVal !== undefined) {
    let userName = 'User';
    if (currentVal === 'me') {
      userName = 'My Issues';
    } else if (currentVal === 'unassigned') {
      userName = 'Unassigned';
    } else {
      const user = users.find(u => u.id === Number.parseInt(currentVal));
      if (user) {
        userName = `${user.first_name} ${user.last_name}`;
      }
    }

    const textSpan = document.createElement('span');
    textSpan.textContent = `User: ${userName}`;
    userFilterBtn.appendChild(textSpan);

    const clearIcon = document.createElement('span');
    clearIcon.className = 'filter-icon-clear';
    clearIcon.innerHTML = '&times;';
    clearIcon.title = 'Clear filter';

    clearIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      setFilterAssignee(null);
      if (refreshAppCallback) refreshAppCallback();
    });

    userFilterBtn.appendChild(clearIcon);
    userFilterBtn.classList.add('has-selection');
  } else {
    const textSpan = document.createElement('span');
    textSpan.textContent = 'User';
    userFilterBtn.appendChild(textSpan);

    const arrowIcon = document.createElement('span');
    arrowIcon.className = 'filter-icon-arrow';
    arrowIcon.innerHTML = '▼';

    userFilterBtn.appendChild(arrowIcon);
    userFilterBtn.classList.remove('has-selection');
  }
}

function createCustomOption(text, value) {
  const div = document.createElement('div');
  div.className = 'custom-option';
  div.textContent = text;
  div.addEventListener('click', () => {
    setFilterAssignee(value);
    userFilterOptions.classList.add('hidden');
    if (refreshAppCallback) refreshAppCallback();
  });
  return div;
}
