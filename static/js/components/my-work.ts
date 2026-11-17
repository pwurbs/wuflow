// My Work: the active issues assigned to me across all projects, as project lanes over the
// categories Not Started | In Progress | Done, plus a read-only planning list. Cards and
// planning items are the board's own components (card.ts, planning.ts).
import { fetchMyIssues } from '../api.ts';
import { state } from '../state.ts';
import { filterIssues } from '../filters.ts';
import { byId } from '../utils.ts';
import { createCardElement } from './card.ts';
import { buildPlanningList, countPlanningEntries } from './planning.ts';
import { buildLanes, MY_WORK_CATEGORIES } from '../my-work-order.ts';
import type { MyWorkCategory, MyWorkLane } from '../my-work-order.ts';
import type { Issue, MyIssue } from '../models.ts';
import type { OpenModal } from '../list-utils.ts';

const CATEGORY_TITLES: Record<MyWorkCategory, string> = {
  notStarted: 'Not Started',
  inProgress: 'In Progress',
  done: 'Done',
};

// Not Started and Done hold more issues, so their cards flow in two columns.
const WIDE_CATEGORIES: ReadonlySet<MyWorkCategory> = new Set(['notStarted', 'done']);

// Kept here, not in state.issues: those belong to the selected project.
let myIssues: MyIssue[] = [];
let openModalCallback: OpenModal | undefined;

export function setupMyWorkView(openModal: OpenModal) {
  openModalCallback = openModal;
}

export async function loadMyIssues() {
  myIssues = await fetchMyIssues();
}

// Applies changes made in the issue dialog to the cached issue (like the board's merge in app.ts).
export function mergeMyIssue(issue: Issue) {
  const idx = myIssues.findIndex(i => i.id === issue.id);
  if (idx !== -1) myIssues[idx] = { ...myIssues[idx], ...issue };
}

function openIssue(issue: Issue) {
  openModalCallback?.(issue);
}

function createCategoryHeader(category: MyWorkCategory, count: string) {
  const header = document.createElement('div');
  header.className = 'column-header';
  header.dataset.category = category;
  const title = document.createElement('h2');
  title.textContent = CATEGORY_TITLES[category];
  const countEl = document.createElement('span');
  countEl.className = 'count';
  countEl.textContent = count;
  header.append(title, countEl);
  return header;
}

function createLaneHeader(projectName: string, count: number) {
  const header = document.createElement('div');
  header.className = 'my-work-lane-header';
  const name = document.createElement('span');
  name.className = 'my-work-lane-name';
  name.textContent = projectName;
  name.title = projectName;
  const countEl = document.createElement('span');
  countEl.className = 'count';
  countEl.textContent = String(count);
  header.append(name, countEl);
  return header;
}

function createCell(category: MyWorkCategory, extraClass = '') {
  const cell = document.createElement('div');
  cell.className = `my-work-cell ${WIDE_CATEGORIES.has(category) ? 'my-work-cell--wide' : ''} ${extraClass}`.trim();
  cell.dataset.category = category;
  return cell;
}

function createMyWorkCard(issue: MyIssue, category: MyWorkCategory) {
  return createCardElement(issue, true, { openModal: openIssue }, {
    showAssignee: false,
    showRelease: false,
    draggable: false,
    // In Progress groups up to four stages: show which one.
    stageName: category === 'inProgress' ? issue.status_name : undefined,
  });
}

function createProjectSubline(issue: Issue) {
  const name = issue.project?.name ?? '';
  const el = document.createElement('span');
  el.className = 'planning-item-project';
  el.textContent = name;
  el.title = name;
  return el;
}

// Number of issues per category, over all lanes.
function categoryCount(lanes: MyWorkLane[], category: MyWorkCategory) {
  return lanes.reduce((sum, lane) => sum + lane.cells[category].length, 0);
}

export function renderMyWork() {
  const grid = byId('my-work-grid');
  grid.innerHTML = '';
  // Only the issue search of the toolbar applies: the other filters belong to the selected project.
  const searching = state.filter.search.trim() !== '';
  const shownIssues = filterIssues(myIssues, { search: state.filter.search });
  const lanes = buildLanes(shownIssues);
  const allLanes = searching ? buildLanes(myIssues) : lanes;

  for (const category of MY_WORK_CATEGORIES) {
    const shown = categoryCount(lanes, category);
    // Like the board: "shown/total" while the search is active.
    grid.appendChild(createCategoryHeader(category, searching ? `${shown}/${categoryCount(allLanes, category)}` : String(shown)));
  }

  let rows = 1;
  if (lanes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'my-work-empty';
    empty.textContent = myIssues.length > 0 ? 'No issues match the search.' : 'No active issues are assigned to you.';
    grid.appendChild(empty);
    rows++;
  }
  for (const lane of lanes) {
    grid.appendChild(createLaneHeader(lane.projectName, lane.total));
    for (const category of MY_WORK_CATEGORIES) {
      const cell = createCell(category);
      lane.cells[category].forEach(issue => cell.appendChild(createMyWorkCard(issue, category)));
      grid.appendChild(cell);
    }
    rows += 2;
  }
  for (const category of MY_WORK_CATEGORIES) {
    grid.appendChild(createCell(category, 'my-work-cell--fill'));
  }
  // Content rows take their height, the filler row the rest, so the bands reach the bottom.
  grid.style.gridTemplateRows = `repeat(${rows}, auto) 1fr`;

  const count = buildPlanningList(byId('my-work-planning-list'), shownIssues, {
    readOnly: true,
    itemSubline: createProjectSubline,
    openModal: openIssue,
  });
  byId('my-work-planning-count').textContent = searching ? `${count}/${countPlanningEntries(myIssues)}` : String(count);
}
