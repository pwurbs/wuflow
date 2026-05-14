import { state, isFilterActive, toggleBacklogReleaseFilter, pruneReleaseFilterIds } from '../state.js';
import { STATUS_OPEN, STATUS_TODO } from '../status-config.js';
import { RELEASE_STATUS_OPEN } from '../domain-constants.js';
import { fetchOpenIssuesByProject, updateIssue } from '../api.js';
import { createCardElement } from './card.js';
import { handleMoveTop, handleMoveBottom, handleTogglePriority, handleAssignToMe, getListUpdates, setupSectionDrop, setupListDrag } from '../list-utils.js';
import { userCan, ACTION_UPDATE_ISSUE } from '../permissions.js';
import { filterIssues, filterByStatus, sortByPosition } from '../filters.js';
import { getDraggedCard } from '../drag.js';
import { escapeHtml } from '../utils.js';

let refreshAppCallback = null;
let openModalCallback = null;
let openLoaded = false;

export function resetOpenLoaded() {
  openLoaded = false;
}

function buildLaneCard(releaseId, name, count) {
  const isChecked = state.filter.releaseFilterIds.includes(releaseId);
  const card = document.createElement('div');
  card.className = 'release-lane-card' + (isChecked ? ' active' : '');
  card.innerHTML = `
    <span class="release-lane-name">${escapeHtml(name)}</span>
    <span class="release-lane-count">${count}</span>
  `;

  card.addEventListener('click', () => {
    toggleBacklogReleaseFilter(releaseId);
    renderBacklog();
  });

  card.addEventListener('dragover', (e) => {
    if (getDraggedCard() && userCan(state.currentUser, ACTION_UPDATE_ISSUE)) {
      e.preventDefault();
      card.classList.add('drag-over');
    }
  });
  card.addEventListener('dragenter', (e) => e.preventDefault());
  card.addEventListener('dragleave', () => card.classList.remove('drag-over'));

  card.addEventListener('drop', async (e) => {
    e.preventDefault();
    card.classList.remove('drag-over');
    if (!userCan(state.currentUser, ACTION_UPDATE_ISSUE)) return;
    const draggedCard = getDraggedCard();
    if (!draggedCard) return;
    const issueId = Number.parseInt(draggedCard.dataset.id, 10);
    const issue = state.issues.find(i => i.id === issueId);
    if (!issue || issue.release_id === releaseId) return;
    const updated = { ...issue, release_id: releaseId };
    const result = await updateIssue(updated);
    if (result.issue) {
      Object.assign(issue, result.issue);
      renderBacklog();
    }
  });

  return card;
}

function renderBacklogReleaseLanes() {
  const container = document.getElementById('backlog-release-lanes');
  if (!container) return;

  const openReleases = state.releases
    .filter(r => r.status === RELEASE_STATUS_OPEN)
    .sort((a, b) => {
      const da = a.release_date ? new Date(a.release_date) : null;
      const db = b.release_date ? new Date(b.release_date) : null;
      if (da && db) return da - db;
      if (da) return -1;
      if (db) return 1;
      return new Date(a.created_at) - new Date(b.created_at);
    });

  if (openReleases.length === 0) {
    container.innerHTML = '';
    container.classList.add('hidden');
    return;
  }
  container.classList.remove('hidden');
  container.innerHTML = `
    <div class="backlog-header">
      <h2>Open Releases</h2>
    </div>
    <div class="release-lanes-list"></div>
  `;
  const list = container.querySelector('.release-lanes-list');

  const countsByRelease = {};
  state.issues.forEach(i => {
    if (i.status === STATUS_OPEN || i.status === STATUS_TODO) {
      const key = i.release_id ?? null;
      countsByRelease[key] = (countsByRelease[key] || 0) + 1;
    }
  });

  openReleases.forEach(rel => {
    list.appendChild(buildLaneCard(rel.id, rel.name, countsByRelease[rel.id] || 0));
  });
  list.appendChild(buildLaneCard(null, 'No Release', countsByRelease[null] || 0));
}

export async function renderBacklog(refreshApp, openModal) {
  if (refreshApp) refreshAppCallback = refreshApp;
  if (openModal) openModalCallback = openModal;

  // Lazy-load open issues if not already loaded
  if (!openLoaded) {
    const openIssues = await fetchOpenIssuesByProject(state.selectedProjectId);
    // Merge into state, avoiding duplicates
    const existingIds = new Set(state.issues.map(i => i.id));
    for (const issue of openIssues) {
      if (!existingIds.has(issue.id)) {
        state.issues.push(issue);
      }
    }
    openLoaded = true;
  }

  const validReleaseIds = new Set([null, ...state.releases.filter(r => r.status === RELEASE_STATUS_OPEN).map(r => r.id)]);
  pruneReleaseFilterIds(validReleaseIds);
  renderBacklogReleaseLanes();

  const backlogList = document.getElementById('backlog-list');
  const moveToTodoList = document.getElementById('move-to-todo-list');
  const backlogCount = document.getElementById('backlog-count');
  const todoCount = document.getElementById('todo-count');

  // Clear
  backlogList.innerHTML = '';
  moveToTodoList.innerHTML = '';

  // Filter and sort issues using extracted pure functions
  const filteredIssues = filterIssues(state.issues, state.filter, state.currentUser?.id);
  const openIssues = sortByPosition(filterByStatus(filteredIssues, STATUS_OPEN));
  const todoIssues = sortByPosition(filterByStatus(filteredIssues, STATUS_TODO));

  function makeCardCallbacks(issue, issuesInList) {
    const isFirst = issuesInList[0]?.id === issue.id;
    const isLast  = issuesInList[issuesInList.length - 1]?.id === issue.id;
    const cb = {
      openModal:        openModalCallback,
      onMoveTop:        isFirst ? null : () => handleMoveTop(issue, issuesInList, refreshAppCallback),
      onMoveBottom:     isLast  ? null : () => handleMoveBottom(issue, issuesInList, refreshAppCallback),
      onTogglePriority: () => handleTogglePriority(issue, refreshAppCallback)
    };
    if (state.currentUser && issue.assignee_id !== state.currentUser.id) {
      cb.onAssignToMe = () => handleAssignToMe(issue, state.currentUser, refreshAppCallback);
    }
    return cb;
  }

  openIssues.forEach(issue => {
    backlogList.appendChild(createCardElement(issue, false, makeCardCallbacks(issue, openIssues)));
  });
  todoIssues.forEach(issue => {
    moveToTodoList.appendChild(createCardElement(issue, false, makeCardCallbacks(issue, todoIssues)));
  });

  if (isFilterActive()) {
    const totalOpen = state.issues.filter(i => i.status === STATUS_OPEN).length;
    const totalTodo = state.issues.filter(i => i.status === STATUS_TODO).length;
    backlogCount.textContent = `${openIssues.length}/${totalOpen}`;
    todoCount.textContent = `${todoIssues.length}/${totalTodo}`;
  } else {
    backlogCount.textContent = openIssues.length;
    todoCount.textContent = todoIssues.length;
  }
}



export function setupBacklogView(refreshApp, openModal) {
  if (refreshApp) refreshAppCallback = refreshApp;
  if (openModal) openModalCallback = openModal;

  const validateUpdate = () => userCan(state.currentUser, ACTION_UPDATE_ISSUE);

  const dropOptions = {
    refreshApp: refreshAppCallback,
    onValidate: validateUpdate,
    onDrop: async () => {
      const updates = [
        ...getListUpdates('backlog-list', STATUS_OPEN),
        ...getListUpdates('move-to-todo-list', STATUS_TODO)
      ];
      await Promise.all(updates);
      renderBacklog();
    }
  };

  setupSectionDrop('backlog-open-section', STATUS_OPEN, { refreshApp: refreshAppCallback, onValidate: validateUpdate, showDragHighlight: false });
  setupSectionDrop('backlog-todo-section', STATUS_TODO, { refreshApp: refreshAppCallback, onValidate: validateUpdate, showDragHighlight: false });

  setupListDrag('backlog-list', STATUS_OPEN, { ...dropOptions, showDragHighlight: false });
  setupListDrag('move-to-todo-list', STATUS_TODO, { ...dropOptions, showDragHighlight: false });
}


