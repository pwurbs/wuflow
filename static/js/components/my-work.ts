// My Work: the active issues assigned to me across all projects, as project lanes over the
// categories Not Started | In Progress | Done, plus a read-only planning list. Cards and
// planning items are the board's own components (card.ts, planning.ts).
import { fetchMyIssues } from '../api.ts';
import { state } from '../state.ts';
import { filterIssues } from '../filters.ts';
import { byId } from '../utils.ts';
import { createCardElement } from './card.ts';
import { buildPlanningList, countPlanningEntries } from './planning.ts';
import { buildLanes, categoryOf, MY_WORK_CATEGORIES } from '../my-work-order.ts';
import type { MyWorkCategory, MyWorkLane } from '../my-work-order.ts';
import type { Issue, MyIssue } from '../models.ts';
import type { OpenModal } from '../list-utils.ts';

const CATEGORY_TITLES: Record<MyWorkCategory, string> = {
  notStarted: 'Not Started',
  inProgress: 'In Progress',
  done: 'Done',
};

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

// Folder (Lucide), static markup.
const FOLDER_ICON = '<svg class="my-work-lane-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"></path></svg>';

// Project name of a lane: a pill on the line above the lane, in its Not Started cell.
function createLanePill(projectName: string) {
  const pill = document.createElement('span');
  pill.className = 'my-work-lane-pill';
  pill.title = projectName;
  pill.innerHTML = FOLDER_ICON;
  const name = document.createElement('span');
  name.className = 'my-work-lane-name';
  name.textContent = projectName;
  pill.appendChild(name);
  return pill;
}

function createLaneSeparator() {
  const line = document.createElement('div');
  line.className = 'my-work-lane-separator';
  return line;
}

function createCell(category: MyWorkCategory, extraClass = '') {
  const cell = document.createElement('div');
  cell.className = `my-work-cell ${extraClass}`.trim();
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

// One cell per category; the Not Started cell also carries the project name.
function createLaneCells(lane: MyWorkLane) {
  return MY_WORK_CATEGORIES.map(category => {
    const cell = createCell(category);
    if (category === 'notStarted') cell.appendChild(createLanePill(lane.projectName));
    lane.cells[category].forEach(issue => cell.appendChild(createMyWorkCard(issue, category)));
    return cell;
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
  // Only the issue search and the priority filter apply: the other filters belong to the selected project.
  const { search, priority } = state.filter;
  const filtering = search.trim() !== '' || priority !== null;
  const shownIssues = filterIssues(myIssues, { search, priority });
  const lanes = buildLanes(shownIssues);

  // One sticky head for the three category headers, so its lower edge is one line across all bands.
  const head = document.createElement('div');
  head.className = 'my-work-head';
  for (const category of MY_WORK_CATEGORIES) {
    const shown = categoryCount(lanes, category);
    const total = () => myIssues.filter(issue => categoryOf(issue.status) === category).length;
    // Like the board: "shown/total" while a filter is active.
    head.appendChild(createCategoryHeader(category, filtering ? `${shown}/${total()}` : String(shown)));
  }
  grid.appendChild(head);

  let rows = 1;
  if (lanes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'my-work-empty';
    empty.textContent = myIssues.length > 0 ? 'No issues match the filters.' : 'No active issues are assigned to you.';
    grid.appendChild(empty);
    rows++;
  }
  lanes.forEach((lane, index) => {
    if (index > 0) {
      grid.appendChild(createLaneSeparator());
      rows++;
    }
    grid.append(...createLaneCells(lane));
    rows++;
  });
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
  byId('my-work-planning-count').textContent = filtering ? `${count}/${countPlanningEntries(myIssues)}` : String(count);
}
