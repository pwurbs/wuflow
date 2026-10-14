import { updateIssue, updateIssuePositions, archiveIssue } from './api.js';
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
    showSaveFailure(err, rerenderCallback, refreshCallback);
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
    showSaveFailure(err, rerenderCallback, refreshCallback);
  }
}

/**
 * Error path of every card move (reorder, drag to another list or section). The caller has
 * already put the old values back on the issues (saveIssueOrder does this for reorders), so
 * re-rendering moves the cards back right away, even when the server is unreachable. The
 * refresh then shows the actual server state.
 */
export function showSaveFailure(err, rerenderCallback, refreshCallback) {
  showNotification(err.message, 'error');
  if (rerenderCallback) rerenderCallback();
  if (refreshCallback) refreshCallback();
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
  const changes = [];
  orderedIssues.forEach((issue, index) => {
    if (issue.position !== index) {
      changes.push(applyOrderChange(issue, issue.status, index));
    }
  });

  if (changes.length > 0) {
    await saveIssueOrder(changes);
    if (rerenderCallback) rerenderCallback();
  }
}

/**
 * Sets an issue's new status and position for a reorder and returns the change for
 * saveIssueOrder, including the previous values so a failed save can restore them.
 */
export function applyOrderChange(issue, status, position) {
  const change = {
    issue,
    statusChanged: issue.status !== status,
    previous: { status: issue.status, position: issue.position }
  };
  issue.status = status;
  issue.position = position;
  return change;
}

/**
 * Saves a reorder. changes: from applyOrderChange. A status change is a content edit
 * (validated, recorded in the history), so it keeps the per-issue PUT; these run first, in
 * parallel. All other positions then go in one positions request, which the server applies
 * all-or-nothing and which never touches other fields.
 * If anything fails, every issue gets its previous status and position back before the
 * error is rethrown, so the caller only has to re-render. The positions request saved
 * nothing in that case; a status PUT that already went through is corrected by the
 * caller's refresh.
 */
export async function saveIssueOrder(changes) {
  try {
    await Promise.all(changes
      .filter(({ statusChanged }) => statusChanged)
      .map(({ issue }) => updateIssue(issue.project_id, issue)));
    const positions = changes
      .filter(({ statusChanged }) => !statusChanged)
      .map(({ issue }) => ({ id: issue.id, position: issue.position }));
    if (positions.length > 0) {
      await updateIssuePositions(changes[0].issue.project_id, positions);
    }
  } catch (err) {
    changes.forEach(({ issue, previous }) => {
      issue.status = previous.status;
      issue.position = previous.position;
    });
    throw err;
  }
}

/**
 * Applies a list's DOM order to the local issues and returns what must be saved:
 * `changes` for saveIssueOrder, plus the started archive requests (`archives`) for
 * cards that were dropped into the Archive list.
 */
export function getListUpdates(listId, targetStatus) {
  /** @type {{ changes: ReturnType<typeof applyOrderChange>[], archives: Promise<object>[] }} */
  const result = { changes: [], archives: [] };
  const listElement = document.getElementById(listId);
  if (!listElement) return result;

  const cards = [...listElement.querySelectorAll('.card')];
  cards.forEach((card, index) => {
    const id = Number.parseInt(card.dataset.id);
    const issue = state.issues.find(i => i.id === id);
    if (issue) {
      const statusChanged = issue.status !== targetStatus;
      const positionChanged = targetStatus !== STATUS_ARCHIVE && issue.position !== index;

      if (statusChanged || positionChanged) {
        if (targetStatus === STATUS_ARCHIVE) {
          issue.status = targetStatus;
          result.archives.push(archiveIssue(issue.project_id, issue.id));
        } else {
          result.changes.push(applyOrderChange(issue, targetStatus, index));
        }
      }
    }
  });
  return result;
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
    if (!getDraggedCard()?.classList.contains('card')) return;
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
    if (!draggedCard?.classList.contains('card')) return;

    const issueId = Number.parseInt(draggedCard.dataset.id);
    const issue = state.issues.find(i => i.id === issueId);
    if (!issue || issue.status === targetStatus) return;

    // Recorded before the first await: a drop between cards also reaches the list's own
    // drop handler, which may change the issue in the meantime.
    const previousStatus = issue.status;

    if (onValidate && !(await onValidate(issue, targetStatus))) {
      rerenderOrRefresh();
      return;
    }

    issue.status = targetStatus;
    try {
      if (targetStatus === STATUS_ARCHIVE) {
        await archiveIssue(issue.project_id, issue.id);
      } else {
        await updateIssue(issue.project_id, issue);
      }
      rerenderOrRefresh();
      if (onDrop) onDrop(issue);
    } catch (err) {
      issue.status = previousStatus;
      showSaveFailure(err, rerenderCallback, refreshApp);
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
    if (!draggedCard?.classList.contains('card')) return;

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
        const { changes, archives } = getListUpdates(listId, targetStatus);
        await Promise.all([...archives, saveIssueOrder(changes)]);
        rerenderOrRefresh();
      }
    } catch (err) {
      // A failed saveIssueOrder already restored the old order locally.
      showSaveFailure(err, rerenderCallback, refreshApp);
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
