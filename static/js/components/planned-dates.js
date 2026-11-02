import { state } from '../state.js';
import { showNotification } from '../utils.js';

export function getPlannedDatesFromDOM() {
  const container = document.getElementById('planned-dates-container');
  if (!container) return [];
  const chips = /** @type {NodeListOf<HTMLElement>} */ (container.querySelectorAll('.date-chip'));
  const dates = [];
  chips.forEach(chip => {
    dates.push(chip.dataset.date);
  });
  return dates;
}

// saveDates(getChanges, successMessage) saves the dates of the open issue and resolves to
// whether they were saved (unused for a new issue, whose dates are sent when it is created).
export function renderPlannedDateChips(issue, saveDates) {
  const container = document.getElementById('planned-dates-container');
  if (!container) return; // Ensure element exists in HTML

  container.innerHTML = '';

  const dates = issue?.planned_dates ? [...issue.planned_dates] : [];
  dates.sort((a, b) => a.localeCompare(b));

  dates.forEach(dateStr => {
    container.appendChild(createDateChip(dateStr, saveDates));
  });

  // Add Button
  const addBtn = document.createElement('div');
  addBtn.className = 'date-chip-add';
  addBtn.innerHTML = '+';
  addBtn.title = 'Add Date';

  // Hidden Date Input for picking
  const picker = document.createElement('input');
  picker.type = 'date';
  picker.id = 'planned-date-picker';
  picker.name = 'planned-date-picker';
  picker.style.position = 'absolute';
  picker.style.opacity = '0';
  picker.style.bottom = '0';
  picker.style.left = '0';
  picker.style.width = '0';
  picker.style.height = '0';

  addBtn.appendChild(picker);

  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (typeof picker.showPicker === 'function') {
      picker.showPicker();
    } else {
      picker.click();
    }
  });

  picker.addEventListener('change', async () => {
    if (picker.value) {
      await addPlannedDate(picker.value, saveDates);
      picker.value = ''; // Reset
    }
  });

  container.appendChild(addBtn);
}

function createDateChip(dateStr, saveDates) {
  const chip = document.createElement('div');
  chip.className = 'date-chip';
  chip.dataset.date = dateStr;

  const span = document.createElement('span');
  span.textContent = new Date(dateStr).toLocaleDateString(navigator.language, { month: 'numeric', day: 'numeric' });

  const remove = document.createElement('span');
  remove.className = 'remove';
  remove.innerHTML = '&times;';
  remove.addEventListener('click', async (e) => {
    e.stopPropagation();
    await removePlannedDate(dateStr, saveDates);
  });

  chip.appendChild(span);
  chip.appendChild(remove);

  return chip;
}

async function addPlannedDate(dateStr, saveDates) {
  // If editing existing issue
  if (state.currentIssue) {
    if (!(state.currentIssue.planned_dates || []).includes(dateStr)) {
      try {
        // The dates are computed when the save runs, so quick consecutive adds all persist.
        const saved = await saveDates(issue => ({
          planned_dates: [...new Set([...(issue.planned_dates || []), dateStr])]
            .sort((a, b) => a.localeCompare(b)),
        }), 'Date added');
        if (saved) renderPlannedDateChips(state.currentIssue, saveDates);
      } catch (err) {
        showNotification(err.message, 'error');
      }
    }
  } else {
    // New Issue mode
    const dates = getPlannedDatesFromDOM();
    // Check dupe
    if (!dates.includes(dateStr)) {
      dates.push(dateStr);
      dates.sort((a, b) => a.localeCompare(b));
      renderPlannedDateChips({ planned_dates: dates }, saveDates);
    }
  }
}

async function removePlannedDate(dateStr, saveDates) {
  if (state.currentIssue) {
    if (state.currentIssue.planned_dates) {
      try {
        const saved = await saveDates(issue => ({
          planned_dates: (issue.planned_dates || []).filter(d => d !== dateStr),
        }), 'Date removed');
        if (saved) renderPlannedDateChips(state.currentIssue, saveDates);
      } catch (err) {
        showNotification(err.message, 'error');
      }
    }
  } else {
    // New Issue mode
    const container = document.getElementById('planned-dates-container');
    const chip = container.querySelector(`.date-chip[data-date="${dateStr}"]`);
    if (chip) chip.remove();
  }
}
