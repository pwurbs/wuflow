import { fetchLabelsByProject, createLabel, deleteLabel, updateStatusConfig } from '../api.js';
import { showNotification, showConfirm, escapeHtml, initCharCounter, countCodepoints, getUnusedColor } from '../utils.js';
import { MAX_LABEL_NAME_LEN, MAX_STATUS_NAME_LEN, COLOR_REGEX, STATUS_NAME_REGEX } from '../validation-config.js';
import { state, setStatusConfig } from '../state.js';
import { userCan, ACTION_LIST_LABELS, ACTION_CREATE_LABEL, ACTION_DELETE_LABEL, ACTION_UPDATE_STATUS_CONFIG } from '../permissions.js';
import { STATUS_SLOTS, getDefaultStatusConfig } from '../status-config.js';
import { updateLabelFilterOptions } from './toolbar.js';
import { renderBoard } from './board.js';

let projectSettingsContainer = null;

export function setupProjectSettingsView() {
  projectSettingsContainer = document.getElementById('project-settings-view');

  const addLabelInput = document.getElementById('ps-new-label-input');

  if (addLabelInput) {
    if (userCan(state.currentUser, ACTION_CREATE_LABEL)) {
      initCharCounter(addLabelInput, MAX_LABEL_NAME_LEN);

      const handleAdd = async () => {
        const name = addLabelInput.value.trim();
        if (!name) return;
        if (countCodepoints(name) > MAX_LABEL_NAME_LEN) {
          showNotification(`Label name must not exceed ${MAX_LABEL_NAME_LEN} characters.`, 'error');
          return;
        }
        try {
          const projectId = state.selectedProjectId ?? 1;
          const existingLabels = await fetchLabelsByProject(projectId);
          const usedColors = existingLabels.map(l => l.color);
          const color = getUnusedColor(usedColors);
          await createLabel(projectId, { name, color });
          addLabelInput.value = '';
          renderProjectSettingsView();
          updateLabelFilterOptions(await fetchLabelsByProject(projectId));
          showNotification('Label created', 'success');
        } catch (err) {
          console.error(err);
          showNotification('Failed to create label', 'error');
        }
      };

      addLabelInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleAdd();
      });
    } else {
      const group = addLabelInput.closest('.label-input-group');
      if (group) group.style.display = 'none';
    }
  }
}

export async function renderProjectSettingsView() {
  if (!projectSettingsContainer) return;

  renderStatusConfigSection();

  const labelsList = document.getElementById('ps-labels-list');
  if (!labelsList) return;

  const labelsSection = labelsList.closest('.settings-section');
  if (labelsSection) {
    labelsSection.style.display = userCan(state.currentUser, ACTION_LIST_LABELS) ? '' : 'none';
    if (!userCan(state.currentUser, ACTION_LIST_LABELS)) return;
  }

  labelsList.innerHTML = '<div class="loader">Loading...</div>';

  try {
    const projectId = state.selectedProjectId ?? 1;
    const labels = await fetchLabelsByProject(projectId);
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
          const confirmed = await showConfirm(
            'Delete Label',
            `Are you sure you want to delete the label "${label.name}"? It will be removed from issues, if assigned. This action cannot be undone.`
          );
          if (confirmed) {
            try {
              await deleteLabel(projectId, label.id);
              renderProjectSettingsView();
              updateLabelFilterOptions(await fetchLabelsByProject(projectId));
              showNotification('Label deleted', 'success');
            } catch (err) {
              console.error(err);
              showNotification('Failed to delete label', 'error');
            }
          }
        });
      }

      labelsList.appendChild(labelEl);
    });
  } catch (err) {
    console.error(err);
    labelsList.innerHTML = '<div class="error">Failed to load labels.</div>';
  }
}

function renderStatusConfigSection() {
  const content = document.getElementById('ps-status-config-content');
  if (!content) return;

  const canEdit = userCan(state.currentUser, ACTION_UPDATE_STATUS_CONFIG);
  const projectId = state.selectedProjectId ?? 1;
  const cfg = state.statusConfig ?? getDefaultStatusConfig();

  const disabledAttr = canEdit ? '' : 'disabled';

  const slotBoxes = STATUS_SLOTS.map((slot, i) => {
    const val = escapeHtml(cfg[slot.field] ?? '');
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
  content.querySelectorAll('.sc-name-input').forEach(input => {
    input.addEventListener('input', () => {
      const box = input.closest('.sc-box');
      const active = input.value !== '';
      box.classList.toggle('sc-box--active', active);
      box.classList.toggle('sc-box--inactive', !active);
      // Hide badge when user types a name (column becoming active)
      const badge = box.querySelector('.sc-orphan-badge');
      if (badge) badge.style.display = active ? 'none' : '';
    });
  });

  if (canEdit) {
    document.getElementById('ps-save-status-config-btn').addEventListener('click', () =>
      handleSaveStatusConfig(projectId, cfg)
    );
  }
}

async function handleSaveStatusConfig(projectId, previousCfg) {
  const inputs = document.querySelectorAll('#ps-status-config-content .sc-name-input');
  const payload = {};
  inputs.forEach(input => {
    payload[input.dataset.field] = input.value.trim();
  });

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
    const wasActive = (previousCfg[slot.field] ?? '').trim() !== '';
    const willBeActive = (payload[slot.field] ?? '').trim() !== '';
    return wasActive && !willBeActive;
  });

  if (deactivating.length > 0) {
    const affected = deactivating
      .map(slot => {
        const count = state.issues.filter(i => i.status === slot.statusKey).length;
        return count > 0 ? { name: previousCfg[slot.field], count } : null;
      })
      .filter(Boolean);

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
    showNotification(err.message || 'Failed to save column configuration', 'error');
  }
}
