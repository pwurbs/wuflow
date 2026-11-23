// My Work: grouping of my issues into project lanes and status categories, and the order
// within a cell. No DOM, so it is unit-tested on its own (like filters.ts).
import { STATUS_TODO, STATUS_DONE, IN_PROGRESS_STATUSES } from './status-config.ts';
import { PRIORITY_HIGH } from './domain-constants.ts';
import { getEffectiveDeadlineInfo } from './components/planning.ts';
import type { IssueStatus } from './status-config.ts';
import type { MyIssue } from './models.ts';

export const MY_WORK_CATEGORIES = ['notStarted', 'inProgress', 'done'] as const;
export type MyWorkCategory = typeof MY_WORK_CATEGORIES[number];

export interface MyWorkLane {
  projectId: number;
  projectName: string;
  cells: Record<MyWorkCategory, MyIssue[]>;
}

export function categoryOf(status: IssueStatus): MyWorkCategory | null {
  if (status === STATUS_TODO) return 'notStarted';
  if (status === STATUS_DONE) return 'done';
  if (IN_PROGRESS_STATUSES.includes(status)) return 'inProgress';
  return null;
}

// Cells keep the order of the project's board: the user arranges the cards there.
function compareBoardOrder(a: MyIssue, b: MyIssue) {
  return a.position - b.position || a.id - b.id;
}

// In Progress: the later stage first (Stage4 … Stage1, the board read from right to left),
// then the board order within a stage.
function compareInProgress(a: MyIssue, b: MyIssue) {
  return IN_PROGRESS_STATUSES.indexOf(b.status) - IN_PROGRESS_STATUSES.indexOf(a.status)
    || compareBoardOrder(a, b);
}

interface LaneRank {
  highCount: number;
  nextHighDeadline: string | null; // YYYY-MM-DD, the earliest effective deadline of the High issues
  openCount: number;
}

// Only open cards (Not Started, In Progress) count: Done needs no attention.
function laneRank(lane: MyWorkLane): LaneRank {
  const open = [...lane.cells.notStarted, ...lane.cells.inProgress];
  const deadlines = open
    .filter(issue => issue.priority === PRIORITY_HIGH)
    .map(issue => getEffectiveDeadlineInfo(issue)?.date ?? null);
  const dated = deadlines.filter(d => d !== null).toSorted((x, y) => x.localeCompare(y));
  return { highCount: deadlines.length, nextHighDeadline: dated[0] ?? null, openCount: open.length };
}

// The earlier deadline first (an overdue one is the earliest), no deadline last.
function compareDeadline(a: string | null, b: string | null) {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

function compareLanes(a: LaneRank, b: LaneRank) {
  return Number(b.highCount > 0) - Number(a.highCount > 0)
    || compareDeadline(a.nextHighDeadline, b.nextHighDeadline)
    || b.highCount - a.highCount
    || b.openCount - a.openCount;
}

/**
 * Groups the issues into one lane per project, each split into the three categories. Projects
 * with High issues come first, by the nearest deadline of these, then by their number; then the
 * project with the most open cards, then by name. Cells keep the board order.
 */
export function buildLanes(issues: MyIssue[]): MyWorkLane[] {
  const lanes = new Map<number, MyWorkLane>();
  for (const issue of issues) {
    const category = categoryOf(issue.status);
    if (!category) continue;
    let lane = lanes.get(issue.project_id);
    if (!lane) {
      lane = {
        projectId: issue.project_id,
        projectName: issue.project?.name ?? '',
        cells: { notStarted: [], inProgress: [], done: [] },
      };
      lanes.set(issue.project_id, lane);
    }
    lane.cells[category].push(issue);
  }
  const sorted = [...lanes.values()]
    .map(lane => ({ lane, rank: laneRank(lane) }))
    .sort((a, b) => compareLanes(a.rank, b.rank)
      || a.lane.projectName.localeCompare(b.lane.projectName) || a.lane.projectId - b.lane.projectId)
    .map(({ lane }) => lane);
  for (const lane of sorted) {
    lane.cells.notStarted.sort(compareBoardOrder);
    lane.cells.inProgress.sort(compareInProgress);
    lane.cells.done.sort(compareBoardOrder);
  }
  return sorted;
}
