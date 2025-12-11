import { state } from '../state.js';
import { updateIssue } from '../api.js';
import { createCardElement } from './card.js';
import { draggedCard, draggedCardOrigin, getDragAfterElement } from '../drag.js';

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

  state.issues.sort((a, b) => a.position - b.position);

  state.issues.forEach(issue => {
    if (issue.status === 'Open') return; // Backlog

    // Filter Logic
    if (state.filter.label) {
      if (state.filter.label === '__no_label__') {
        if (issue.label) return;
      } else {
        if (!issue.label || issue.label.name !== state.filter.label) return;
      }
    }

    if (state.filter.priority) {
      if (issue.priority !== state.filter.priority) return;
    }

    if (state.filter.search) {
      const term = state.filter.search.toLowerCase();
      const match = issue.title.toLowerCase().includes(term) || (issue.description && issue.description.toLowerCase().includes(term));
      if (!match) return;
    }

    if (columns[issue.status]) {
      const card = createCardElement(issue, true, { openModal: openModalCallback });
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

  setupBoardDragDrop(columns);
}

function setupBoardDragDrop(columns) {
  document.querySelectorAll('.column-content').forEach(colContent => {
    // Remove old listeners to prevent duplicates if any (though typically we re-render whole content, but container persists)
    // Cloning node is a heavy handed way to strip listeners. Check if we can just be idempotent.
    // renderBoard clears innerHTML but doesn't replace the container element.
    // So listeners accumulate if we don't be careful!
    // We should move listener attachment to a one-time setup or use named functions and removeEventListener.
    // Ideally `renderBoard` should not attach listeners to static container elements. 
    // `app.js` should attach listeners ONCE to static containers.
    // OR `board.js` exports a `setupBoard` function called once.
  });
}

// Export a setup function to be called once
export function setupBoardView(refreshApp, openModal) {


  // Columns
  document.querySelectorAll('.column-content').forEach(colContent => {
    colContent.addEventListener('dragleave', (e) => {
      // If moving into a child element, ignore
      if (colContent.contains(e.relatedTarget)) return;

      if (draggedCard && draggedCardOrigin) {
        // Revert to origin
        if (draggedCardOrigin.parent && document.body.contains(draggedCardOrigin.parent)) {
          if (draggedCardOrigin.nextSibling) {
            draggedCardOrigin.parent.insertBefore(draggedCard, draggedCardOrigin.nextSibling);
          } else {
            draggedCardOrigin.parent.appendChild(draggedCard);
          }
        }
      }
    });

    colContent.addEventListener('dragover', (e) => {
      if (!draggedCard || !draggedCard.classList.contains('card')) return;
      e.preventDefault();
      const afterElement = getDragAfterElement(colContent, e.clientY);
      if (afterElement == null) {
        colContent.appendChild(draggedCard);
      } else {
        colContent.insertBefore(draggedCard, afterElement);
      }
    });

    colContent.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (!draggedCard || !draggedCard.classList.contains('card')) return;

      // Save State
      // We need to iterate all columns and update issues
      const updates = [];
      document.querySelectorAll('.column').forEach(col => {
        const status = col.dataset.status;
        const cards = [...col.querySelectorAll('.column-content .card')];
        cards.forEach((card, index) => {
          const id = parseInt(card.dataset.id);
          const issue = state.issues.find(i => i.id === id);
          if (issue && (issue.status !== status || issue.position !== index)) {
            issue.status = status;
            issue.position = index;
            // Planned date is preserved
            updates.push(updateIssue(issue));
          }
        });
      });

      await Promise.all(updates);
      if (refreshAppCallback) refreshAppCallback();
    });
  });
}
