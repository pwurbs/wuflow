import { state, isFilterActive } from '../state.js';
import { STATUS_OPEN, STATUS_TODO } from '../status-config.js';
import { fetchOpenIssuesByProject } from '../api.js';
import { createCardElement } from './card.js';
import { handleMoveTop, handleMoveBottom, handleTogglePriority, handleAssignToMe, getListUpdates, setupSectionDrop, setupListDrag } from '../list-utils.js';
import { userCan, ACTION_UPDATE_ISSUE } from '../permissions.js';
import { filterIssues, filterByStatus, sortByPosition } from '../filters.js';

let refreshAppCallback = null;
let openModalCallback = null;
let openLoaded = false;

export function resetOpenLoaded() {
  openLoaded = false;
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

  backlogCount.textContent = isFilterActive() ? `${openIssues.length}/${state.issues.filter(i => i.status === STATUS_OPEN).length}` : openIssues.length;
  todoCount.textContent = isFilterActive() ? `${todoIssues.length}/${state.issues.filter(i => i.status === STATUS_TODO).length}` : todoIssues.length;
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
      if (refreshAppCallback) refreshAppCallback();
    }
  };

  setupSectionDrop('backlog-open-section', STATUS_OPEN, { refreshApp: refreshAppCallback, onValidate: validateUpdate, showDragHighlight: false });
  setupSectionDrop('backlog-todo-section', STATUS_TODO, { refreshApp: refreshAppCallback, onValidate: validateUpdate, showDragHighlight: false });

  setupListDrag('backlog-list', STATUS_OPEN, { ...dropOptions, showDragHighlight: false });
  setupListDrag('move-to-todo-list', STATUS_TODO, { ...dropOptions, showDragHighlight: false });
}


