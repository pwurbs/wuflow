import { state } from '../state.js';
import { updateIssue } from '../api.js';
import { getDraggedCard, setDraggedCard } from '../drag.js';

let refreshAppCallback = null;
let openModalCallback = null;

export function getEffectiveDeadlineInfo(issue) {
  let minInfo = issue.deadline ? { date: new Date(issue.deadline), isTask: false } : null;

  if (issue.tasks && issue.tasks.length > 0) {
    issue.tasks.forEach(task => {
      if (!task.done && task.deadline) {
        const taskDeadline = new Date(task.deadline);
        if (!minInfo || taskDeadline < minInfo.date) {
          minInfo = { date: taskDeadline, isTask: true };
        }
      }
    });
  }
  return minInfo;
}

export function renderPlanningPanel(refreshApp, openModal) {
  if (refreshApp) refreshAppCallback = refreshApp;
  if (openModal) openModalCallback = openModal;

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

  // Add Unscheduled section FIRST (at top) for issues with deadline (or subtask deadline) but no planned date
  const unscheduledIssues = state.issues
    .filter(issue => {
      const info = getEffectiveDeadlineInfo(issue);
      return info && !issue.planned_date && issue.status !== 'Done';
    })
    .sort((a, b) => {
      const infoA = getEffectiveDeadlineInfo(a);
      const infoB = getEffectiveDeadlineInfo(b);
      return (infoA ? infoA.date : 0) - (infoB ? infoB.date : 0);
    }); // Sort by effective deadline, tightest first

  if (unscheduledIssues.length > 0) {
    const unscheduledSection = createUnscheduledSection(unscheduledIssues);
    planningList.appendChild(unscheduledSection);
    count += unscheduledIssues.length;
  }

  // Past
  const hasPastIssues = state.issues.some(issue => {
    if (!issue.planned_date) return false;
    const planned = new Date(issue.planned_date);
    return planned < today;
  });

  if (hasPastIssues) {
    planningList.appendChild(createPlanningDayElement('Past Planning', 'past'));
  }

  // Next 10 Days
  for (let i = 0; i < 10; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const dateStr = date.toLocaleDateString(navigator.language, { weekday: 'short', month: 'short', day: 'numeric' });
    const dateId = getLocalISODate(date);
    planningList.appendChild(createPlanningDayElement(dateStr, dateId));
  }

  // Future Planning (for > 10 days)
  const futureCutoff = new Date(today);
  futureCutoff.setDate(today.getDate() + 10);

  const hasFutureIssues = state.issues.some(issue => {
    if (!issue.planned_date) return false;
    const planned = new Date(issue.planned_date);
    planned.setHours(0, 0, 0, 0); // normalize
    return planned >= futureCutoff;
  });

  if (hasFutureIssues) {
    planningList.appendChild(createPlanningDayElement('Future Planning', 'future'));
  }

  // Populate planned issues
  state.issues.forEach(issue => {
    if (issue.planned_date) {
      const planned = new Date(issue.planned_date);
      let targetId;
      if (planned < today) {
        targetId = 'day-past';
      } else if (planned >= futureCutoff) {
        targetId = 'day-future';
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

function formatDeadlineBadge(deadline) {
  const deadlineDate = new Date(deadline);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  deadlineDate.setHours(0, 0, 0, 0);

  const isOverdue = deadlineDate < today;
  const dateStr = new Date(deadline).toLocaleDateString(navigator.language, { weekday: 'short', month: 'short', day: 'numeric' });

  return { dateStr, isOverdue };
}


export function createDeadlineBadge(issue) {
  const effectiveInfo = getEffectiveDeadlineInfo(issue);
  if (!effectiveInfo) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(effectiveInfo.date);
  d.setHours(0, 0, 0, 0);

  let isWarning = d < today;
  let tooltip;

  if (isWarning) {
    tooltip = 'Overdue!';
  } else if (effectiveInfo.isTask) {
    tooltip = 'Task Deadline';
  } else {
    tooltip = 'Deadline';
  }

  if (issue.planned_date) {
    const planned = new Date(issue.planned_date);
    planned.setHours(0, 0, 0, 0);
    if (planned > d) {
      isWarning = true;
      tooltip = 'Planned late!';
    }
  }

  const badge = document.createElement('span');
  badge.className = `planning-item-deadline ${isWarning ? 'overdue' : ''}`;
  badge.innerHTML = `${isWarning ? '⚠️ ' : '⏰ '}${d.toLocaleDateString(navigator.language, { month: 'short', day: 'numeric' })}`;
  badge.title = tooltip;
  return badge;
}

function createPlanningItem(issue) {
  const div = document.createElement('div');
  div.className = `planning-item ${issue.status === 'Done' ? 'done' : ''}`;
  div.draggable = true;
  div.dataset.id = issue.id;

  const titleSpan = document.createElement('span');
  titleSpan.className = 'planning-item-title';
  titleSpan.textContent = issue.title;

  div.appendChild(titleSpan);

  const badge = createDeadlineBadge(issue);
  if (badge) {
    div.appendChild(badge);
  }

  const removeBtn = document.createElement('span');
  removeBtn.className = 'planning-item-remove';
  // Use SVG to match task delete icon
  removeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
  removeBtn.title = 'Remove from plan';

  removeBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    e.preventDefault();
    issue.planned_date = null;
    await updateIssue(issue);
    if (refreshAppCallback) refreshAppCallback();
  });

  div.appendChild(removeBtn);

  // Click to open modal
  div.addEventListener('click', () => {
    if (openModalCallback) openModalCallback(issue);
  });

  div.addEventListener('dragstart', (e) => {
    setDraggedCard(div);
    // planning item acts as a card proxy for basic dragging but has different class
    div.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  div.addEventListener('dragend', () => {
    div.classList.remove('dragging');
    setDraggedCard(null);
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

function createUnscheduledSection(issues) {
  const section = document.createElement('div');
  section.className = 'planning-section-unscheduled';
  section.id = 'unscheduled-section';

  const header = document.createElement('div');
  header.className = 'planning-section-header';
  header.innerHTML = `<span class="planning-section-title">Unscheduled Issues with Deadline</span>`;

  const content = document.createElement('div');
  content.className = 'planning-section-content';

  issues.forEach(issue => {
    content.appendChild(createUnscheduledItem(issue));
  });

  section.appendChild(header);
  section.appendChild(content);

  return section;
}

function createUnscheduledItem(issue) {
  const div = document.createElement('div');
  div.className = 'planning-item unscheduled';
  div.draggable = true;
  div.dataset.id = issue.id;

  const titleSpan = document.createElement('span');
  titleSpan.className = 'planning-item-title';
  titleSpan.textContent = issue.title;

  div.appendChild(titleSpan);

  // Add deadline badge
  // Add deadline badge (Effective Deadline)
  // Add deadline badge (Effective Deadline)
  const badge = createDeadlineBadge(issue);
  if (badge) {
    div.appendChild(badge);
  }

  // Click to open modal
  div.addEventListener('click', () => {
    if (openModalCallback) openModalCallback(issue);
  });

  div.addEventListener('dragstart', (e) => {
    setDraggedCard(div);
    div.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  div.addEventListener('dragend', () => {
    div.classList.remove('dragging');
    setDraggedCard(null);
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

  const draggedCard = getDraggedCard();

  if (draggedCard) {
    draggedCard.dataset.droppedInPlanning = 'true';
    const issueId = Number.parseInt(draggedCard.dataset.id);
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
