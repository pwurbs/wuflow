import { fetchLabels, createLabel, deleteLabel } from '../api.js';
import { showModalNotification, showConfirm } from '../utils.js';

let setupViewContainer = null;

export function setupSetupView(refreshCallback) {
  setupViewContainer = document.getElementById('setup-view');
  // Add event listener for adding a label
  const addLabelInput = document.getElementById('new-label-input');
  const addLabelBtn = document.getElementById('add-label-btn');

  if (addLabelBtn && addLabelInput) {
    // Function to handle adding label
    const handleAdd = async () => {
      const name = addLabelInput.value.trim();
      if (!name) return;

      try {
        // Fetch existing labels to check used colors
        const existingLabels = await fetchLabels();
        const usedColors = existingLabels.map(l => l.color);

        const color = getUnusedColor(usedColors);
        await createLabel({ name, color });
        addLabelInput.value = '';
        renderSetupView(refreshCallback); // Refresh list
        if (refreshCallback) refreshCallback(); // Refresh board/app
        showModalNotification('Label created', 'success');
      } catch (err) {
        console.error(err);
        showModalNotification('Failed to create label', 'error');
      }
    };

    addLabelBtn.addEventListener('click', handleAdd);
    addLabelInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleAdd();
    });
  }
}

export async function renderSetupView(refreshCallback) {
  if (!setupViewContainer) return;

  const labelsList = document.getElementById('labels-list');
  if (!labelsList) return;

  labelsList.innerHTML = '<div class="loader">Loading...</div>';

  try {
    const labels = await fetchLabels();
    labelsList.innerHTML = ''; // Clear loader

    if (labels.length === 0) {
      labelsList.innerHTML = '';
      return;
    }

    labels.forEach(label => {
      const labelEl = document.createElement('div');
      labelEl.className = 'label-item';
      // Match Board Style: Light BG, Border, Colored Text
      labelEl.style.backgroundColor = label.color + '20';
      labelEl.style.color = label.color;
      labelEl.style.border = `1px solid ${label.color}`;

      labelEl.innerHTML = `
                <span class="label-name">${label.name}</span>
                <button class="delete-label-btn" title="Delete Label">×</button>
            `;

      const deleteBtn = labelEl.querySelector('.delete-label-btn');
      deleteBtn.addEventListener('click', async () => {
        const confirmed = await showConfirm(
          'Delete Label',
          `Are you sure you want to delete the label "${label.name}"? This action cannot be undone.`
        );
        if (confirmed) {
          try {
            await deleteLabel(label.id);
            renderSetupView(refreshCallback); // Refresh
            if (refreshCallback) refreshCallback(); // Refresh board/app
            showModalNotification('Label deleted', 'success');
          } catch (err) {
            console.error(err);
            showModalNotification('Failed to delete label', 'error');
          }
        }
      });

      labelsList.appendChild(labelEl);
    });

  } catch (err) {
    console.error(err);
    labelsList.innerHTML = '<div class="error">Failed to load labels.</div>';
  }
}

function getUnusedColor(usedColors) {
  const colors = [
    '#EF5350', '#EC407A', '#AB47BC', '#7E57C2', '#5C6BC0',
    '#42A5F5', '#29B6F6', '#26C6DA', '#26A69A', '#66BB6A',
    '#9CCC65', '#D4E157', '#FFEE58', '#FFCA28', '#FFA726',
    '#FF7043', '#8D6E63', '#78909C'
  ];

  const availableColors = colors.filter(c => !usedColors.includes(c));

  if (availableColors.length > 0) {
    return availableColors[Math.floor(Math.random() * availableColors.length)];
  }

  // Fallback: if all colors used, pick random from full list
  return colors[Math.floor(Math.random() * colors.length)];
}

// Simple helper to check if color is light or dark (for text contrast)
function isLight(color) {
  const hex = color.replaceAll('#', '');
  const r = Number.parseInt(hex.substr(0, 2), 16);
  const g = Number.parseInt(hex.substr(2, 2), 16);
  const b = Number.parseInt(hex.substr(4, 2), 16);
  const brightness = ((r * 299) + (g * 587) + (b * 114)) / 1000;
  return brightness > 155;
}
