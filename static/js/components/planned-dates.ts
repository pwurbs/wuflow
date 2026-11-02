import { state } from '../state.ts';
import { showNotification } from '../utils.ts';
import type { Issue } from '../models.ts';
import type { IssueWrite } from '../api.ts';

// Saves the dates of the open issue: getChanges(issue) computes them when the save runs.
// Resolves to whether they were saved.
export type SaveDates = (getChanges: (issue: Issue) => Pick<IssueWrite, 'planned_dates'>, successMessage: string) => Promise<boolean>;

export function getPlannedDatesFromDOM() {
  const container = document.getElementById('planned-dates-container');
  if (!container) return [];
  const chips = container.querySelectorAll<HTMLElement>('.date-chip');
  const dates: string[] = [];
  chips.forEach(chip => {
    dates.push(chip.dataset.date);
  });
  return dates;
}

// saveDates is unused for a new issue, whose dates are sent when it is created.
export function renderPlannedDateChips(issue: Pick<Issue, 'planned_dates'> | null, saveDates: SaveDates) {
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

function createDateChip(dateStr: string, saveDates: SaveDates) {
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

async function addPlannedDate(dateStr: string, saveDates: SaveDates) {
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

async function removePlannedDate(dateStr: string, saveDates: SaveDates) {
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
