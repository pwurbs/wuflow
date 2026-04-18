import { state, isFilterActive } from '../state.js';
import { updateIssue } from '../api.js';
import { showNotification } from '../utils.js';
import { userCan, ACTION_UPDATE_ISSUE } from '../permissions.js';
import { createCardElement } from './card.js';
import { getDraggedCard, getDragAfterElement, getDraggedCardOrigin, setDragSuccess, getDragSuccess } from '../drag.js';
import { filterIssues, sortByPosition } from '../filters.js';
import { getBoardColumns } from '../status-config.js';

let refreshAppCallback = null;
let openModalCallback = null;

export function renderBoard(refreshApp, openModal) {
  if (refreshApp) refreshAppCallback = refreshApp;
  if (openModal) openModalCallback = openModal;

  const boardColumns = document.querySelector('.board-columns');
  boardColumns.querySelectorAll('.column').forEach(c => c.remove());

  const columnDefs = getBoardColumns();
  const columns = {};
  const counts = {};
  const totalCounts = {};

  for (const col of columnDefs) {
    counts[col.statusKey] = 0;
    totalCounts[col.statusKey] = 0;

    const colEl = document.createElement('div');
    colEl.className = 'column';
    colEl.dataset.status = col.statusKey;

    const header = document.createElement('div');
    header.className = 'column-header';
    header.innerHTML = `<h2>${col.displayName}</h2><span class="count">0</span>`;

    const content = document.createElement('div');
    content.className = 'column-content';

    colEl.appendChild(header);
    colEl.appendChild(content);
    boardColumns.insertBefore(colEl, boardColumns.querySelector('.sidebar'));

    columns[col.statusKey] = content;
    attachColumnDragListeners(content);
  }

  const nonBacklogIssues = state.issues.filter(issue => issue.status !== 'Open');
  nonBacklogIssues.forEach(issue => {
    if (totalCounts[issue.status] !== undefined) {
      totalCounts[issue.status]++;
    }
  });

  const filteredIssues = filterIssues(nonBacklogIssues, state.filter, state.currentUser?.id);
  const sortedIssues = sortByPosition(filteredIssues);

  sortedIssues.forEach(issue => {
    if (columns[issue.status]) {
      const card = createCardElement(issue, true, {
        openModal: openModalCallback,
        onDragStart: () => setDragSuccess(false),
        onDragEnd: (cardEl) => {
          if (!getDragSuccess()) {
            const origin = getDraggedCardOrigin();
            if (origin?.parent && document.body.contains(origin.parent)) {
              if (origin.nextSibling) {
                origin.nextSibling.before(cardEl);
              } else {
                origin.parent.appendChild(cardEl);
              }
            }
          }
        }
      });
      columns[issue.status].appendChild(card);
      counts[issue.status]++;
    }
  });

  const filterActive = isFilterActive();
  document.querySelectorAll('[data-status]').forEach(el => {
    const status = el.dataset.status;
    const countEl = el.querySelector('.count');
    if (countEl && counts[status] !== undefined) {
      countEl.textContent = filterActive
        ? `${counts[status]}/${totalCounts[status]}`
        : counts[status];
    }
  });
}

function attachColumnDragListeners(colContent) {
  colContent.addEventListener('dragover', (e) => {
    const draggedCard = getDraggedCard();
    if (!draggedCard?.classList.contains('card')) return;
    e.preventDefault();
    const afterElement = getDragAfterElement(colContent, e.clientY);

    if (colContent === draggedCard.parentElement && afterElement === draggedCard.nextElementSibling) {
      return;
    }

    if (afterElement == null) {
      colContent.appendChild(draggedCard);
    } else {
      afterElement.before(draggedCard);
    }
  });

  colContent.addEventListener('dragleave', (e) => {
    if (e.relatedTarget && !colContent.contains(e.relatedTarget) && e.relatedTarget !== colContent) {
      const draggedCard = getDraggedCard();
      const origin = getDraggedCardOrigin();
      if (draggedCard && origin?.parent) {
        if (origin.nextSibling) {
          origin.nextSibling.before(draggedCard);
        } else {
          origin.parent.appendChild(draggedCard);
        }
      }
    }
  });

  colContent.addEventListener('drop', async (e) => {
    e.preventDefault();
    const draggedCard = getDraggedCard();

    if (!draggedCard?.classList.contains('card')) return;
    if (!userCan(state.currentUser, ACTION_UPDATE_ISSUE)) {
      if (refreshAppCallback) refreshAppCallback();
      return;
    }

    setDragSuccess(true);

    const updates = getBoardUpdates();
    try {
      await Promise.all(updates);
      if (refreshAppCallback) refreshAppCallback();
    } catch (err) {
      showNotification(err.message, 'error');
      if (refreshAppCallback) refreshAppCallback();
    }
  });
}

// setupBoardView stores callbacks; drag listeners are now attached per-render in renderBoard.
export function setupBoardView(refreshApp, openModal) {
  if (refreshApp) refreshAppCallback = refreshApp;
  if (openModal) openModalCallback = openModal;
}

function getBoardUpdates() {
  const updates = [];
  document.querySelectorAll('.column').forEach(col => {
    const status = col.dataset.status;
    const cards = [...col.querySelectorAll('.column-content .card')];
    cards.forEach((card, index) => {
      const id = Number.parseInt(card.dataset.id);
      const issue = state.issues.find(i => i.id === id);
      if (issue && (issue.status !== status || issue.position !== index)) {
        issue.status = status;
        issue.position = index;
        updates.push(updateIssue(issue));
      }
    });
  });
  return updates;
}
