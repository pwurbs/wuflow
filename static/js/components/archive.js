import { state, isFilterActive } from '../state.js';
import { STATUS_ARCHIVE, STATUS_DONE } from '../status-config.js';
import { fetchArchivedIssuesByProject } from '../api.js';
import { createCardElement } from './card.js';
import { getListUpdates, setupSectionDrop, setupListDrag } from '../list-utils.js';
import { filterIssues, filterByStatus, sortByPosition } from '../filters.js';
import { canArchive, showConfirm } from '../utils.js';
import { userCan, ACTION_ARCHIVE_ISSUE } from '../permissions.js';

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
    const archivedIssues = await fetchArchivedIssuesByProject(state.selectedProjectId);
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
  const filteredIssues = filterIssues(state.issues, state.filter, state.currentUser?.id);

  // Archive list: Sorted by UpdatedAt (desc), Grouped by Month
  const archivedIssuesRaw = filterByStatus(filteredIssues, STATUS_ARCHIVE);
  const archivedIssues = archivedIssuesRaw.toSorted((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

  // Done list: Keep existing behavior (position sorted)
  const doneIssues = sortByPosition(filterByStatus(filteredIssues, STATUS_DONE));

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
      openModal: openModalCallback
    }));
  });

  archiveCount.textContent = isFilterActive() ? `${archivedIssues.length}/${filterByStatus(state.issues, STATUS_ARCHIVE).length}` : archivedIssues.length;
  doneCount.textContent = isFilterActive() ? `${doneIssues.length}/${filterByStatus(state.issues, STATUS_DONE).length}` : doneIssues.length;
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
  if (issue.status === STATUS_ARCHIVE && targetStatus !== STATUS_ARCHIVE) {
    return false;
  }
  if (targetStatus === STATUS_ARCHIVE && issue.status !== STATUS_ARCHIVE) {
    if (!userCan(state.currentUser, ACTION_ARCHIVE_ISSUE)) {
      await showConfirm('Not Allowed', 'You do not have permission to archive issues.', 'OK', null, 'primary');
      return false;
    }
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
    ...getListUpdates('archive-list', STATUS_ARCHIVE),
    ...getListUpdates('archive-done-list', STATUS_DONE)
  ];

  await Promise.all(updates);
  renderArchive();
}

export function setupArchiveView(refreshApp, openModal) {
  if (refreshApp) refreshAppCallback = refreshApp;
  if (openModal) openModalCallback = openModal;

  setupSectionDrop('archive-archive-section', STATUS_ARCHIVE, {
    refreshApp: refreshAppCallback,
    onValidate: validateArchiveDrop
  });
  setupSectionDrop('archive-done-section', STATUS_DONE, {
    refreshApp: refreshAppCallback,
    onValidate: validateArchiveDrop,
    showDragHighlight: false
  });

  setupListDrag('archive-list', STATUS_ARCHIVE, {
    refreshApp: refreshAppCallback,
    onValidate: validateArchiveDrop,
    performReorder: false,
    onDrop: async () => {
      // Archiving is handled exclusively by the section drop handler
      // (archive-archive-section), which fires as this event bubbles up.
      // Calling performDropUpdate() here would cause a race: the done-list
      // still holds the dragged card (due to performReorder: false), so
      // getListUpdates sees a stale position and fires updateIssue() on an
      // issue that the section handler is archiving concurrently → 403.
    }
  });

  setupListDrag('archive-done-list', STATUS_DONE, {
    refreshApp: refreshAppCallback,
    onValidate: validateArchiveDrop,
    showDragHighlight: false,
    onDrop: async () => {
      await performDropUpdate();
    }
  });
}

