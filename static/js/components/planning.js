import { state, isFilterActive } from '../state.js';
import { STATUS_DONE, STATUS_ARCHIVE } from '../status-config.js';
import { updateIssue } from '../api.js';
import { showNotification } from '../utils.js';
import { getDraggedCard, setDraggedCard } from '../drag.js';
import { userCan, ACTION_UPDATE_ISSUE } from '../permissions.js';
import { filterIssues } from '../filters.js';

let refreshAppCallback = null;
let openModalCallback = null;

export function getEffectiveDeadlineInfo(issue) {
  let minInfo = null;
  if (issue.deadline) {
    const d = new Date(issue.deadline);
    d.setHours(12, 0, 0, 0);
    minInfo = { date: d, isTask: false };
  }

  if (issue.tasks && issue.tasks.length > 0) {
    issue.tasks.forEach(task => {
      if (!task.done && task.deadline) {
        const taskDeadline = new Date(task.deadline);
        // Normalize time to noon to avoid timezone shift issues
        taskDeadline.setHours(12, 0, 0, 0);

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
  // Now: Issue is unscheduled if planned_dates is empty or null

  const filteredIssues = filterIssues(state.issues, state.filter, state.currentUser?.id);

  const unscheduledIssues = filteredIssues
    .filter(issue => {
      const info = getEffectiveDeadlineInfo(issue);
      const isUnscheduled = !issue.planned_dates || issue.planned_dates.length === 0;
      return info && isUnscheduled && issue.status !== STATUS_DONE && issue.status !== STATUS_ARCHIVE;
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
  const hasPastIssues = filteredIssues.some(issue => {
    if (!issue.planned_dates || issue.planned_dates.length === 0) return false;
    return issue.planned_dates.some(dateStr => {
      // Normalize strictly to avoid timezone issues?
      // planned_dates are YYYY-MM-DD. existing Date(str) works in UTC usually or Local?
      // safely:
      return new Date(dateStr) < today;
    });
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

  const hasFutureIssues = filteredIssues.some(issue => {
    if (!issue.planned_dates || issue.planned_dates.length === 0) return false;
    return issue.planned_dates.some(dateStr => {
      const planned = new Date(dateStr);
      planned.setHours(0, 0, 0, 0);
      return planned >= futureCutoff;
    });
  });

  if (hasFutureIssues) {
    planningList.appendChild(createPlanningDayElement('Future Planning', 'future'));
  }

  // Populate planned issues
  const addedPastIssues = new Set();
  const addedFutureIssues = new Set();

  filteredIssues.forEach(issue => {
    if (issue.planned_dates && issue.planned_dates.length > 0) {
      issue.planned_dates.forEach(dateStr => {
        const planned = new Date(dateStr);
        // Normalize
        planned.setHours(12, 0, 0, 0);

        let targetId;
        if (planned < today) {
          if (addedPastIssues.has(issue.id)) return;
          targetId = 'day-past';
          addedPastIssues.add(issue.id);
        } else if (planned >= futureCutoff) {
          if (addedFutureIssues.has(issue.id)) return;
          targetId = 'day-future';
          addedFutureIssues.add(issue.id);
        } else {
          targetId = `day-${dateStr}`;
        }

        const container = document.getElementById(targetId);
        if (container) {
          // Pass distinct dateStr so we know WHICH instance this is
          container.querySelector('.planning-day-content').appendChild(createPlanningItem(issue, dateStr));
          count++;
        }
      });
    }
  });

  planningCount.textContent = count;

  if (isFilterActive()) {
    let totalCount = 0;
    state.issues.forEach(issue => {
      if (issue.status !== STATUS_DONE && issue.status !== STATUS_ARCHIVE) {
        // Unscheduled: has deadline/subtask-deadline but no planned dates
        const info = getEffectiveDeadlineInfo(issue);
        const isUnscheduled = !issue.planned_dates || issue.planned_dates.length === 0;
        if (info && isUnscheduled) {
          totalCount++;
        }
        // Planned: count each planned date
        if (issue.planned_dates && issue.planned_dates.length > 0) {
          totalCount += issue.planned_dates.length;
        }
      }
    });
    planningCount.textContent = `${count}/${totalCount}`;
  }


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


export function createDeadlineBadge(issue, specificDateStr) {
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

  // Check if THIS specific planned instance is late
  if (specificDateStr) {
    const planned = new Date(specificDateStr);
    planned.setHours(0, 0, 0, 0);
    if (planned > d) {
      isWarning = true;
      tooltip = 'Planned late!';
    }
  } else if (issue.planned_dates && issue.planned_dates.length > 0) {
    // Fallback? Or maybe we don't warn if date is unknown?
    // Current behavior was: check latest.
    // Let's keep existing logic ONLY if specificDateStr is not provided (e.g. board view?)
    const sortedDates = [...issue.planned_dates].sort((a, b) => a.localeCompare(b));
    const lastPlan = new Date(sortedDates.at(-1));
    lastPlan.setHours(0, 0, 0, 0);

    if (lastPlan > d) {
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

function createAssigneeBadgeElement(issue) {
  if (!issue.assignee) return null;
  const initials = (issue.assignee.first_name ? issue.assignee.first_name.charAt(0) : '') +
    (issue.assignee.last_name ? issue.assignee.last_name.charAt(0) : '');
  const badge = document.createElement('span');
  badge.className = 'user-badge small';
  badge.style.marginRight = '1px';
  badge.style.display = 'inline-flex';
  badge.textContent = initials.toUpperCase() || '?';
  badge.title = `Assignee: ${issue.assignee.first_name} ${issue.assignee.last_name}`;
  return badge;
}

function createPlanningItem(issue, dateStr) {
  const div = document.createElement('div');
  div.className = `planning-item ${issue.status === STATUS_DONE ? 'done' : ''}`;
  div.draggable = true;
  div.dataset.id = issue.id;
  // Store the date of this specific instance
  div.dataset.dateInstance = dateStr;

  // Add Assignee Badge if assigned
  const assigneeBadge = createAssigneeBadgeElement(issue);
  if (assigneeBadge) {
    div.appendChild(assigneeBadge);
  }

  const titleSpan = document.createElement('span');
  titleSpan.className = 'planning-item-title';
  titleSpan.textContent = issue.title;

  div.appendChild(titleSpan);

  const badge = createDeadlineBadge(issue, dateStr);
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

    // Remove ONLY this date
    if (issue.planned_dates) {
      const prevDates = [...issue.planned_dates];
      if (!userCan(state.currentUser, ACTION_UPDATE_ISSUE)) return;
      issue.planned_dates = issue.planned_dates.filter(d => d !== dateStr);
      try {
        await updateIssue(issue);
        if (refreshAppCallback) refreshAppCallback();
      } catch (err) {
        issue.planned_dates = prevDates; // revert local state
        showNotification(err.message, 'error');
        if (refreshAppCallback) refreshAppCallback();
      }
    }
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
    e.dataTransfer.effectAllowed = 'copyMove'; // Allow either
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

let isFarTermUnscheduledExpanded = false;

function createUnscheduledSection(issues) {
  const section = document.createElement('div');
  section.className = 'planning-section-unscheduled';
  section.id = 'unscheduled-section';

  const header = document.createElement('div');
  header.className = 'planning-section-header';
  header.innerHTML = `<span class="planning-section-title">Unplanned Deadlines</span>`;
  section.appendChild(header);

  const content = document.createElement('div');
  content.className = 'planning-section-content';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tenDaysFromNow = new Date(today);
  tenDaysFromNow.setDate(today.getDate() + 10);

  const nearTermIssues = [];
  const farTermIssues = [];

  issues.forEach(issue => {
    const info = getEffectiveDeadlineInfo(issue);
    if (info?.date) {
      const deadline = new Date(info.date);
      deadline.setHours(0, 0, 0, 0);
      if (deadline > tenDaysFromNow) {
        farTermIssues.push(issue);
      } else {
        nearTermIssues.push(issue);
      }
    } else {
      // No effective deadline? Should theoretically not happen given filter in renderPlanningPanel
      nearTermIssues.push(issue);
    }
  });

  // Render Near Term
  nearTermIssues.forEach(issue => {
    content.appendChild(createUnscheduledItem(issue));
  });

  // Render Far Term if exists
  if (farTermIssues.length > 0) {
    const farHeader = document.createElement('div');
    farHeader.className = 'planning-section-subheader';
    farHeader.style.cursor = 'pointer';
    farHeader.style.marginTop = '8px';
    farHeader.style.userSelect = 'none';

    // Toggle icon (optional, or just text)
    const arrow = isFarTermUnscheduledExpanded ? '▼' : '▶';
    farHeader.innerHTML = `<span class="planning-section-subtitle">${arrow} 10+ days away [${farTermIssues.length}]</span>`;

    const farContent = document.createElement('div');
    farContent.className = 'planning-section-content far-term';
    farContent.style.marginTop = '4px';
    farContent.style.display = isFarTermUnscheduledExpanded ? 'flex' : 'none';

    farTermIssues.forEach(issue => {
      farContent.appendChild(createUnscheduledItem(issue));
    });

    farHeader.addEventListener('click', () => {
      isFarTermUnscheduledExpanded = !isFarTermUnscheduledExpanded;
      farContent.style.display = isFarTermUnscheduledExpanded ? 'flex' : 'none';
      const arrow = isFarTermUnscheduledExpanded ? '▼' : '▶';
      farHeader.querySelector('.planning-section-subtitle').innerHTML = `${arrow} 10+ days away [${farTermIssues.length}]`;
    });

    content.appendChild(farHeader);
    content.appendChild(farContent);
  }

  section.appendChild(content);

  return section;
}

function createUnscheduledItem(issue) {
  const div = document.createElement('div');
  div.className = 'planning-item unscheduled';
  div.draggable = true;
  div.dataset.id = issue.id;

  // Add Assignee Badge if assigned
  const assigneeBadge = createAssigneeBadgeElement(issue);
  if (assigneeBadge) {
    div.appendChild(assigneeBadge);
  }

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
  const targetDateStr = this.dataset.date;

  if (targetDateStr === 'past' || targetDateStr === 'future') return; // Cannot drop in past/future container generally

  const draggedCard = getDraggedCard();

  if (draggedCard) {
    draggedCard.dataset.droppedInPlanning = 'true';
    try {
      await processDroppedCard(draggedCard, targetDateStr);
    } catch (err) {
      showNotification(err.message, 'error');
      if (refreshAppCallback) refreshAppCallback(); // re-render to restore actual server state
    }
  }
}

export async function processDroppedCard(draggedCard, targetDateStr) {
  const issueId = Number.parseInt(draggedCard.dataset.id);
  const issue = state.issues.find(i => i.id === issueId);
  const sourceDateStr = draggedCard.dataset.dateInstance;

  if (issue) {
    if (!issue.planned_dates) issue.planned_dates = [];
    if (issue.planned_dates.includes(targetDateStr)) return;

    const newDates = [...issue.planned_dates];
    if (sourceDateStr) {
      const idx = newDates.indexOf(sourceDateStr);
      if (idx > -1) newDates.splice(idx, 1);
    }

    if (!userCan(state.currentUser, ACTION_UPDATE_ISSUE)) return;
    newDates.push(targetDateStr);
    newDates.sort((a, b) => a.localeCompare(b));
    issue.planned_dates = newDates;
    await updateIssue(issue);
    if (refreshAppCallback) refreshAppCallback();
  }
}
