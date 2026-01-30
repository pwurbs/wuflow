import { state } from '../state.js';
import { updateIssue } from '../api.js';
import { createCardElement } from './card.js';
import { getDraggedCard, getDragAfterElement } from '../drag.js';
import { filterIssues, filterByStatus, sortByPosition } from '../filters.js';

let refreshAppCallback = null;
let openModalCallback = null;

export function renderBacklog(refreshApp, openModal) {
  if (refreshApp) refreshAppCallback = refreshApp;
  if (openModal) openModalCallback = openModal;

  const backlogList = document.getElementById('backlog-list');
  const moveToTodoList = document.getElementById('move-to-todo-list');
  const backlogCount = document.getElementById('backlog-count');
  const todoCount = document.getElementById('todo-count');

  // Clear
  backlogList.innerHTML = '';
  moveToTodoList.innerHTML = '';

  // Filter and sort issues using extracted pure functions
  const filteredIssues = filterIssues(state.issues, state.filter);
  const openIssues = sortByPosition(filterByStatus(filteredIssues, 'Open'));
  const todoIssues = sortByPosition(filterByStatus(filteredIssues, 'Todo'));

  openIssues.forEach(issue => {
    backlogList.appendChild(createCardElement(issue, false, {
      openModal: openModalCallback,
      onMoveTop: () => handleMoveTop(issue, openIssues),
      onMoveBottom: () => handleMoveBottom(issue, openIssues)
    }));
  });
  todoIssues.forEach(issue => {
    moveToTodoList.appendChild(createCardElement(issue, false, {
      openModal: openModalCallback,
      onMoveTop: () => handleMoveTop(issue, todoIssues),
      onMoveBottom: () => handleMoveBottom(issue, todoIssues)
    }));
  });

  backlogCount.textContent = openIssues.length;
  todoCount.textContent = todoIssues.length;
}

async function handleMoveTop(issue, allIssuesInList) {
  if (allIssuesInList.length <= 1 || allIssuesInList[0].id === issue.id) return;

  // Create a new array without the issue
  const otherIssues = allIssuesInList.filter(i => i.id !== issue.id);
  // Add the issue to the beginning
  const newOrder = [issue, ...otherIssues];

  await updatePositions(newOrder);
}

async function handleMoveBottom(issue, allIssuesInList) {
  if (allIssuesInList.length <= 1 || allIssuesInList[allIssuesInList.length - 1].id === issue.id) return;

  // Create a new array without the issue
  const otherIssues = allIssuesInList.filter(i => i.id !== issue.id);
  // Add the issue to the end
  const newOrder = [...otherIssues, issue];

  await updatePositions(newOrder);
}

async function updatePositions(orderedIssues) {
  const updates = [];
  orderedIssues.forEach((issue, index) => {
    if (issue.position !== index) {
      issue.position = index;
      updates.push(updateIssue(issue));
    }
  });

  if (updates.length > 0) {
    await Promise.all(updates);
    if (refreshAppCallback) refreshAppCallback();
  }
}

export function setupBacklogView(refreshApp, openModal) {
  if (refreshApp) refreshAppCallback = refreshApp;
  if (openModal) openModalCallback = openModal;

  // Backlog Sections Drag Support (for dropping planning items on background)
  const setupSectionDrop = (id, targetStatus) => {
    const section = document.getElementById(id);
    if (!section) return;

    section.addEventListener('dragover', (e) => {
      const draggedCard = getDraggedCard();
      if (!draggedCard?.classList.contains('planning-item')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });

    section.addEventListener('drop', async (e) => {
      e.preventDefault();
      const draggedCard = getDraggedCard();
      if (!draggedCard?.classList.contains('planning-item')) return;
      const issueId = Number.parseInt(draggedCard.dataset.id);
      const issue = state.issues.find(i => i.id === issueId);
      if (issue) {
        issue.planned_date = null;
        issue.status = targetStatus;
        await updateIssue(issue);
        if (refreshAppCallback) refreshAppCallback();
      }
    });
  };

  setupSectionDrop('backlog-open-section', 'Open');
  setupSectionDrop('backlog-todo-section', 'Todo');

  // List Drag Support
  const setupListDrag = (listId, status) => {
    const list = document.getElementById(listId);
    list.addEventListener('dragover', (e) => {
      const draggedCard = getDraggedCard();
      if (!draggedCard?.classList.contains('card') && !draggedCard?.classList.contains('planning-item')) return;
      e.preventDefault();
      const afterElement = getDragAfterElement(list, e.clientY);
      if (afterElement == null) {
        list.appendChild(draggedCard);
      } else {
        afterElement.before(draggedCard);
      }
    });

    list.addEventListener('dragleave', (e) => {

    });

    list.addEventListener('drop', async (e) => {
      e.preventDefault();
      const draggedCard = getDraggedCard();

      if (draggedCard) {
        const updates = [
          ...getListUpdates('backlog-list', 'Open'),
          ...getListUpdates('move-to-todo-list', 'Todo')
        ];

        await Promise.all(updates);
        if (refreshAppCallback) refreshAppCallback();
      }
    });
  };

  setupListDrag('backlog-list', 'Open');
  setupListDrag('move-to-todo-list', 'Todo');
}

function getListUpdates(listId, targetStatus) {
  const cards = [...document.getElementById(listId).querySelectorAll('.card')];
  const updates = [];
  cards.forEach((card, index) => {
    const id = Number.parseInt(card.dataset.id);
    const issue = state.issues.find(i => i.id === id);
    if (issue && (issue.status !== targetStatus || issue.position !== index)) {
      issue.status = targetStatus;
      issue.position = index;
      updates.push(updateIssue(issue));
    }
  });
  return updates;
}
