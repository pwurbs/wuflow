import { describe, it, expect } from 'vitest';
import { buildLanes, categoryOf, compareInProgress, compareUrgency, urgencyRank } from '../my-work-order.ts';
import { makeIssue, makeProject, makeTask } from './fixtures.ts';
import type { MyIssue } from '../models.ts';

const TODAY = new Date('2026-11-17T10:00:00');

function myIssue(overrides: Partial<MyIssue> = {}): MyIssue {
  return { ...makeIssue({ status: 'Todo', project: makeProject({ id: 1, name: 'Alpha' }) }), status_name: 'Todo', ...overrides };
}

const titles = (issues: MyIssue[]) => issues.map(i => i.title);

describe('categoryOf', () => {
  it.each([
    ['Todo', 'notStarted'],
    ['Stage1', 'inProgress'],
    ['Stage2', 'inProgress'],
    ['Stage3', 'inProgress'],
    ['Stage4', 'inProgress'],
    ['Done', 'done'],
    ['Open', null],
    ['Archive', null],
  ] as const)('%s → %s', (status, category) => {
    expect(categoryOf(status)).toBe(category);
  });
});

describe('buildLanes', () => {
  it('puts the project with the most open cards first; Done does not count', () => {
    const alpha = makeProject({ id: 1, name: 'Alpha' });
    const wide = makeProject({ id: 2, name: 'Wide' });
    const lanes = buildLanes([
      myIssue({ id: 1, project_id: 1, project: alpha, status: 'Todo' }),
      myIssue({ id: 2, project_id: 1, project: alpha, status: 'Done' }),
      myIssue({ id: 3, project_id: 1, project: alpha, status: 'Done' }),
      myIssue({ id: 4, project_id: 2, project: wide, status: 'Todo' }),
      myIssue({ id: 5, project_id: 2, project: wide, status: 'Stage2' }),
    ], TODAY);

    // Alpha has more issues (3), but only one open; Wide has two open.
    expect(lanes.map(l => l.projectName)).toEqual(['Wide', 'Alpha']);
  });

  it('sorts lanes with the same number of open cards by project name', () => {
    const lanes = buildLanes([
      myIssue({ id: 1, project_id: 3, project: makeProject({ id: 3, name: 'charlie' }) }),
      myIssue({ id: 2, project_id: 1, project: makeProject({ id: 1, name: 'Alpha' }) }),
      myIssue({ id: 3, project_id: 2, project: makeProject({ id: 2, name: 'beta' }) }),
      myIssue({ id: 4, project_id: 1, project: makeProject({ id: 1, name: 'Alpha' }), status: 'Done' }),
    ], TODAY);

    expect(lanes.map(l => l.projectName)).toEqual(['Alpha', 'beta', 'charlie']);
    expect(lanes[0].cells.notStarted).toHaveLength(1);
    expect(lanes[0].cells.done).toHaveLength(1);
  });

  it('puts each issue into its category and leaves out Open and Archive', () => {
    const [lane] = buildLanes([
      myIssue({ id: 1, title: 'todo', status: 'Todo' }),
      myIssue({ id: 2, title: 'stage1', status: 'Stage1' }),
      myIssue({ id: 3, title: 'stage4', status: 'Stage4' }),
      myIssue({ id: 4, title: 'done', status: 'Done' }),
      myIssue({ id: 5, title: 'open', status: 'Open' }),
      myIssue({ id: 6, title: 'archived', status: 'Archive' }),
    ], TODAY);

    expect(titles(lane.cells.notStarted)).toEqual(['todo']);
    expect(titles(lane.cells.inProgress)).toEqual(['stage4', 'stage1']);
    expect(titles(lane.cells.done)).toEqual(['done']);
  });

  it('has no lanes without issues', () => {
    expect(buildLanes([], TODAY)).toEqual([]);
  });

  it('sorts Not Started by urgency, In Progress by stage then urgency, Done by last update', () => {
    const [lane] = buildLanes([
      myIssue({ id: 1, title: 'todo rest', status: 'Todo' }),
      myIssue({ id: 2, title: 'todo overdue', status: 'Todo', deadline: '2026-11-16T12:00:00Z' }),
      myIssue({ id: 3, title: 'stage1 overdue', status: 'Stage1', deadline: '2026-11-16T12:00:00Z' }),
      myIssue({ id: 4, title: 'stage3 rest', status: 'Stage3' }),
      myIssue({ id: 5, title: 'stage3 high', status: 'Stage3', priority: 'High' }),
      myIssue({ id: 6, title: 'done old', status: 'Done', updated_at: '2026-11-01T10:00:00Z' }),
      myIssue({ id: 7, title: 'done new', status: 'Done', updated_at: '2026-11-15T10:00:00Z' }),
    ], TODAY);

    expect(titles(lane.cells.notStarted)).toEqual(['todo overdue', 'todo rest']);
    expect(titles(lane.cells.inProgress)).toEqual(['stage3 high', 'stage3 rest', 'stage1 overdue']);
    expect(titles(lane.cells.done)).toEqual(['done new', 'done old']);
  });
});

describe('urgencyRank', () => {
  it.each<[string, Partial<MyIssue>, number]>([
    ['issue deadline before today', { deadline: '2026-11-16T12:00:00Z' }, 0],
    ['open task deadline before today', { tasks: [makeTask({ done: false, deadline: '2026-11-10T12:00:00Z' })] }, 0],
    ['high priority', { priority: 'High' }, 1],
    ['overdue wins over high priority', { priority: 'High', deadline: '2026-11-16T12:00:00Z' }, 0],
    ['planned today', { planned_dates: ['2026-11-17'] }, 2],
    ['planned the day after tomorrow', { planned_dates: ['2026-11-19'] }, 2],
    ['missed plan (planned in the past)', { planned_dates: ['2026-11-01'] }, 2],
    ['planned in three days', { planned_dates: ['2026-11-20'] }, 3],
    ['deadline today is not overdue', { deadline: '2026-11-17T12:00:00Z' }, 3],
    ['done task with past deadline does not count', { tasks: [makeTask({ done: true, deadline: '2026-11-10T12:00:00Z' })] }, 3],
    ['nothing urgent', {}, 3],
  ])('%s → %i', (_, overrides, rank) => {
    expect(urgencyRank(myIssue(overrides), TODAY)).toBe(rank);
  });
});

describe('compareUrgency', () => {
  const sort = (issues: MyIssue[]) => titles([...issues].sort((a, b) => compareUrgency(a, b, TODAY)));

  it('orders by rank: overdue, high priority, planned soon, rest', () => {
    expect(sort([
      myIssue({ id: 1, title: 'rest' }),
      myIssue({ id: 2, title: 'planned soon', planned_dates: ['2026-11-18'] }),
      myIssue({ id: 3, title: 'high', priority: 'High' }),
      myIssue({ id: 4, title: 'overdue', deadline: '2026-11-01T12:00:00Z' }),
    ])).toEqual(['overdue', 'high', 'planned soon', 'rest']);
  });

  it('breaks ties by the earliest date, then by board position, then by ID', () => {
    expect(sort([
      myIssue({ id: 5, title: 'later overdue', deadline: '2026-11-15T12:00:00Z' }),
      myIssue({ id: 6, title: 'earlier overdue', deadline: '2026-11-01T12:00:00Z' }),
    ])).toEqual(['earlier overdue', 'later overdue']);
    expect(sort([
      myIssue({ id: 7, title: 'position 2', position: 2 }),
      myIssue({ id: 8, title: 'position 1', position: 1 }),
    ])).toEqual(['position 1', 'position 2']);
    expect(sort([
      myIssue({ id: 10, title: 'id 10' }),
      myIssue({ id: 9, title: 'id 9' }),
    ])).toEqual(['id 9', 'id 10']);
  });
});

describe('compareInProgress', () => {
  const sort = (issues: MyIssue[]) => titles([...issues].sort((a, b) => compareInProgress(a, b, TODAY)));

  it('puts the later stage first, from right to left on the board', () => {
    expect(sort([
      myIssue({ id: 1, title: 'stage1', status: 'Stage1' }),
      myIssue({ id: 2, title: 'stage3', status: 'Stage3' }),
      myIssue({ id: 3, title: 'stage4', status: 'Stage4' }),
      myIssue({ id: 4, title: 'stage2', status: 'Stage2' }),
    ])).toEqual(['stage4', 'stage3', 'stage2', 'stage1']);
  });

  it('stage wins over urgency, urgency orders within a stage', () => {
    expect(sort([
      myIssue({ id: 1, title: 'stage1 overdue', status: 'Stage1', deadline: '2026-11-01T12:00:00Z' }),
      myIssue({ id: 2, title: 'stage2 rest', status: 'Stage2' }),
      myIssue({ id: 3, title: 'stage2 high', status: 'Stage2', priority: 'High' }),
    ])).toEqual(['stage2 high', 'stage2 rest', 'stage1 overdue']);
  });
});
