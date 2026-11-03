import { state, setReleases, setStatusConfig } from '../state.ts';
import { byId, containsTarget, errorMessage, showNotification } from '../utils.ts';
import { getStatusOptions, getStatusLabel, STATUS_OPEN, STATUS_ARCHIVE } from '../status-config.ts';
import { fetchLabelsByProject, fetchReleases, fetchStatusConfig } from '../api.ts';
import { PRIORITY_OPTIONS, RELEASE_STATUS_CLOSED } from '../domain-constants.ts';
import type { Label, Project, Release, User } from '../models.ts';

function closeOptions(options: HTMLElement) {
  options.classList.add('hidden');
  options.style.maxHeight = '';
}

// Sets up the issue modal's dropdowns, each made of the elements <name>-dropdown, <name>-trigger
// and <name>-options. Opening one closes the others, a click outside closes all.
export function setupIssueDropdowns() {
  const dropdowns = ['status', 'label', 'priority', 'assignee', 'project', 'release'].map(name => ({
    wrapper: byId(`${name}-dropdown`),
    trigger: byId(`${name}-trigger`),
    options: byId(`${name}-options`),
  }));

  dropdowns.forEach(({ trigger, options }) => {
    const others = dropdowns.map(d => d.options).filter(o => o !== options);
    setupCustomDropdown(trigger, options, others);
  });

  document.addEventListener('click', (e) => {
    dropdowns.forEach(({ wrapper, options }) => {
      if (!containsTarget(wrapper, e.target)) closeOptions(options);
    });
  });
}

function setupCustomDropdown(trigger: HTMLElement, options: HTMLElement, otherOptions: HTMLElement[]) {
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();

    if (state.currentIssue?.status === STATUS_ARCHIVE) return;

    const wasHidden = options.classList.contains('hidden');

    otherOptions.forEach(closeOptions);

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
      closeOptions(options);
    }
  });
}

export function renderStatusOptions() {
  const optionsContainer = byId('status-options');
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
  const optionsContainer = byId('priority-options');
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

export function renderLabelOptions(labels: Label[]) {
  const optionsContainer = byId('label-options');
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

export function renderReleaseOptions(releases: Release[], currentReleaseId: number | null) {
  const optionsContainer = byId('release-options');
  optionsContainer.innerHTML = '';

  const noReleaseDiv = document.createElement('div');
  noReleaseDiv.className = 'custom-option';
  noReleaseDiv.textContent = 'No Release';
  noReleaseDiv.addEventListener('click', () => {
    selectOption('release-select', 'release-text', 'release-options', '', 'No Release');
  });
  optionsContainer.appendChild(noReleaseDiv);

  releases.filter(r => r.status !== RELEASE_STATUS_CLOSED).sort((a, b) => a.name.localeCompare(b.name)).forEach(release => {
    const div = document.createElement('div');
    div.className = 'custom-option';
    div.textContent = release.name;
    div.addEventListener('click', () => {
      selectOption('release-select', 'release-text', 'release-options', release.id, release.name);
    });
    optionsContainer.appendChild(div);
  });

  const releaseInput = byId('release-select', HTMLInputElement);
  const releaseText = byId('release-text');
  if (currentReleaseId) {
    const found = releases.find(r => r.id === currentReleaseId);
    releaseInput.value = String(currentReleaseId);
    releaseText.textContent = found ? found.name : 'No Release';
  } else {
    releaseInput.value = '';
    releaseText.textContent = 'No Release';
  }
}

export function renderProjectOptions(projects: Project[]) {
  const optionsContainer = byId('project-options');
  optionsContainer.innerHTML = '';

  projects.forEach(project => {
    const div = document.createElement('div');
    div.className = 'custom-option';
    div.textContent = project.name;
    div.addEventListener('click', () => {
      selectOption('project-select', 'project-text', 'project-options', project.id, project.name);
    });
    optionsContainer.appendChild(div);
  });
}

// Fills the label, release and status dropdowns with the given project's options and resets
// them to their empty values, as the server does when an issue moves to that project.
export async function loadProjectOptions(projectId: number) {
  try {
    const [labels, releases, cfg] = await Promise.all([
      fetchLabelsByProject(projectId), fetchReleases(projectId), fetchStatusConfig(projectId),
    ]);
    renderLabelOptions(labels);
    byId('label-select', HTMLInputElement).value = '';
    byId('label-text').textContent = 'No Label';
    setReleases(releases);
    renderReleaseOptions(releases, null);
    setStatusConfig(cfg);
    renderStatusOptions();
    byId('status', HTMLInputElement).value = STATUS_OPEN;
    byId('status-text').textContent = getStatusLabel(STATUS_OPEN);
    closeOptions(byId('status-options'));
  } catch (err) {
    showNotification(errorMessage(err), 'error');
  }
}

export function renderAssigneeOptions(users: User[]) {
  const optionsContainer = byId('assignee-options');
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
  const me = state.currentUser;
  if (me) {
    const meDiv = document.createElement('div');
    meDiv.className = 'custom-option';
    meDiv.textContent = 'Assign to me';
    meDiv.addEventListener('click', () => {
      selectOption('assignee-select', 'assignee-text', 'assignee-options', me.id, `${me.first_name} ${me.last_name}`);
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

function selectOption(inputId: string, textId: string, optionsId: string, value: string | number, text: string) {
  const input = byId(inputId, HTMLInputElement);
  const textSpan = byId(textId);

  if (input.value != value) {
    input.value = String(value);
    textSpan.textContent = text;
    input.dispatchEvent(new Event('change')); // Trigger immediate save if applicable
  }

  closeOptions(byId(optionsId));
}
