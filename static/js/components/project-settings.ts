import { fetchLabelsByProject, createLabel, deleteLabel, updateStatusConfig } from '../api.ts';
import { byId, showNotification, showConfirm, escapeHtml, initCharCounter, countCodepoints, getUnusedColor, promptAdminPasswordConfirmation, guardSubmit, errorMessage } from '../utils.ts';
import { MAX_LABEL_NAME_LEN, MAX_STATUS_NAME_LEN, COLOR_REGEX, STATUS_NAME_REGEX } from '../validation-config.ts';
import { state, setStatusConfig, setLabels } from '../state.ts';
import { userCan, ACTION_LIST_LABELS, ACTION_CREATE_LABEL, ACTION_DELETE_LABEL, ACTION_UPDATE_STATUS_CONFIG } from '../permissions.ts';
import { STATUS_SLOTS, getDefaultStatusConfig, type StatusNames } from '../status-config.ts';
import { updateLabelFilterOptions } from './toolbar.ts';
import { renderBoard } from './board.ts';
import { DEFAULT_PROJECT_ID } from '../domain-constants.ts';

let projectSettingsContainer: HTMLElement | null = null;

export function setupProjectSettingsView() {
  projectSettingsContainer = byId('project-settings-view');

  const addLabelInput = byId('ps-new-label-input', HTMLInputElement);
  if (!userCan(state.currentUser, ACTION_CREATE_LABEL)) {
    const group = addLabelInput.closest<HTMLElement>('.label-input-group');
    if (group) group.style.display = 'none';
    return;
  }

  initCharCounter(addLabelInput, MAX_LABEL_NAME_LEN);

  const handleAdd = async () => {
    const name = addLabelInput.value.trim();
    if (!name) return;
    if (countCodepoints(name) > MAX_LABEL_NAME_LEN) {
      showNotification(`Label name must not exceed ${MAX_LABEL_NAME_LEN} characters.`, 'error');
      return;
    }
    try {
      const projectId = state.selectedProjectId ?? DEFAULT_PROJECT_ID;
      const existingLabels = await fetchLabelsByProject(projectId);
      const usedColors = existingLabels.map(l => l.color);
      const color = getUnusedColor(usedColors);
      await createLabel(projectId, { name, color });
      addLabelInput.value = '';
      const labels = await renderProjectSettingsView();
      updateLabelFilterOptions(labels ?? await fetchLabelsByProject(projectId));
      showNotification('Label created', 'success');
    } catch (err) {
      console.error(err);
      showNotification('Failed to create label', 'error');
    }
  };

  // A repeated Enter shares the in-flight add instead of creating the label
  // twice while the first request is still running.
  const addLabel = guardSubmit(handleAdd, { field: addLabelInput.closest('.label-input-group') });

  addLabelInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') void addLabel();
  });
}

export async function renderProjectSettingsView() {
  if (!projectSettingsContainer) return;

  renderStatusConfigSection();

  const labelsList = byId('ps-labels-list');
  const labelsSection = labelsList.closest<HTMLElement>('.settings-section');
  if (labelsSection) {
    labelsSection.style.display = userCan(state.currentUser, ACTION_LIST_LABELS) ? '' : 'none';
    if (!userCan(state.currentUser, ACTION_LIST_LABELS)) return;
  }

  labelsList.innerHTML = '<div class="loader">Loading...</div>';

  try {
    const projectId = state.selectedProjectId ?? DEFAULT_PROJECT_ID;
    const labels = await fetchLabelsByProject(projectId);
    // Keep the shared cache current so the issue modal sees label changes made here.
    if (projectId === state.selectedProjectId) setLabels(labels, projectId);
    labelsList.innerHTML = '';

    labels.forEach(label => {
      const labelEl = document.createElement('div');
      labelEl.className = 'label-item';
      const safeColor = COLOR_REGEX.test(label.color) ? label.color : '#808080';
      labelEl.style.backgroundColor = safeColor + '20';
      labelEl.style.color = safeColor;
      labelEl.style.border = `1px solid ${safeColor}`;

      labelEl.innerHTML = `
        <span class="label-name">${escapeHtml(label.name)}</span>
        ${userCan(state.currentUser, ACTION_DELETE_LABEL) ? '<button class="delete-label-btn" title="Delete Label">×</button>' : ''}
      `;

      const deleteBtn = labelEl.querySelector('.delete-label-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
          if (!userCan(state.currentUser, ACTION_DELETE_LABEL)) return;
          const confirmed = await promptAdminPasswordConfirmation(
            'Delete Label',
            `Do you really want to delete the label "${label.name}"?\nIt will be removed from issues, if assigned, but this removal is not recorded in the issue's history log. This action cannot be undone.`,
            async (adminPassword) => {
              await deleteLabel(projectId, label.id, adminPassword);
            },
            'Delete'
          );
          if (!confirmed) return;
          const labels = await renderProjectSettingsView();
          updateLabelFilterOptions(labels ?? await fetchLabelsByProject(projectId));
          showNotification('Label deleted', 'success');
        });
      }

      labelsList.appendChild(labelEl);
    });

    return labels;
  } catch (err) {
    console.error(err);
    labelsList.innerHTML = '<div class="error">Failed to load labels.</div>';
  }
}

function renderStatusConfigSection() {
  const content = byId('ps-status-config-content');
  const canEdit = userCan(state.currentUser, ACTION_UPDATE_STATUS_CONFIG);
  const projectId = state.selectedProjectId ?? DEFAULT_PROJECT_ID;
  const cfg = state.statusConfig ?? getDefaultStatusConfig();

  const disabledAttr = canEdit ? '' : 'disabled';

  const slotBoxes = STATUS_SLOTS.map((slot, i) => {
    const val = escapeHtml(cfg[slot.field]);
    const isActive = val.trim() !== '';
    const activeClass = isActive ? 'sc-box--active' : 'sc-box--inactive';
    // Count issues with this stage status in the current project (from already-loaded state)
    const orphanCount = state.issues.filter(issue => issue.status === slot.statusKey).length;
    const plural = orphanCount === 1 ? '' : 's';
    const orphanBadge = (isActive || orphanCount === 0)
      ? ''
      : `<span class="sc-orphan-badge" title="${orphanCount} hidden issue${plural}">${orphanCount}</span>`;
    return `
      <div class="sc-box sc-box--configurable ${activeClass}">
        <div class="sc-box-label">Column ${i + 1}${orphanBadge}</div>
        <input type="text" class="sc-name-input" name="${slot.field}" data-field="${slot.field}"
               value="${val}" maxlength="${MAX_STATUS_NAME_LEN}" ${disabledAttr}>
      </div>`;
  }).join('');

  content.innerHTML = `
    <div class="sc-row">
      <div class="sc-box sc-box--fixed">
        <div class="sc-box-label">Fixed</div>
        <div class="sc-fixed-name">Todo</div>
      </div>
      ${slotBoxes}
      <div class="sc-box sc-box--fixed">
        <div class="sc-box-label">Fixed</div>
        <div class="sc-fixed-name">Done</div>
      </div>
    </div>
    <p class="sc-hint">Empty columns are hidden on the board. These names also define the status values when editing an issue. Letters and digits only, single spaces allowed, max 15 characters.</p>
    ${canEdit ? '<button id="ps-save-status-config-btn" class="btn primary">Save Columns</button>' : ''}
  `;

  // Toggle active/inactive styling as user types
  content.querySelectorAll<HTMLInputElement>('.sc-name-input').forEach(input => {
    input.addEventListener('input', () => {
      const box = input.closest('.sc-box');
      if (!box) return;
      const active = input.value !== '';
      box.classList.toggle('sc-box--active', active);
      box.classList.toggle('sc-box--inactive', !active);
      // Hide badge when user types a name (column becoming active)
      const badge = box.querySelector<HTMLElement>('.sc-orphan-badge');
      if (badge) badge.style.display = active ? 'none' : '';
    });
  });

  if (canEdit) {
    byId('ps-save-status-config-btn').addEventListener('click', () =>
      handleSaveStatusConfig(projectId, cfg)
    );
  }
}

async function handleSaveStatusConfig(projectId: number, previousCfg: StatusNames) {
  const payload: Partial<StatusNames> = {};
  for (const slot of STATUS_SLOTS) {
    const input = document.querySelector<HTMLInputElement>(`#ps-status-config-content .sc-name-input[data-field="${slot.field}"]`);
    if (input) payload[slot.field] = input.value.trim();
  }

  const invalidName = Object.values(payload).find(
    name => name !== '' && (!STATUS_NAME_REGEX.test(name) || name.length > MAX_STATUS_NAME_LEN)
  );
  if (invalidName) {
    showNotification(
      STATUS_NAME_REGEX.test(invalidName)
        ? `Column names must not exceed ${MAX_STATUS_NAME_LEN} characters.`
        : 'Column names must contain only letters, digits and single spaces.',
      'error'
    );
    return;
  }

  // Check for columns being deactivated that still have issues
  const deactivating = STATUS_SLOTS.filter(slot => {
    const wasActive = previousCfg[slot.field].trim() !== '';
    const willBeActive = (payload[slot.field] ?? '').trim() !== '';
    return wasActive && !willBeActive;
  });

  if (deactivating.length > 0) {
    const affected = deactivating
      .map(slot => {
        const count = state.issues.filter(i => i.status === slot.statusKey).length;
        return count > 0 ? { name: previousCfg[slot.field], count } : null;
      })
      .filter(d => d !== null);

    if (affected.length > 0) {
      const details = affected
        .map(d => { const s = d.count === 1 ? '' : 's'; return `"${d.name}" (${d.count} issue${s})`; })
        .join(', ');
      const confirmed = await showConfirm(
        'Deactivate Column',
        `The following columns have issues that will be hidden until the column is re-enabled: ${details}. Continue?`
      );
      if (!confirmed) return;
    }
  }

  try {
    const updated = await updateStatusConfig(projectId, payload);
    setStatusConfig(updated);
    showNotification('Column configuration saved', 'success');
    renderBoard();
  } catch (err) {
    showNotification(errorMessage(err) || 'Failed to save column configuration', 'error');
  }
}
