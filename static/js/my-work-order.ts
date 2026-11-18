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

// A planned date up to this many days ahead counts as "soon".
const SOON_DAYS = 2;

export function categoryOf(status: IssueStatus): MyWorkCategory | null {
  if (status === STATUS_TODO) return 'notStarted';
  if (status === STATUS_DONE) return 'done';
  if (IN_PROGRESS_STATUSES.includes(status)) return 'inProgress';
  return null;
}

function localISODate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfDay(d: Date) {
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  return day;
}

// 0 overdue (issue or open-task deadline before today), 1 high priority,
// 2 planned for today or soon (or a missed plan), 3 the rest.
export function urgencyRank(issue: MyIssue, today: Date) {
  const deadline = getEffectiveDeadlineInfo(issue);
  if (deadline && startOfDay(deadline.date) < startOfDay(today)) return 0;
  if (issue.priority === PRIORITY_HIGH) return 1;
  const soon = new Date(today);
  soon.setDate(soon.getDate() + SOON_DAYS);
  const soonStr = localISODate(soon);
  if (issue.planned_dates?.some(d => d <= soonStr)) return 2;
  return 3;
}

// Earliest of the effective deadline and the planned dates, for ties within a rank.
function earliestDate(issue: MyIssue) {
  const times: number[] = [];
  const deadline = getEffectiveDeadlineInfo(issue);
  if (deadline) times.push(startOfDay(deadline.date).getTime());
  for (const d of issue.planned_dates ?? []) times.push(new Date(`${d}T00:00:00`).getTime());
  return times.length ? Math.min(...times) : Number.POSITIVE_INFINITY;
}

export function compareUrgency(a: MyIssue, b: MyIssue, today: Date) {
  return urgencyRank(a, today) - urgencyRank(b, today)
    || earliestDate(a) - earliestDate(b)
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

/** Groups the issues into one lane per project (alphabetical), each split into the three categories. */
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
  const sorted = [...lanes.values()].sort((a, b) => a.projectName.localeCompare(b.projectName) || a.projectId - b.projectId);
  for (const lane of sorted) {
    lane.cells.notStarted.sort((a, b) => compareUrgency(a, b, today));
    lane.cells.inProgress.sort((a, b) => compareInProgress(a, b, today));
    lane.cells.done.sort(compareDone);
  }
  return sorted;
}
