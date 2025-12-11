import { state } from '../state.js';
import { updateIssue } from '../api.js';
import { draggedCard } from '../drag.js';

let refreshAppCallback = null;

export function renderPlanningPanel(refreshApp) {
  if (refreshApp) refreshAppCallback = refreshApp;

  const planningList = document.getElementById('planning-list');
  const planningCount = document.getElementById('planning-count');
  planningList.innerHTML = '';

  let count = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const getLocalISODate = (d) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Past
  planningList.appendChild(createPlanningDayElement('Past', 'past'));

  // Next 10 Days
  for (let i = 0; i < 10; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const dateStr = date.toLocaleDateString(navigator.language, { weekday: 'short', month: 'short', day: 'numeric' });
    const dateId = getLocalISODate(date);
    planningList.appendChild(createPlanningDayElement(dateStr, dateId));
  }

  // Populate
  state.issues.forEach(issue => {
    if (issue.planned_date) {
      const planned = new Date(issue.planned_date);
      let targetId;
      if (planned < today) {
        targetId = 'day-past';
      } else {
        targetId = `day-${getLocalISODate(planned)}`;
      }
      const container = document.getElementById(targetId);
      if (container) {
        container.querySelector('.planning-day-content').appendChild(createPlanningItem(issue));
        count++;
      }
    }
  });
  planningCount.textContent = count;

  document.querySelectorAll('.planning-day').forEach(day => {
    const content = day.querySelector('.planning-day-content');
    day.classList.toggle('empty', content.children.length === 0);
  });
}

function createPlanningDayElement(title, idSuffix) {
  const div = document.createElement('div');
  div.className = `planning-day ${idSuffix === 'past' ? 'past' : ''}`;
  div.id = `day-${idSuffix}`;
  div.dataset.date = idSuffix === 'past' ? 'past' : idSuffix;

  div.innerHTML = `
        <div class="planning-day-header">
            <span class="planning-date">${title}</span>
        </div>
        <div class="planning-day-content"></div>
    `;

  // Drop Logic
  div.addEventListener('dragover', (e) => {
    e.preventDefault();
    // Remove drag-over from others
    document.querySelectorAll('.planning-day').forEach(el => el.classList.remove('drag-over'));
    div.classList.add('drag-over');
  });
  div.addEventListener('dragleave', (e) => {
    if (!div.contains(e.relatedTarget)) div.classList.remove('drag-over');
  });
  div.addEventListener('drop', handlePlanningDrop);

  return div;
}

function createPlanningItem(issue) {
  const div = document.createElement('div');
  div.className = 'planning-item';
  div.textContent = issue.title;
  div.draggable = true;
  div.dataset.id = issue.id;
  div.addEventListener('dragstart', (e) => {
    import('../drag.js').then(d => {
      d.setDraggedCard(div);
      // planning item acts as a card proxy for basic dragging but has different class
    });
    div.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  div.addEventListener('dragend', () => {
    div.classList.remove('dragging');
    import('../drag.js').then(d => d.setDraggedCard(null));
  });

  // Hover highlight integration
  div.addEventListener('mouseenter', () => {
    const targetCard = document.querySelector(`.card[data-id="${issue.id}"]`);
    if (targetCard) targetCard.classList.add('hover-highlight');
  });
  div.addEventListener('mouseleave', () => {
    const targetCard = document.querySelector(`.card[data-id="${issue.id}"]`);
    if (targetCard) targetCard.classList.remove('hover-highlight');
  });

  return div;
}

async function handlePlanningDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  this.classList.remove('drag-over');
  const dateStr = this.dataset.date;

  if (draggedCard) {
    draggedCard.dataset.droppedInPlanning = 'true';
    const issueId = parseInt(draggedCard.dataset.id);
    const issue = state.issues.find(i => i.id === issueId);

    if (issue && dateStr !== 'past') {
      const [y, m, d] = dateStr.split('-').map(Number);
      const newDate = new Date(y, m - 1, d, 12, 0, 0, 0); // Noon to avoid timezone issues likely

      const oldDate = issue.planned_date ? new Date(issue.planned_date).setHours(12, 0, 0, 0) : 0;
      if (newDate.getTime() !== oldDate) {
        issue.planned_date = newDate;
        await updateIssue(issue);
        if (refreshAppCallback) refreshAppCallback();
      }
    }
  }
}
