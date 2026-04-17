import { fetchLabelsByProject, createLabel, deleteLabel } from '../api.js';
import { showNotification, showConfirm, escapeHtml, initCharCounter, countCodepoints, getUnusedColor } from '../utils.js';
import { state } from '../state.js';
import { userCan, ACTION_LIST_LABELS, ACTION_CREATE_LABEL, ACTION_DELETE_LABEL } from '../permissions.js';

let projectSettingsContainer = null;
let refreshCallback = null;

export function setupProjectSettingsView(callback) {
  projectSettingsContainer = document.getElementById('project-settings-view');
  refreshCallback = callback;

  const addLabelInput = document.getElementById('ps-new-label-input');
  const addLabelBtn = document.getElementById('ps-add-label-btn');

  if (addLabelBtn && addLabelInput) {
    if (userCan(state.currentUser, ACTION_CREATE_LABEL)) {
      initCharCounter(addLabelInput, 15);

      const handleAdd = async () => {
        const name = addLabelInput.value.trim();
        if (!name) return;
        if (countCodepoints(name) > 15) {
          showNotification('Label name must not exceed 15 characters.', 'error');
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
          if (refreshCallback) refreshCallback();
          showNotification('Label created', 'success');
        } catch (err) {
          console.error(err);
          showNotification('Failed to create label', 'error');
        }
      };

      addLabelBtn.addEventListener('click', handleAdd);
      addLabelInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleAdd();
      });
    } else {
      const group = addLabelBtn.closest('.label-input-group');
      if (group) group.style.display = 'none';
    }
  }
}

export async function renderProjectSettingsView() {
  if (!projectSettingsContainer) return;

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
      const safeColor = /^#[0-9A-Fa-f]{6}$/.test(label.color) ? label.color : '#808080';
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
              if (refreshCallback) refreshCallback();
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
