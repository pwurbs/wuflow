import { describe, it, expect } from 'vitest';
import { buildLanes, categoryOf, compareUrgency, urgencyRank } from '../my-work-order.ts';
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
  it('makes one lane per project with issues, sorted by project name', () => {
    const lanes = buildLanes([
      myIssue({ id: 1, project_id: 3, project: makeProject({ id: 3, name: 'charlie' }) }),
      myIssue({ id: 2, project_id: 1, project: makeProject({ id: 1, name: 'Alpha' }) }),
      myIssue({ id: 3, project_id: 2, project: makeProject({ id: 2, name: 'beta' }) }),
      myIssue({ id: 4, project_id: 1, project: makeProject({ id: 1, name: 'Alpha' }), status: 'Done' }),
    ], TODAY);

    expect(lanes.map(l => l.projectName)).toEqual(['Alpha', 'beta', 'charlie']);
    expect(lanes.map(l => l.total)).toEqual([2, 1, 1]);
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
    expect(titles(lane.cells.inProgress)).toEqual(['stage1', 'stage4']);
    expect(titles(lane.cells.done)).toEqual(['done']);
    expect(lane.total).toBe(4);
  });

  it('has no lanes without issues', () => {
    expect(buildLanes([], TODAY)).toEqual([]);
  });

  it('sorts Not Started and In Progress by urgency, Done by last update', () => {
    const [lane] = buildLanes([
      myIssue({ id: 1, title: 'rest', status: 'Stage1' }),
      myIssue({ id: 2, title: 'overdue', status: 'Stage2', deadline: '2026-11-16T12:00:00Z' }),
      myIssue({ id: 3, title: 'done old', status: 'Done', updated_at: '2026-11-01T10:00:00Z' }),
      myIssue({ id: 4, title: 'done new', status: 'Done', updated_at: '2026-11-15T10:00:00Z' }),
    ], TODAY);

    expect(titles(lane.cells.inProgress)).toEqual(['overdue', 'rest']);
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
