import { state, isFilterActive } from '../state.ts';
import { STATUS_DONE, STATUS_ARCHIVE } from '../status-config.ts';
import { updateIssue } from '../api.ts';
import { showNotification, byId, bySelector, errorMessage, containsTarget, getDeadlineStatus, getTaskDeadlineStatus, startOfDay, localISODate } from '../utils.ts';
import { getDraggedCard, setDraggedCard } from '../drag.ts';
import { userCan, ACTION_UPDATE_ISSUE } from '../permissions.ts';
import { filterIssues } from '../filters.ts';
import type { Issue } from '../models.ts';
import type { OpenModal, RefreshApp, RerenderView } from '../list-utils.ts';

let refreshAppCallback: RefreshApp | undefined;
let openModalCallback: OpenModal | undefined;
let rerenderActiveViewCallback: RerenderView | undefined;

export function setupPlanningPanel(refreshApp?: RefreshApp, openModal?: OpenModal, rerenderActiveView?: RerenderView) {
  if (refreshApp) refreshAppCallback = refreshApp;
  if (openModal) openModalCallback = openModal;
  if (rerenderActiveView) rerenderActiveViewCallback = rerenderActiveView;
}

export function getEffectiveDeadlineInfo(issue: Issue) {
  let minInfo: { date: Date; isTask: boolean } | null = null;
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

// How a planning list differs between the project board (default) and My Work.
export interface PlanningListOptions {
  // No drag & drop, no drop targets, no remove buttons, no element IDs.
  readOnly?: boolean;
  // The element shown before an item's title (board: assignee badge).
  itemLead?: (issue: Issue) => HTMLElement | null;
  // A second line under the title (My Work: project name).
  itemSubline?: (issue: Issue) => HTMLElement;
  openModal?: OpenModal;
}

export function renderPlanningPanel(refreshApp?: RefreshApp, openModal?: OpenModal, rerenderActiveView?: RerenderView) {
  if (refreshApp) refreshAppCallback = refreshApp;
  if (openModal) openModalCallback = openModal;
  if (rerenderActiveView) rerenderActiveViewCallback = rerenderActiveView;

  const planningCount = byId('planning-count');
  const filteredIssues = filterIssues(state.issues, state.filter, state.currentUser?.id);
  const count = buildPlanningList(byId('planning-list'), filteredIssues, {
    itemLead: createAssigneeBadgeElement,
    openModal: (issue) => openModalCallback?.(issue),
  });

  planningCount.textContent = isFilterActive() ? `${count}/${countPlanningEntries(state.issues)}` : String(count);
}

// The total behind "shown/total" while a filter is active: the planning entries of all
// given issues except Done and Archive.
export function countPlanningEntries(issues: Issue[]) {
  let totalCount = 0;
  issues.forEach(issue => {
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
  return totalCount;
}

/**
 * Fills planningList with the planning of the given issues (Unplanned Deadlines, Past
 * Planning, the next 10 days, Future Planning) and returns the number of items shown.
 */
export function buildPlanningList(planningList: HTMLElement, filteredIssues: Issue[], opts: PlanningListOptions = {}) {
  planningList.innerHTML = '';

  let count = 0;
  const today = startOfDay(new Date());

  // Day containers by key ('past', 'future' or YYYY-MM-DD), looked up here instead of by
  // document-wide ID because the board and My Work lists are in the DOM at the same time.
  const days = new Map<string, HTMLElement>();
  const addDay = (title: string, key: string) => {
    const day = createPlanningDayElement(title, key, opts.readOnly ?? false);
    days.set(key, day);
    planningList.appendChild(day);
  };

  // Add Unscheduled section FIRST (at top) for issues with deadline (or subtask deadline) but no planned date
  // Now: Issue is unscheduled if planned_dates is empty or null

  const unscheduledIssues = filteredIssues
    .filter(issue => {
      const info = getEffectiveDeadlineInfo(issue);
      const isUnscheduled = !issue.planned_dates || issue.planned_dates.length === 0;
      return info && isUnscheduled && issue.status !== STATUS_DONE && issue.status !== STATUS_ARCHIVE;
    })
    .sort((a, b) => {
      const infoA = getEffectiveDeadlineInfo(a);
      const infoB = getEffectiveDeadlineInfo(b);
      return (infoA ? infoA.date.getTime() : 0) - (infoB ? infoB.date.getTime() : 0);
    }); // Sort by effective deadline, tightest first

  if (unscheduledIssues.length > 0) {
    const unscheduledSection = createUnscheduledSection(unscheduledIssues, opts);
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
    addDay('Past Planning', 'past');
  }

  // Next 10 Days
  for (let i = 0; i < 10; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const dateStr = date.toLocaleDateString(navigator.language, { weekday: 'short', month: 'short', day: 'numeric' });
    const dateId = localISODate(date);
    addDay(dateStr, dateId);
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
    addDay('Future Planning', 'future');
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

        let targetKey;
        if (planned < today) {
          if (addedPastIssues.has(issue.id)) return;
          targetKey = 'past';
          addedPastIssues.add(issue.id);
        } else if (planned >= futureCutoff) {
          if (addedFutureIssues.has(issue.id)) return;
          targetKey = 'future';
          addedFutureIssues.add(issue.id);
        } else {
          targetKey = dateStr;
        }

        // Day columns are rendered per date, so a date's column may not exist.
        const container = days.get(targetKey);
        if (container) {
          // Pass distinct dateStr so we know WHICH instance this is
          bySelector(container, '.planning-day-content').appendChild(createPlanningItem(issue, dateStr, opts));
          count++;
        }
      });
    }
  });

  planningList.querySelectorAll('.planning-day').forEach(day => {
    const content = bySelector(day, '.planning-day-content');
    day.classList.toggle('empty', content.children.length === 0);
  });

  return count;
}

function createPlanningDayElement(title: string, idSuffix: string, readOnly: boolean) {
  const div = document.createElement('div');
  div.className = `planning-day ${idSuffix === 'past' ? 'past' : ''}`;
  if (!readOnly) div.id = `day-${idSuffix}`;
  div.dataset.date = idSuffix === 'past' ? 'past' : idSuffix;

  div.innerHTML = `
        <div class="planning-day-header">
            <span class="planning-date">${title}</span>
        </div>
        <div class="planning-day-content"></div>
    `;
  if (readOnly) return div;

  // Drop Logic
  div.addEventListener('dragover', (e) => {
    e.preventDefault();
    // Remove drag-over from others
    document.querySelectorAll('.planning-day').forEach(el => el.classList.remove('drag-over'));
    div.classList.add('drag-over');
  });
  div.addEventListener('dragleave', (e) => {
    if (!containsTarget(div, e.relatedTarget)) div.classList.remove('drag-over');
  });
  div.addEventListener('drop', handlePlanningDrop);

  return div;
}

export function createDeadlineBadge(issue: Issue, specificDateStr?: string) {
  const effectiveInfo = getEffectiveDeadlineInfo(issue);
  if (!effectiveInfo) return null;

  const d = startOfDay(effectiveInfo.date);

  const status = effectiveInfo.isTask
    ? getTaskDeadlineStatus(effectiveInfo.date, issue)
    : getDeadlineStatus(issue);
  const plannedLate = isPlannedLate(issue, d, specificDateStr);
  const isWarning = status.late || plannedLate;
  let tooltip = effectiveInfo.isTask ? 'Task Deadline' : 'Deadline';
  if (plannedLate) tooltip = 'Planned late!';
  else if (status.late) tooltip = status.reason;

  const badge = document.createElement('span');
  badge.className = `planning-item-deadline ${isWarning ? 'overdue' : ''}`;
  badge.textContent = d.toLocaleDateString(navigator.language, { month: 'short', day: 'numeric' });
  badge.title = tooltip;
  return badge;
}

// Whether the given planned date, or without one the issue's latest planned date, is after the deadline.
function isPlannedLate(issue: Issue, deadline: Date, specificDateStr?: string) {
  const plannedStr = specificDateStr ?? [...(issue.planned_dates ?? [])].sort((a, b) => b.localeCompare(a))[0];
  if (!plannedStr) return false;
  return startOfDay(plannedStr) > deadline;
}

function createAssigneeBadgeElement(issue: Issue) {
  if (!issue.assignee) return null;
  const initials = (issue.assignee.first_name ? issue.assignee.first_name.charAt(0) : '') +
    (issue.assignee.last_name ? issue.assignee.last_name.charAt(0) : '');
  const badge = document.createElement('span');
  badge.className = 'user-badge';
  badge.style.marginRight = '1px';
  badge.style.display = 'inline-flex';
  badge.textContent = initials.toUpperCase() || '?';
  badge.title = `Assignee: ${issue.assignee.first_name} ${issue.assignee.last_name}`;
  return badge;
}

// The parts planned and unplanned items share: lead element, title, click, drag source
// (unless read-only) and the hover link to the issue's card.
function createItemBase(issue: Issue, className: string, opts: PlanningListOptions, effectAllowed: DataTransfer['effectAllowed']) {
  const div = document.createElement('div');
  div.className = className;
  div.classList.toggle('read-only', opts.readOnly ?? false);
  div.draggable = !opts.readOnly;
  div.dataset.id = String(issue.id);

  const lead = opts.itemLead?.(issue);
  if (lead) {
    div.appendChild(lead);
  }

  const titleSpan = document.createElement('span');
  titleSpan.className = 'planning-item-title';
  titleSpan.textContent = issue.title;
  if (opts.itemSubline) {
    const text = document.createElement('div');
    text.className = 'planning-item-text';
    text.append(titleSpan, opts.itemSubline(issue));
    div.appendChild(text);
  } else {
    div.appendChild(titleSpan);
  }

  // Click to open modal
  div.addEventListener('click', () => {
    opts.openModal?.(issue);
  });

  if (!opts.readOnly) {
    div.addEventListener('dragstart', (e) => {
      setDraggedCard(div);
      // planning item acts as a card proxy for basic dragging but has different class
      div.classList.add('dragging');
      if (e.dataTransfer) e.dataTransfer.effectAllowed = effectAllowed;
    });
    div.addEventListener('dragend', () => {
      div.classList.remove('dragging');
      setDraggedCard(null);
    });
  }

  // Hover highlight integration. All matches: the hidden board can hold a card with the same ID.
  div.addEventListener('mouseenter', () => {
    document.querySelectorAll(`.card[data-id="${issue.id}"]`).forEach(el => el.classList.add('hover-highlight'));
  });
  div.addEventListener('mouseleave', () => {
    document.querySelectorAll(`.card[data-id="${issue.id}"]`).forEach(el => el.classList.remove('hover-highlight'));
  });

  return div;
}

function createPlanningItem(issue: Issue, dateStr: string, opts: PlanningListOptions) {
  const div = createItemBase(issue, `planning-item ${issue.status === STATUS_DONE ? 'done' : ''}`, opts, 'copyMove');
  // Store the date of this specific instance
  div.dataset.dateInstance = dateStr;

  const badge = createDeadlineBadge(issue, dateStr);
  if (badge) {
    div.appendChild(badge);
  }
  if (opts.readOnly) return div;

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
        await updateIssue(issue.project_id, issue);
        if (rerenderActiveViewCallback) rerenderActiveViewCallback();
      } catch (err) {
        issue.planned_dates = prevDates; // already reverted locally, no need for a full re-fetch
        showNotification(errorMessage(err), 'error');
        if (rerenderActiveViewCallback) rerenderActiveViewCallback();
      }
    }
  });

  div.appendChild(removeBtn);
  return div;
}

let isFarTermUnscheduledExpanded = false;

function createUnscheduledSection(issues: Issue[], opts: PlanningListOptions) {
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

  const nearTermIssues: Issue[] = [];
  const farTermIssues: Issue[] = [];

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
    content.appendChild(createUnscheduledItem(issue, opts));
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
      farContent.appendChild(createUnscheduledItem(issue, opts));
    });

    farHeader.addEventListener('click', () => {
      isFarTermUnscheduledExpanded = !isFarTermUnscheduledExpanded;
      farContent.style.display = isFarTermUnscheduledExpanded ? 'flex' : 'none';
      const arrow = isFarTermUnscheduledExpanded ? '▼' : '▶';
      bySelector(farHeader, '.planning-section-subtitle').innerHTML = `${arrow} 10+ days away [${farTermIssues.length}]`;
    });

    content.appendChild(farHeader);
    content.appendChild(farContent);
  }

  section.appendChild(content);

  return section;
}

function createUnscheduledItem(issue: Issue, opts: PlanningListOptions) {
  const div = createItemBase(issue, 'planning-item unscheduled', opts, 'move');

  // Add deadline badge (Effective Deadline)
  const badge = createDeadlineBadge(issue);
  if (badge) {
    div.appendChild(badge);
  }
  return div;
}

async function handlePlanningDrop(this: HTMLElement, e: DragEvent) {
  e.preventDefault();
  e.stopPropagation();
  this.classList.remove('drag-over');
  const targetDateStr = this.dataset.date;

  if (!targetDateStr || targetDateStr === 'past' || targetDateStr === 'future') return; // Cannot drop in past/future container generally

  const draggedCard = getDraggedCard();

  if (draggedCard) {
    draggedCard.dataset.droppedInPlanning = 'true';
    try {
      await processDroppedCard(draggedCard, targetDateStr);
    } catch (err) {
      showNotification(errorMessage(err), 'error');
      if (refreshAppCallback) refreshAppCallback(); // re-render to restore actual server state
    }
  }
}

export async function processDroppedCard(draggedCard: HTMLElement, targetDateStr: string) {
  const issueId = Number(draggedCard.dataset.id);
  const issue = state.issues.find(i => i.id === issueId);
  const sourceDateStr = draggedCard.dataset.dateInstance;

  if (issue) {
    issue.planned_dates ??= [];
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
    await updateIssue(issue.project_id, issue);
    if (rerenderActiveViewCallback) rerenderActiveViewCallback();
  }
}
