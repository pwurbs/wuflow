import { state, setFilterLabel } from '../state.js';

let labelFilterContainer;
let labelFilterBtn;
let labelFilterOptions;
let refreshAppCallback;

export function initLabelFilter(refreshApp) {
  refreshAppCallback = refreshApp;

  labelFilterContainer = document.getElementById('label-filter-wrapper');
  labelFilterBtn = document.getElementById('label-filter-btn');
  labelFilterOptions = document.getElementById('label-filter-options');

  // Label Filter Dropdown Toggle
  labelFilterBtn.addEventListener('click', (e) => {
    // Only toggle if we didn't click the clear icon (handled inside updateLabelFilterOptions or bubbling check)
    // Actually, the clear icon in `updateLabelFilterOptions` has e.stopPropagation(), so it won't reach here?
    // Let's check original app.js.
    // Yes: clearIcon.addEventListener('click', (e) => { e.stopPropagation(); ... });
    // So this click handler is fine.
    e.stopPropagation(); // Prevent document click
    labelFilterOptions.classList.toggle('hidden');
  });

  // Close Dropdown on outside click
  document.addEventListener('click', (e) => {
    if (labelFilterContainer && !labelFilterContainer.contains(e.target)) {
      labelFilterOptions.classList.add('hidden');
    }
  });
}

export function updateLabelFilterOptions(labels) {
  const currentVal = state.filter.labelId;

  // Clear dropdown options
  labelFilterOptions.innerHTML = '';

  // Add "No Label"
  const noLabelOption = createCustomOption('No Label', '__no_label__');
  labelFilterOptions.appendChild(noLabelOption);

  labels.forEach(label => {
    const option = createCustomOption(label.name, label.id);
    labelFilterOptions.appendChild(option);
  });

  // Update button content
  labelFilterBtn.innerHTML = ''; // Clear existing
  if (currentVal !== null && currentVal !== undefined) {
    // Filter Selected
    let labelText = 'Unknown';
    if (currentVal === '__no_label__') {
      labelText = 'No Label';
    } else {
      const found = labels.find(l => l.id === currentVal);
      if (found) labelText = found.name;
    }

    const textSpan = document.createElement('span');
    textSpan.textContent = `Label: ${labelText}`;
    labelFilterBtn.appendChild(textSpan);

    const clearIcon = document.createElement('span');
    clearIcon.className = 'filter-icon-clear';
    clearIcon.innerHTML = '&times;'; // Cross entity
    clearIcon.title = 'Clear filter';

    clearIcon.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent opening dropdown
      setFilterLabel(null);
      if (refreshAppCallback) refreshAppCallback();
    });

    labelFilterBtn.appendChild(clearIcon);
    labelFilterBtn.classList.add('has-selection');
  } else {
    // No Filter
    const textSpan = document.createElement('span');
    textSpan.textContent = 'Label';
    labelFilterBtn.appendChild(textSpan);

    const arrowIcon = document.createElement('span');
    arrowIcon.className = 'filter-icon-arrow';
    arrowIcon.innerHTML = '▼';

    labelFilterBtn.appendChild(arrowIcon);
    labelFilterBtn.classList.remove('has-selection');
  }
}

function createCustomOption(text, value) {
  const div = document.createElement('div');
  div.className = 'custom-option';
  if (state.filter.labelId === value || (!state.filter.labelId && value === '')) {
    // div.classList.add('selected'); // Optional styling
  }
  div.textContent = text;
  div.addEventListener('click', () => {
    setFilterLabel(value || null);
    // We might just call updateLabelFilterOptions via refreshApp, but existing code updated button text manually?
    // Existing code:
    // setFilterLabel(value || null);
    // labelFilterBtn.textContent = text;
    // labelFilterOptions.classList.add('hidden');
    // refreshApp();

    // If refreshApp calls updateLabelFilterOptions, that will rebuild the button content.
    // So we don't strictly need to set textContent here if refreshApp happens immediately.
    // However, existing code line 124 set it to text.
    // But let's look at updateLabelFilterOptions logic (line 75+): It REBUILDS innerHTML.
    // So `labelFilterBtn.textContent = text` at line 124 is overwritten by refreshApp() -> updateLabelFilterOptions().
    // So we can simplify.

    labelFilterOptions.classList.add('hidden');
    if (refreshAppCallback) refreshAppCallback();
  });
  return div;
}
