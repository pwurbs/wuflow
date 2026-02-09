import { state } from '../state.js';
import { fetchArchivedIssues } from '../api.js';
import { createCardElement } from './card.js';
import { handleMoveTop, handleMoveBottom, getListUpdates, setupSectionDrop, setupListDrag } from '../list-utils.js';
import { filterIssues, filterByStatus, sortByPosition } from '../filters.js';
import { canArchive, showConfirm } from '../utils.js';

let refreshAppCallback = null;
let openModalCallback = null;
let archivedLoaded = false;

export function resetArchivedLoaded() {
  archivedLoaded = false;
}

export async function renderArchive(refreshApp, openModal) {
  if (refreshApp) refreshAppCallback = refreshApp;
  if (openModal) openModalCallback = openModal;

  // Lazy-load archived issues if not already loaded
  if (!archivedLoaded) {
    const archivedIssues = await fetchArchivedIssues();
    // Merge into state, avoiding duplicates
    const existingIds = new Set(state.issues.map(i => i.id));
    for (const issue of archivedIssues) {
      if (!existingIds.has(issue.id)) {
        state.issues.push(issue);
      }
    }
    archivedLoaded = true;
  }

  const archiveList = document.getElementById('archive-list');
  const doneList = document.getElementById('archive-done-list');
  const archiveCount = document.getElementById('archive-count');
  const doneCount = document.getElementById('done-count-archive');

  // Clear
  archiveList.innerHTML = '';
  doneList.innerHTML = '';

  // Filter and sort issues
  // Filter and sort issues
  const filteredIssues = filterIssues(state.issues, state.filter);

  // Archive list: Sorted by UpdatedAt (desc), Grouped by Month
  const archivedIssuesRaw = filterByStatus(filteredIssues, 'Archive');
  const archivedIssues = archivedIssuesRaw.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

  // Done list: Keep existing behavior (position sorted)
  const doneIssues = sortByPosition(filterByStatus(filteredIssues, 'Done'));

  // Render Archive (Grouped)
  if (archivedIssues.length === 0) {
    archiveList.innerHTML = '<div class="empty-state">No archived issues</div>';
  } else {
    const groups = groupByMonth(archivedIssues);
    for (const [month, issues] of Object.entries(groups)) {
      const groupHeader = document.createElement('h3');
      groupHeader.className = 'archive-month-header';
      groupHeader.textContent = month;
      archiveList.appendChild(groupHeader);

      issues.forEach(issue => {
        // Pass callbacks WITHOUT move handlers to disable arrows
        archiveList.appendChild(createCardElement(issue, false, {
          openModal: openModalCallback
        }));
      });
    }
  }

  // Render Done (Standard List)
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

function groupByMonth(issues) {
  const groups = {};
  issues.forEach(issue => {
    const date = new Date(issue.updated_at);
    // Format: "September 2023"
    const key = date.toLocaleDateString(navigator.language, { month: 'long', year: 'numeric' });
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(issue);
  });
  return groups;
}


async function validateArchiveDrop(issue, targetStatus) {
  if (targetStatus === 'Archive' && issue.status !== 'Archive') {
    const check = canArchive(issue);
    if (!check.allowed) {
      await showConfirm('Cannot Archive', check.reason, 'OK', null, 'primary');
      if (openModalCallback) openModalCallback(issue);
      return false;
    }
  }
  return true;
}

async function performDropUpdate() {
  const updates = [
    ...getListUpdates('archive-list', 'Archive'),
    ...getListUpdates('archive-done-list', 'Done')
  ];

  await Promise.all(updates);
  if (refreshAppCallback) refreshAppCallback();
}

export function setupArchiveView(refreshApp, openModal) {
  if (refreshApp) refreshAppCallback = refreshApp;
  if (openModal) openModalCallback = openModal;

  setupSectionDrop('archive-archive-section', 'Archive', {
    refreshApp: refreshAppCallback,
    onValidate: validateArchiveDrop
  });
  setupSectionDrop('archive-done-section', 'Done', {
    refreshApp: refreshAppCallback,
    onValidate: validateArchiveDrop
  });

  setupListDrag('archive-list', 'Archive', {
    refreshApp: refreshAppCallback,
    onValidate: validateArchiveDrop,
    performReorder: false,
    onDrop: async (issue, status) => {
      if (!issue || (issue.status === 'Archive' && status === 'Archive')) {
        return;
      }
      await performDropUpdate();
    }
  });

  setupListDrag('archive-done-list', 'Done', {
    refreshApp: refreshAppCallback,
    onValidate: validateArchiveDrop,
    onDrop: async () => {
      await performDropUpdate();
    }
  });
}

