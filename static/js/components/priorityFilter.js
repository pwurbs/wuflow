import { state, setFilterPriority } from '../state.js';

let priorityFilterContainer;
let priorityFilterBtn;
let priorityFilterOptions;
let refreshAppCallback;

export function initPriorityFilter(refreshApp) {
  refreshAppCallback = refreshApp;

  priorityFilterContainer = document.getElementById('priority-filter-wrapper');
  priorityFilterBtn = document.getElementById('priority-filter-btn');
  priorityFilterOptions = document.getElementById('priority-filter-options');

  // Priority Filter Dropdown Toggle
  priorityFilterBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent document click

    // Close label filter if open (optional but good UX)
    const labelFilterOptions = document.getElementById('label-filter-options');
    if (labelFilterOptions) labelFilterOptions.classList.add('hidden');

    priorityFilterOptions.classList.toggle('hidden');
  });

  // Close Dropdown on outside click
  document.addEventListener('click', (e) => {
    if (priorityFilterContainer && !priorityFilterContainer.contains(e.target)) {
      priorityFilterOptions.classList.add('hidden');
    }
  });

  updatePriorityFilterOptions();
}

export function updatePriorityFilterOptions() {
  const currentVal = state.filter.priority;

  // Clear dropdown options
  priorityFilterOptions.innerHTML = '';

  // Options
  const priorities = [
    { text: 'Normal', value: 'Normal' },
    { text: 'High', value: 'High' }
  ];

  priorities.forEach(prio => {
    const option = createCustomOption(prio.text, prio.value);
    priorityFilterOptions.appendChild(option);
  });

  // Update button content
  priorityFilterBtn.innerHTML = ''; // Clear existing
  if (currentVal) {
    // Filter Selected
    const textSpan = document.createElement('span');
    textSpan.textContent = `Priority: ${currentVal}`;
    priorityFilterBtn.appendChild(textSpan);

    const clearIcon = document.createElement('span');
    clearIcon.className = 'filter-icon-clear';
    clearIcon.innerHTML = '&times;'; // Cross entity
    clearIcon.title = 'Clear filter';

    clearIcon.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent opening dropdown
      setFilterPriority(null);
      updatePriorityFilterOptions(); // Update UI immediately
      if (refreshAppCallback) refreshAppCallback();
    });

    priorityFilterBtn.appendChild(clearIcon);
    priorityFilterBtn.classList.add('has-selection');
  } else {
    // No Filter
    const textSpan = document.createElement('span');
    textSpan.textContent = 'Priority';
    priorityFilterBtn.appendChild(textSpan);

    const arrowIcon = document.createElement('span');
    arrowIcon.className = 'filter-icon-arrow';
    arrowIcon.innerHTML = '▼';

    priorityFilterBtn.appendChild(arrowIcon);
    priorityFilterBtn.classList.remove('has-selection');
  }
}

function createCustomOption(text, value) {
  const div = document.createElement('div');
  div.className = 'custom-option';
  if (state.filter.priority === value) {
    // div.classList.add('selected'); 
  }
  div.textContent = text;
  div.addEventListener('click', () => {
    setFilterPriority(value);
    priorityFilterOptions.classList.add('hidden');
    updatePriorityFilterOptions();
    if (refreshAppCallback) refreshAppCallback();
  });
  return div;
}
