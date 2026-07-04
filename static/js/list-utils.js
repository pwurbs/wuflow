import { updateIssue, archiveIssue } from './api.js';
import { state } from './state.js';
import { PRIORITY_NORMAL, PRIORITY_HIGH } from './domain-constants.js';
import { STATUS_ARCHIVE } from './status-config.js';
import { getDraggedCard, getDraggedCardOrigin, getDragAfterElement } from './drag.js';
import { showNotification } from './utils.js';

function createRerenderOrRefresh(rerenderCallback, refreshApp) {
  return () => { if (rerenderCallback) rerenderCallback(); else if (refreshApp) refreshApp(); };
}

export async function handleMoveTop(issue, allIssuesInList, rerenderCallback, refreshCallback) {
  if (allIssuesInList.length <= 1 || allIssuesInList[0].id === issue.id) return;

  // Create a new array without the issue
  const otherIssues = allIssuesInList.filter(i => i.id !== issue.id);
  // Add the issue to the beginning
  const newOrder = [issue, ...otherIssues];

  try {
    await updatePositions(newOrder, rerenderCallback);
  } catch (err) {
    showNotification(err.message, 'error');
    // A partial Promise.all failure can't be safely reverted locally (some positions
    // may have already persisted server-side), so re-fetch the actual server state.
    if (refreshCallback) refreshCallback();
  }
}

export async function handleMoveBottom(issue, allIssuesInList, rerenderCallback, refreshCallback) {
  if (allIssuesInList.length <= 1 || allIssuesInList[allIssuesInList.length - 1].id === issue.id) return;

  // Create a new array without the issue
  const otherIssues = allIssuesInList.filter(i => i.id !== issue.id);
  // Add the issue to the end
  const newOrder = [...otherIssues, issue];

  try {
    await updatePositions(newOrder, rerenderCallback);
  } catch (err) {
    showNotification(err.message, 'error');
    if (refreshCallback) refreshCallback();
  }
}

export async function handleTogglePriority(issue, rerenderCallback) {
  const originalPriority = issue.priority;
  issue.priority = issue.priority === PRIORITY_HIGH ? PRIORITY_NORMAL : PRIORITY_HIGH;
  try {
    await updateIssue(issue.project_id, issue);
    if (rerenderCallback) rerenderCallback();
  } catch (err) {
    issue.priority = originalPriority; // already reverted locally, no need for a full re-fetch
    showNotification(err.message, 'error');
    if (rerenderCallback) rerenderCallback();
  }
}

export async function handleAssignToMe(issue, currentUser, rerenderCallback) {
  const originalAssigneeId = issue.assignee_id;
  const originalAssignee = issue.assignee;
  issue.assignee_id = currentUser.id;
  issue.assignee = currentUser;
  try {
    await updateIssue(issue.project_id, issue);
    if (rerenderCallback) rerenderCallback();
  } catch (err) {
    issue.assignee_id = originalAssigneeId;
    issue.assignee = originalAssignee; // already reverted locally, no need for a full re-fetch
    showNotification(err.message, 'error');
    if (rerenderCallback) rerenderCallback();
  }
}

export async function updatePositions(orderedIssues, rerenderCallback) {
  const updates = [];
  orderedIssues.forEach((issue, index) => {
    if (issue.position !== index) {
      issue.position = index;
      updates.push(updateIssue(issue.project_id, issue));
    }
  });

  if (updates.length > 0) {
    await Promise.all(updates);
    if (rerenderCallback) rerenderCallback();
  }
}

export function getListUpdates(listId, targetStatus) {
  const listElement = document.getElementById(listId);
  if (!listElement) return [];

  const cards = [...listElement.querySelectorAll('.card')];
  const updates = [];
  cards.forEach((card, index) => {
    const id = Number.parseInt(card.dataset.id);
    const issue = state.issues.find(i => i.id === id);
    if (issue) {
      const statusChanged = issue.status !== targetStatus;
      const positionChanged = targetStatus !== STATUS_ARCHIVE && issue.position !== index;

      if (statusChanged || positionChanged) {
        issue.status = targetStatus;
        if (targetStatus === STATUS_ARCHIVE) {
          updates.push(archiveIssue(issue.project_id, issue.id));
        } else {
          issue.position = index;
          updates.push(updateIssue(issue.project_id, issue));
        }
      }
    }
  });
  return updates;
}

/**
 * Shared logic for section-level drop zones (e.g., dropping onto the column background)
 */
export function setupSectionDrop(sectionId, targetStatus, options = {}) {
  const section = document.getElementById(sectionId);
  if (!section) return;

  const list = section.querySelector('.backlog-list');
  const { onDrop, onValidate, refreshApp, rerenderCallback, showDragHighlight = true } = options;
  const rerenderOrRefresh = createRerenderOrRefresh(rerenderCallback, refreshApp);

  section.addEventListener('dragover', (e) => {
    if (section.offsetParent === null) return;
    const draggedCard = getDraggedCard();
    const isValidCard = draggedCard?.classList.contains('planning-item') || draggedCard?.classList.contains('card');
    if (!isValidCard) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (list && showDragHighlight) list.classList.add('drag-over');
  });

  section.addEventListener('dragleave', (e) => {
    if (!section.contains(e.relatedTarget) && list) {
      list.classList.remove('drag-over');
      const draggedCard = getDraggedCard();
      const origin = getDraggedCardOrigin();
      if (draggedCard && origin?.parent) {
        origin.parent.insertBefore(draggedCard, origin.nextSibling ?? null);
      }
    }
  });

  section.addEventListener('drop', async (e) => {
    if (section.offsetParent === null) return;
    e.preventDefault();
    if (list) list.classList.remove('drag-over');

    const draggedCard = getDraggedCard();
    const isValidCard = draggedCard?.classList.contains('planning-item') || draggedCard?.classList.contains('card');
    if (!isValidCard) return;

    const issueId = Number.parseInt(draggedCard.dataset.id);
    const issue = state.issues.find(i => i.id === issueId);
    if (!issue || issue.status === targetStatus) return;

    if (onValidate && !(await onValidate(issue, targetStatus))) {
      rerenderOrRefresh();
      return;
    }

    issue.status = targetStatus;
    try {
      if (targetStatus === STATUS_ARCHIVE) {
        await archiveIssue(issue.project_id, issue.id);
      } else {
        issue.planned_dates = [];
        await updateIssue(issue.project_id, issue);
      }
      rerenderOrRefresh();
      if (onDrop) onDrop(issue);
    } catch (err) {
      showNotification(err.message, 'error');
      // No local revert here, so fall back to the full refresh to resync with the server.
      if (refreshApp) refreshApp();
    }
  });
}

/**
 * Shared logic for list-level drag zones (e.g., dropping directly into a list for reordering)
 */
export function setupListDrag(listId, targetStatus, options = {}) {
  const list = document.getElementById(listId);
  if (!list) return;

  const { onDrop, onValidate, refreshApp, rerenderCallback, performReorder = true, showDragHighlight = true } = options;
  const rerenderOrRefresh = createRerenderOrRefresh(rerenderCallback, refreshApp);

  list.addEventListener('dragover', (e) => {
    if (list.offsetParent === null) return;
    const draggedCard = getDraggedCard();
    if (!draggedCard?.classList.contains('card') && !draggedCard?.classList.contains('planning-item')) return;

    e.preventDefault();
    if (showDragHighlight) list.classList.add('drag-over');

    if (performReorder) {
      const afterElement = getDragAfterElement(list, e.clientY);
      if (afterElement == null) {
        list.appendChild(draggedCard);
      } else {
        afterElement.before(draggedCard);
      }
    }
  });

  list.addEventListener('dragleave', (e) => {
    if (!list.contains(e.relatedTarget)) {
      list.classList.remove('drag-over');
    }
  });

  list.addEventListener('drop', async (e) => {
    if (list.offsetParent === null) return;
    e.preventDefault();
    list.classList.remove('drag-over');

    const draggedCard = getDraggedCard();
    if (!draggedCard) return;

    const issueId = Number.parseInt(draggedCard.dataset.id);
    const issue = state.issues.find(i => i.id === issueId);

    if (onValidate && !(await onValidate(issue, targetStatus))) {
      rerenderOrRefresh();
      return;
    }

    try {
      if (onDrop) {
        await onDrop(issue, targetStatus);
      } else {
        const updates = getListUpdates(listId, targetStatus);
        await Promise.all(updates);
        rerenderOrRefresh();
      }
    } catch (err) {
      showNotification(err.message, 'error');
      // No local revert here, so fall back to the full refresh to resync with the server.
      if (refreshApp) refreshApp();
    }
  });
}

export function sortReleasesByDate(releases) {
  return releases.slice().sort((a, b) => {
    const da = a.release_date ? new Date(a.release_date) : null;
    const db = b.release_date ? new Date(b.release_date) : null;
    if (da && db) return da - db;
    if (da) return -1;
    if (db) return 1;
    return new Date(a.created_at) - new Date(b.created_at);
  });
}
