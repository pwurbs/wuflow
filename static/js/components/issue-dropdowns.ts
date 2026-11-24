import { state } from '../state.ts';
import { byId, containsTarget, sortByName, createOption } from '../utils.ts';
import { getStatusOptions, getStatusLabel, getActiveStatusConfig, STATUS_OPEN, STATUS_ARCHIVE } from '../status-config.ts';
import type { StatusNames } from '../status-config.ts';
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

export function renderStatusOptions(statusNames?: StatusNames) {
  const optionsContainer = byId('status-options');
  optionsContainer.innerHTML = '';

  getStatusOptions(statusNames).forEach(({ value, label }) => {
    optionsContainer.appendChild(createOption(label, () => {
      selectOption('status', 'status-text', 'status-options', value, label);
    }));
  });
}

export function renderPriorityOptions() {
  const optionsContainer = byId('priority-options');
  optionsContainer.innerHTML = '';
  PRIORITY_OPTIONS.forEach(({ text, value }) => {
    optionsContainer.appendChild(createOption(text, () => {
      selectOption('priority', 'priority-text', 'priority-options', value, text);
    }));
  });
}

export function renderLabelOptions(labels: Label[]) {
  const optionsContainer = byId('label-options');
  optionsContainer.innerHTML = '';

  optionsContainer.appendChild(createOption('No Label', () => {
    selectOption('label-select', 'label-text', 'label-options', '', 'No Label');
  }));

  sortByName(labels, l => l.name).forEach(label => {
    optionsContainer.appendChild(createOption(label.name, () => {
      selectOption('label-select', 'label-text', 'label-options', label.id, label.name);
    }));
  });
}

export function renderReleaseOptions(releases: Release[], currentReleaseId: number | null) {
  const optionsContainer = byId('release-options');
  optionsContainer.innerHTML = '';

  optionsContainer.appendChild(createOption('No Release', () => {
    selectOption('release-select', 'release-text', 'release-options', '', 'No Release');
  }));

  sortByName(releases.filter(r => r.status !== RELEASE_STATUS_CLOSED), r => r.name).forEach(release => {
    optionsContainer.appendChild(createOption(release.name, () => {
      selectOption('release-select', 'release-text', 'release-options', release.id, release.name);
    }));
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

  sortByName(projects, p => p.name).forEach(project => {
    optionsContainer.appendChild(createOption(project.name, () => {
      selectOption('project-select', 'project-text', 'project-options', project.id, project.name);
    }));
  });
}

// The label, release and status options of one project, as the issue dialog offers them.
export interface ProjectOptions {
  projectId: number;
  labels: Label[];
  releases: Release[];
  statusNames: StatusNames;
}

// The selected project's options from the cache refreshApp fills, or null for any other project
// and while the cache does not hold the selected project's labels and status names.
export function cachedProjectOptions(projectId: number): ProjectOptions | null {
  if (projectId !== state.selectedProjectId || state.labelsProjectId !== projectId) return null;
  if (state.statusConfig?.project_id !== projectId) return null;
  return { projectId, labels: state.labels, releases: state.releases, statusNames: getActiveStatusConfig() };
}

export async function fetchProjectOptions(projectId: number): Promise<ProjectOptions> {
  const [labels, releases, statusNames] = await Promise.all([
    fetchLabelsByProject(projectId), fetchReleases(projectId), fetchStatusConfig(projectId),
  ]);
  return { projectId, labels, releases, statusNames };
}

// Fills the label, release and status dropdowns with the given project's options and resets
// them to their empty values, as the server does when an issue moves to that project.
export function resetProjectDropdowns(options: ProjectOptions) {
  renderLabelOptions(options.labels);
  byId('label-select', HTMLInputElement).value = '';
  byId('label-text').textContent = 'No Label';
  renderReleaseOptions(options.releases, null);
  renderStatusOptions(options.statusNames);
  byId('status', HTMLInputElement).value = STATUS_OPEN;
  byId('status-text').textContent = getStatusLabel(STATUS_OPEN, options.statusNames);
  closeOptions(byId('status-options'));
}

export function renderAssigneeOptions(users: User[]) {
  const optionsContainer = byId('assignee-options');
  optionsContainer.innerHTML = '';

  optionsContainer.appendChild(createOption('Unassigned', () => {
    selectOption('assignee-select', 'assignee-text', 'assignee-options', '', 'Unassigned');
  }));

  const me = state.currentUser;
  if (me) {
    optionsContainer.appendChild(createOption('Assign to me', () => {
      selectOption('assignee-select', 'assignee-text', 'assignee-options', me.id, `${me.first_name} ${me.last_name}`);
    }));
  }

  sortByName(users.filter(u => u.active && u.id !== state.currentUser?.id), u => `${u.first_name} ${u.last_name}`).forEach(user => {
    const name = `${user.first_name} ${user.last_name}`;
    optionsContainer.appendChild(createOption(name, () => {
      selectOption('assignee-select', 'assignee-text', 'assignee-options', user.id, name);
    }));
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
