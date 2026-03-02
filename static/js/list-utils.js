import { updateIssue, archiveIssue } from './api.js';
import { state } from './state.js';
import { getDraggedCard, getDragAfterElement } from './drag.js';
import { showNotification } from './utils.js';

export async function handleMoveTop(issue, allIssuesInList, refreshCallback) {
  if (allIssuesInList.length <= 1 || allIssuesInList[0].id === issue.id) return;

  // Create a new array without the issue
  const otherIssues = allIssuesInList.filter(i => i.id !== issue.id);
  // Add the issue to the beginning
  const newOrder = [issue, ...otherIssues];

  try {
    await updatePositions(newOrder, refreshCallback);
  } catch (err) {
    showNotification(err.message, 'error');
    if (refreshCallback) refreshCallback(); // re-render to restore actual server state
  }
}

export async function handleMoveBottom(issue, allIssuesInList, refreshCallback) {
  if (allIssuesInList.length <= 1 || allIssuesInList[allIssuesInList.length - 1].id === issue.id) return;

  // Create a new array without the issue
  const otherIssues = allIssuesInList.filter(i => i.id !== issue.id);
  // Add the issue to the end
  const newOrder = [...otherIssues, issue];

  try {
    await updatePositions(newOrder, refreshCallback);
  } catch (err) {
    showNotification(err.message, 'error');
    if (refreshCallback) refreshCallback(); // re-render to restore actual server state
  }
}

export async function updatePositions(orderedIssues, refreshCallback) {
  const updates = [];
  orderedIssues.forEach((issue, index) => {
    if (issue.position !== index) {
      issue.position = index;
      updates.push(updateIssue(issue));
    }
  });

  if (updates.length > 0) {
    await Promise.all(updates);
    if (refreshCallback) refreshCallback();
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
      const positionChanged = targetStatus !== 'Archive' && issue.position !== index;

      if (statusChanged || positionChanged) {
        issue.status = targetStatus;
        if (targetStatus === 'Archive') {
          updates.push(archiveIssue(issue.id));
        } else {
          issue.position = index;
          updates.push(updateIssue(issue));
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
  const { onDrop, onValidate, refreshApp, showDragHighlight = true } = options;

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
      if (refreshApp) refreshApp();
      return;
    }

    issue.status = targetStatus;
    try {
      if (targetStatus === 'Archive') {
        await archiveIssue(issue.id);
      } else {
        issue.planned_dates = [];
        await updateIssue(issue);
      }
      if (refreshApp) refreshApp();
      if (onDrop) onDrop(issue);
    } catch (err) {
      showNotification(err.message, 'error');
      if (refreshApp) refreshApp(); // re-render to restore actual server state
    }
  });
}

/**
 * Shared logic for list-level drag zones (e.g., dropping directly into a list for reordering)
 */
export function setupListDrag(listId, targetStatus, options = {}) {
  const list = document.getElementById(listId);
  if (!list) return;

  const { onDrop, onValidate, refreshApp, performReorder = true, showDragHighlight = true } = options;

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
      if (refreshApp) refreshApp();
      return;
    }

    try {
      if (onDrop) {
        await onDrop(issue, targetStatus);
      } else {
        const updates = getListUpdates(listId, targetStatus);
        await Promise.all(updates);
        if (refreshApp) refreshApp();
      }
    } catch (err) {
      showNotification(err.message, 'error');
      if (refreshApp) refreshApp(); // re-render to restore actual server state
    }
  });
}
