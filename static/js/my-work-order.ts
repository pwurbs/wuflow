// My Work: grouping of my issues into project lanes and status categories, and the order
// within a cell. No DOM, so it is unit-tested on its own (like filters.ts).
import { STATUS_TODO, STATUS_DONE, IN_PROGRESS_STATUSES } from './status-config.ts';
import { PRIORITY_HIGH } from './domain-constants.ts';
import { getEffectiveDeadlineInfo } from './components/planning.ts';
import { localISODate, addDaysISO } from './utils.ts';
import type { IssueStatus } from './status-config.ts';
import type { MyIssue } from './models.ts';

export const MY_WORK_CATEGORIES = ['notStarted', 'inProgress', 'done'] as const;
export type MyWorkCategory = typeof MY_WORK_CATEGORIES[number];

export interface MyWorkLane {
  projectId: number;
  projectName: string;
  cells: Record<MyWorkCategory, MyIssue[]>;
}

// A planned date up to this many days ahead counts as "soon".
const SOON_DAYS = 2;

export function categoryOf(status: IssueStatus): MyWorkCategory | null {
  if (status === STATUS_TODO) return 'notStarted';
  if (status === STATUS_DONE) return 'done';
  if (IN_PROGRESS_STATUSES.includes(status)) return 'inProgress';
  return null;
}

// 0 overdue (issue or open-task deadline before today), 1 high priority,
// 2 planned for today or soon (or a missed plan), 3 the rest.
export function urgencyRank(issue: MyIssue, today: Date) {
  const todayStr = localISODate(today);
  const deadline = getEffectiveDeadlineInfo(issue);
  if (deadline && deadline.date < todayStr) return 0;
  if (issue.priority === PRIORITY_HIGH) return 1;
  const soonStr = addDaysISO(todayStr, SOON_DAYS);
  if (issue.planned_dates?.some(d => d <= soonStr)) return 2;
  return 3;
}

// Earliest of the effective deadline and the planned dates (YYYY-MM-DD), null without any.
function earliestDate(issue: MyIssue) {
  const dates = [...issue.planned_dates ?? []];
  const deadline = getEffectiveDeadlineInfo(issue);
  if (deadline) dates.push(deadline.date);
  return dates.toSorted((x, y) => x.localeCompare(y))[0] ?? null;
}

// For ties within a rank: the earlier date first, issues without a date last.
function compareEarliestDate(a: MyIssue, b: MyIssue) {
  const da = earliestDate(a);
  const db = earliestDate(b);
  if (da === db) return 0;
  if (da === null) return 1;
  if (db === null) return -1;
  return da < db ? -1 : 1;
}

export function compareUrgency(a: MyIssue, b: MyIssue, today: Date) {
  return urgencyRank(a, today) - urgencyRank(b, today)
    || compareEarliestDate(a, b)
    || a.position - b.position
    || a.id - b.id;
}

// In Progress: the later stage of the project first (Stage4 … Stage1), then by urgency.
export function compareInProgress(a: MyIssue, b: MyIssue, today: Date) {
  return IN_PROGRESS_STATUSES.indexOf(b.status) - IN_PROGRESS_STATUSES.indexOf(a.status)
    || compareUrgency(a, b, today);
}

// Done: most recently updated first.
export function compareDone(a: MyIssue, b: MyIssue) {
  return Date.parse(b.updated_at) - Date.parse(a.updated_at) || a.id - b.id;
}

// Open cards of a lane: Not Started and In Progress. Done needs no attention.
function openCount(lane: MyWorkLane) {
  return lane.cells.notStarted.length + lane.cells.inProgress.length;
}

/**
 * Groups the issues into one lane per project, each split into the three categories. The
 * project with the most open cards comes first, ties alphabetically.
 */
export function buildLanes(issues: MyIssue[], today = new Date()): MyWorkLane[] {
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
  const sorted = [...lanes.values()].sort((a, b) =>
    openCount(b) - openCount(a) || a.projectName.localeCompare(b.projectName) || a.projectId - b.projectId);
  for (const lane of sorted) {
    lane.cells.notStarted.sort((a, b) => compareUrgency(a, b, today));
    lane.cells.inProgress.sort((a, b) => compareInProgress(a, b, today));
    lane.cells.done.sort(compareDone);
  }
  return sorted;
}
