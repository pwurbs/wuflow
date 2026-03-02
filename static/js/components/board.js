import { state, isFilterActive } from '../state.js';
import { updateIssue } from '../api.js';
import { showNotification } from '../utils.js';
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
  const totalCounts = { Todo: 0, Pending: 0, Working: 0, Done: 0 };

  // Calculate total counts (unfiltered)
  const nonBacklogIssues = state.issues.filter(issue => issue.status !== 'Open');
  nonBacklogIssues.forEach(issue => {
    if (totalCounts[issue.status] !== undefined) {
      totalCounts[issue.status]++;
    }
  });

  // Filter and sort issues using extracted pure functions
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

  // Update Headers
  const filterActive = isFilterActive();
  document.querySelectorAll('[data-status]').forEach(el => {
    const status = el.dataset.status;
    const countEl = el.querySelector('.count');
    if (countEl && counts[status] !== undefined) {
      if (filterActive) {
        countEl.textContent = `${counts[status]}/${totalCounts[status]}`;
      } else {
        countEl.textContent = counts[status];
      }
    }
  });
}

// Export a setup function to be called once
export function setupBoardView(refreshApp, openModal) {
  if (refreshApp) refreshAppCallback = refreshApp;
  if (openModal) openModalCallback = openModal;
  // Columns
  document.querySelectorAll('.column-content').forEach(colContent => {
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
      // Check if we are really leaving the column content (not entering a child)
      if (e.relatedTarget && !colContent.contains(e.relatedTarget) && e.relatedTarget !== colContent) {
        const draggedCard = getDraggedCard();
        const origin = getDraggedCardOrigin();

        // If we leave the column and we are dragging a card, visually revert it to origin
        // This prevents it from "stuck" in the last column when moving to Planning Panel
        if (draggedCard && origin?.parent) {
          // We only revert if the card is technically IN this column currently (it should be, due to dragover)
          // But checking content.contains might is enough/safer?
          // Actually, just putting it back is safest behavior for "not dropping here".

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

      setDragSuccess(true);

      // Save State
      const updates = getBoardUpdates();

      try {
        await Promise.all(updates);
        if (refreshAppCallback) refreshAppCallback();
      } catch (err) {
        showNotification(err.message, 'error');
        if (refreshAppCallback) refreshAppCallback(); // re-render to restore actual server state
      }
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
