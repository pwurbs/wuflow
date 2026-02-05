import { state } from '../state.js';
import { updateIssue } from '../api.js';
import { createCardElement } from './card.js';
import { getDraggedCard, getDragAfterElement } from '../drag.js';
import { handleMoveTop, handleMoveBottom, getListUpdates } from '../list-utils.js';
import { filterIssues, filterByStatus, sortByPosition } from '../filters.js';

let refreshAppCallback = null;
let openModalCallback = null;

export function renderArchive(refreshApp, openModal) {
  if (refreshApp) refreshAppCallback = refreshApp;
  if (openModal) openModalCallback = openModal;

  const archiveList = document.getElementById('archive-list');
  const doneList = document.getElementById('archive-done-list');
  const archiveCount = document.getElementById('archive-count');
  const doneCount = document.getElementById('done-count-archive');

  // Clear
  archiveList.innerHTML = '';
  doneList.innerHTML = '';

  // Filter and sort issues
  const filteredIssues = filterIssues(state.issues, state.filter);
  const archivedIssues = sortByPosition(filterByStatus(filteredIssues, 'Archive'));
  const doneIssues = sortByPosition(filterByStatus(filteredIssues, 'Done'));

  archivedIssues.forEach(issue => {
    archiveList.appendChild(createCardElement(issue, false, {
      openModal: openModalCallback,
      onMoveTop: () => handleMoveTop(issue, archivedIssues, refreshAppCallback),
      onMoveBottom: () => handleMoveBottom(issue, archivedIssues, refreshAppCallback)
    }));
  });
  doneIssues.forEach(issue => {
    doneList.appendChild(createCardElement(issue, false, {
      openModal: openModalCallback,
      onMoveTop: () => handleMoveTop(issue, doneIssues, refreshAppCallback),
      onMoveBottom: () => handleMoveBottom(issue, doneIssues, refreshAppCallback)
    }));

  });

  archiveCount.textContent = archivedIssues.length;
  doneCount.textContent = doneIssues.length;
}



export function setupArchiveView(refreshApp, openModal) {
  if (refreshApp) refreshAppCallback = refreshApp;
  if (openModal) openModalCallback = openModal;

  // Archive Sections Drag Support (for dropping planning items on background)
  const setupSectionDrop = (id, targetStatus) => {
    const section = document.getElementById(id);
    if (!section) return;

    section.addEventListener('dragover', (e) => {
      if (section.offsetParent === null) return;
      const draggedCard = getDraggedCard();
      if (!draggedCard?.classList.contains('planning-item')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });

    section.addEventListener('drop', async (e) => {
      if (section.offsetParent === null) return;
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

  setupSectionDrop('archive-archive-section', 'Archive');
  setupSectionDrop('archive-done-section', 'Done');

  // List Drag Support
  const setupListDrag = (listId, status) => {
    const list = document.getElementById(listId);
    list.addEventListener('dragover', (e) => {
      if (list.offsetParent === null) return;
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

    list.addEventListener('drop', async (e) => {
      if (list.offsetParent === null) return;
      e.preventDefault();
      const draggedCard = getDraggedCard();

      if (draggedCard) {
        const updates = [
          ...getListUpdates('archive-list', 'Archive'),
          ...getListUpdates('archive-done-list', 'Done')
        ];

        await Promise.all(updates);
        if (refreshAppCallback) refreshAppCallback();
      }
    });
  };

  setupListDrag('archive-list', 'Archive');
  setupListDrag('archive-done-list', 'Done');
}

