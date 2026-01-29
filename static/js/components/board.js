import { state } from '../state.js';
import { updateIssue } from '../api.js';
import { createCardElement } from './card.js';
import { getDraggedCard, getDragAfterElement, getDraggedCardOrigin, setDragSuccess, getDragSuccess } from '../drag.js';
import { filterIssues, sortByPosition } from '../filters.js';

let refreshAppCallback = null;
let openModalCallback = null;

export function renderBoard(refreshApp, openModal) {
  if (refreshApp) refreshAppCallback = refreshApp;
  if (openModal) openModalCallback = openModal;

  const columns = {
    Todo: document.getElementById('col-todo'),
    Pending: document.getElementById('col-pending'),
    Working: document.getElementById('col-working'),
    Done: document.getElementById('col-done')
  };

  // Clear
  Object.values(columns).forEach(col => col.innerHTML = '');

  // Counts
  const counts = { Todo: 0, Pending: 0, Working: 0, Done: 0 };

  // Filter and sort issues using extracted pure functions
  const nonBacklogIssues = state.issues.filter(issue => issue.status !== 'Open');
  const filteredIssues = filterIssues(nonBacklogIssues, state.filter);
  const sortedIssues = sortByPosition(filteredIssues);

  sortedIssues.forEach(issue => {
    if (columns[issue.status]) {
      const card = createCardElement(issue, true, {
        openModal: openModalCallback,
        onDragStart: () => setDragSuccess(false),
        onDragEnd: (cardEl) => {
          if (!getDragSuccess()) {
            // Revert
            const origin = getDraggedCardOrigin();
            if (origin && origin.parent && document.body.contains(origin.parent)) {
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

  // Update Headers
  document.querySelectorAll('[data-status]').forEach(el => {
    const status = el.dataset.status;
    const countEl = el.querySelector('.count');
    if (countEl && counts[status] !== undefined) {
      countEl.textContent = counts[status];
    }
  });
}

// Export a setup function to be called once
export function setupBoardView(refreshApp, openModal) {


  // Columns
  document.querySelectorAll('.column-content').forEach(colContent => {
    colContent.addEventListener('dragover', (e) => {
      const draggedCard = getDraggedCard();
      if (!draggedCard?.classList.contains('card')) return;
      e.preventDefault();
      const afterElement = getDragAfterElement(colContent, e.clientY);

      if (afterElement === draggedCard.nextElementSibling) {
        return;
      }

      if (afterElement == null) {
        colContent.appendChild(draggedCard);
      } else {
        afterElement.before(draggedCard);
      }
    });

    colContent.addEventListener('drop', async (e) => {
      e.preventDefault();
      const draggedCard = getDraggedCard();

      if (!draggedCard?.classList.contains('card')) return;

      setDragSuccess(true);

      // Save State
      const updates = getBoardUpdates();

      await Promise.all(updates);
      if (refreshAppCallback) refreshAppCallback();
    });
  });
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
        // Planned date is preserved
        updates.push(updateIssue(issue));
      }
    });
  });
  return updates;
}
