import { state } from '../state.js';
import { getStatusOptions, STATUS_OPEN, STATUS_ARCHIVE } from '../status-config.js';
import { fetchLabelsByProject, fetchReleases, fetchStatusConfig } from '../api.js';
import { PRIORITY_OPTIONS, RELEASE_STATUS_CLOSED } from '../domain-constants.js';

export function setupCustomDropdown(wrapperId, triggerId, optionsId, inputId, textId) {
  const trigger = document.getElementById(triggerId);
  const options = document.getElementById(optionsId);

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();

    if (state.currentIssue?.status === STATUS_ARCHIVE) return;

    const wasHidden = options.classList.contains('hidden');

    // Close others
    ['status-dropdown', 'label-dropdown', 'priority-dropdown', 'assignee-dropdown'].forEach(id => {
      if (id !== wrapperId) {
        const otherOptions = document.getElementById(id).querySelector('.custom-select-options');
        otherOptions.classList.add('hidden');
        otherOptions.style.maxHeight = '';
      }
    });

    if (wasHidden) {
      // Constrain dropdown to available space below the trigger within the modal
      const triggerRect = trigger.getBoundingClientRect();
      const modalContent = document.querySelector('.issue-modal-content');
      if (modalContent) {
        const modalRect = modalContent.getBoundingClientRect();
        const spaceBelow = modalRect.bottom - 20 - triggerRect.bottom;
        options.style.maxHeight = Math.max(80, Math.min(300, spaceBelow)) + 'px';
      }
      options.classList.remove('hidden');
    } else {
      options.classList.add('hidden');
      options.style.maxHeight = '';
    }
  });
}

export function renderStatusOptions() {
  const optionsContainer = document.getElementById('status-options');
  optionsContainer.innerHTML = '';

  getStatusOptions().forEach(({ value, label }) => {
    const div = document.createElement('div');
    div.className = 'custom-option';
    div.textContent = label;
    div.addEventListener('click', () => {
      selectOption('status', 'status-text', 'status-options', value, label);
    });
    optionsContainer.appendChild(div);
  });
}

export function renderPriorityOptions() {
  const optionsContainer = document.getElementById('priority-options');
  optionsContainer.innerHTML = '';
  PRIORITY_OPTIONS.forEach(({ text, value }) => {
    const div = document.createElement('div');
    div.className = 'custom-option';
    div.textContent = text;
    div.addEventListener('click', () => {
      selectOption('priority', 'priority-text', 'priority-options', value, text);
    });
    optionsContainer.appendChild(div);
  });
}

export function renderLabelOptions(labels) {
  const optionsContainer = document.getElementById('label-options');
  optionsContainer.innerHTML = '';

  // No Label Option
  const noLabelDiv = document.createElement('div');
  noLabelDiv.className = 'custom-option';
  noLabelDiv.textContent = 'No Label';
  noLabelDiv.addEventListener('click', () => {
    selectOption('label-select', 'label-text', 'label-options', '', 'No Label');
  });
  optionsContainer.appendChild(noLabelDiv);

  labels.forEach(label => {
    const div = document.createElement('div');
    div.className = 'custom-option';
    div.textContent = label.name;

    div.addEventListener('click', () => {
      selectOption('label-select', 'label-text', 'label-options', label.id, label.name);
    });
    optionsContainer.appendChild(div);
  });
}

export function renderReleaseOptions(releases, currentReleaseId) {
  const optionsContainer = document.getElementById('release-options');
  if (!optionsContainer) return;
  optionsContainer.innerHTML = '';

  const noReleaseDiv = document.createElement('div');
  noReleaseDiv.className = 'custom-option';
  noReleaseDiv.textContent = 'No Release';
  noReleaseDiv.addEventListener('click', () => {
    selectOption('release-select', 'release-text', 'release-options', '', 'No Release');
  });
  optionsContainer.appendChild(noReleaseDiv);

  (releases || []).filter(r => r.status !== RELEASE_STATUS_CLOSED).sort((a, b) => a.name.localeCompare(b.name)).forEach(release => {
    const div = document.createElement('div');
    div.className = 'custom-option';
    div.textContent = release.name;
    div.addEventListener('click', () => {
      selectOption('release-select', 'release-text', 'release-options', release.id, release.name);
    });
    optionsContainer.appendChild(div);
  });

  const releaseInput = document.getElementById('release-select');
  const releaseText = document.getElementById('release-text');
  if (releaseInput && releaseText) {
    if (currentReleaseId) {
      const found = (releases || []).find(r => r.id === currentReleaseId);
      releaseInput.value = currentReleaseId;
      releaseText.textContent = found ? found.name : 'No Release';
    } else {
      releaseInput.value = '';
      releaseText.textContent = 'No Release';
    }
  }
}

export function renderProjectOptions(projects) {
  const optionsContainer = document.getElementById('project-options');
  if (!optionsContainer) return;
  optionsContainer.innerHTML = '';

  (projects || []).forEach(project => {
    const div = document.createElement('div');
    div.className = 'custom-option';
    div.textContent = project.name;
    div.addEventListener('click', () => {
      selectOption('project-select', 'project-text', 'project-options', project.id, project.name);
      fetchLabelsByProject(project.id).then(labels => {
        renderLabelOptions(labels);
        document.getElementById('label-select').value = '';
        document.getElementById('label-text').textContent = 'No Label';
      }).catch(err => console.error('Failed to reload labels for project', err));
      fetchReleases(project.id).then(releases => {
        state.releases = releases;
        renderReleaseOptions(releases, null);
      }).catch(err => console.error('Failed to reload releases for project', err));
      fetchStatusConfig(project.id).then(cfg => {
        state.statusConfig = cfg;
        renderStatusOptions();
        const statusInput = document.getElementById('status');
        const statusText = document.getElementById('status-text');
        if (statusInput) statusInput.value = STATUS_OPEN;
        if (statusText) statusText.textContent = 'Open';
        document.getElementById('status-options')?.classList.add('hidden');
      }).catch(err => console.error('Failed to reload status config for project', err));
    });
    optionsContainer.appendChild(div);
  });
}

export function renderAssigneeOptions(users) {
  const optionsContainer = document.getElementById('assignee-options');
  optionsContainer.innerHTML = '';

  // Unassigned Option
  const unassignedDiv = document.createElement('div');
  unassignedDiv.className = 'custom-option';
  unassignedDiv.textContent = 'Unassigned';
  unassignedDiv.addEventListener('click', () => {
    selectOption('assignee-select', 'assignee-text', 'assignee-options', '', 'Unassigned');
  });
  optionsContainer.appendChild(unassignedDiv);

  // "Assign to me" Option
  if (state.currentUser) {
    const meDiv = document.createElement('div');
    meDiv.className = 'custom-option';
    meDiv.textContent = 'Assign to me';
    meDiv.addEventListener('click', () => {
      selectOption('assignee-select', 'assignee-text', 'assignee-options', state.currentUser.id, `${state.currentUser.first_name} ${state.currentUser.last_name}`);
    });
    optionsContainer.appendChild(meDiv);
  }

  users.filter(u => u.active && u.id !== state.currentUser?.id).forEach(user => {
    const div = document.createElement('div');
    div.className = 'custom-option';
    div.textContent = `${user.first_name} ${user.last_name}`;

    div.addEventListener('click', () => {
      selectOption('assignee-select', 'assignee-text', 'assignee-options', user.id, `${user.first_name} ${user.last_name}`);
    });
    optionsContainer.appendChild(div);
  });
}

function selectOption(inputId, textId, optionsId, value, text) {
  const input = document.getElementById(inputId);
  const textSpan = document.getElementById(textId);
  const options = document.getElementById(optionsId);

  if (input.value != value) {
    input.value = value;
    textSpan.textContent = text;
    input.dispatchEvent(new Event('change')); // Trigger immediate save if applicable
  }

  options.classList.add('hidden');
  options.style.maxHeight = '';
}
