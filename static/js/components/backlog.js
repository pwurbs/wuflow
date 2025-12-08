import { state } from '../state.js';
import { updateIssue } from '../api.js';
import { createCardElement } from './card.js';
import { draggedCard, getDragAfterElement } from '../drag.js';

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

  // Filter Logic
  let displayIssues = state.issues;
  if (state.filter.label) {
    if (state.filter.label === '__no_label__') {
      displayIssues = displayIssues.filter(i => !i.label);
    } else {
      displayIssues = displayIssues.filter(i => i.label && i.label.name === state.filter.label);
    }
  }

  const openIssues = displayIssues.filter(i => i.status === 'Open').sort((a, b) => a.position - b.position);
  const todoIssues = displayIssues.filter(i => i.status === 'Todo').sort((a, b) => a.position - b.position);

  openIssues.forEach(issue => {
    backlogList.appendChild(createCardElement(issue, false, { openModal: openModalCallback }));
  });
  todoIssues.forEach(issue => {
    moveToTodoList.appendChild(createCardElement(issue, false, { openModal: openModalCallback }));
  });

  backlogCount.textContent = openIssues.length;
  todoCount.textContent = todoIssues.length;
}

export function setupBacklogView(refreshApp, openModal) {
  // Backlog Sections Drag Support (for dropping planning items on background)
  const setupSectionDrop = (id, targetStatus) => {
    const section = document.getElementById(id);
    if (!section) return;

    section.addEventListener('dragover', (e) => {
      if (draggedCard && draggedCard.classList.contains('planning-item')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }
    });

    section.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (draggedCard && draggedCard.classList.contains('planning-item')) {
        const issueId = parseInt(draggedCard.dataset.id);
        const issue = state.issues.find(i => i.id === issueId);
        if (issue) {
          issue.planned_date = null;
          issue.status = targetStatus;
          await updateIssue(issue);
          if (refreshAppCallback) refreshAppCallback();
        }
      }
    });
  };

  setupSectionDrop('backlog-open-section', 'Open');
  setupSectionDrop('backlog-todo-section', 'Todo');

  // List Drag Support
  const setupListDrag = (listId, status) => {
    const list = document.getElementById(listId);
    list.addEventListener('dragover', (e) => {


      if (!draggedCard) return;
      if (draggedCard.classList.contains('card') || draggedCard.classList.contains('planning-item')) {
        e.preventDefault();
        const afterElement = getDragAfterElement(list, e.clientY);
        if (afterElement == null) {
          list.appendChild(draggedCard);
        } else {
          list.insertBefore(draggedCard, afterElement);
        }
      }
    });

    list.addEventListener('dragleave', (e) => {

    });

    list.addEventListener('drop', async (e) => {
      e.preventDefault();


      // Logic to update status and position
      // If planning item, convert to card mentally (handled by update)

      if (draggedCard) {
        const updates = [];

        // Re-read both lists to ensure consistency is maintained if dragged between them
        const openCards = [...document.getElementById('backlog-list').querySelectorAll('.card')];
        openCards.forEach((card, index) => {
          const id = parseInt(card.dataset.id);
          const issue = state.issues.find(i => i.id === id);
          if (issue && (issue.status !== 'Open' || issue.position !== index)) {
            issue.status = 'Open';
            issue.position = index;
            issue.planned_date = null;
            updates.push(updateIssue(issue));
          }
        });

        const todoCards = [...document.getElementById('move-to-todo-list').querySelectorAll('.card')];
        todoCards.forEach((card, index) => {
          const id = parseInt(card.dataset.id);
          const issue = state.issues.find(i => i.id === id);
          if (issue && (issue.status !== 'Todo' || issue.position !== index)) {
            issue.status = 'Todo';
            issue.position = index;
            issue.planned_date = null;
            updates.push(updateIssue(issue));
          }
        });

        await Promise.all(updates);
        if (refreshAppCallback) refreshAppCallback();
      }
    });
  };

  setupListDrag('backlog-list', 'Open');
  setupListDrag('move-to-todo-list', 'Todo');
}
