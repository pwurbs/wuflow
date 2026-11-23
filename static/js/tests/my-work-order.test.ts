import { describe, it, expect } from 'vitest';
import { buildLanes, categoryOf } from '../my-work-order.ts';
import { makeIssue, makeProject, makeTask } from './fixtures.ts';
import type { MyIssue } from '../models.ts';

function myIssue(overrides: Partial<MyIssue> = {}): MyIssue {
  return { ...makeIssue({ status: 'Todo', project: makeProject({ id: 1, name: 'Alpha' }) }), status_name: 'Todo', ...overrides };
}

// An issue in its own project, for lane order tests.
function inProject(id: number, name: string, overrides: Partial<MyIssue> = {}) {
  return myIssue({ project_id: id, project: makeProject({ id, name }), ...overrides });
}

const titles = (issues: MyIssue[]) => issues.map(i => i.title);
const laneNames = (issues: MyIssue[]) => buildLanes(issues).map(l => l.projectName);

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
  it('puts each issue into its category and leaves out Open and Archive', () => {
    const [lane] = buildLanes([
      myIssue({ id: 1, title: 'todo', status: 'Todo' }),
      myIssue({ id: 2, title: 'stage1', status: 'Stage1' }),
      myIssue({ id: 3, title: 'stage4', status: 'Stage4' }),
      myIssue({ id: 4, title: 'done', status: 'Done' }),
      myIssue({ id: 5, title: 'open', status: 'Open' }),
      myIssue({ id: 6, title: 'archived', status: 'Archive' }),
    ]);

    expect(titles(lane.cells.notStarted)).toEqual(['todo']);
    expect(titles(lane.cells.inProgress)).toEqual(['stage4', 'stage1']);
    expect(titles(lane.cells.done)).toEqual(['done']);
  });

  it('has no lanes without issues', () => {
    expect(buildLanes([])).toEqual([]);
  });
});

describe('buildLanes: lane order', () => {
  it('puts a project with a High issue before a bigger one without', () => {
    expect(laneNames([
      inProject(1, 'Wide', { id: 1 }),
      inProject(1, 'Wide', { id: 2 }),
      inProject(1, 'Wide', { id: 3, status: 'Stage1' }),
      inProject(2, 'Small', { id: 4, priority: 'High' }),
    ])).toEqual(['Small', 'Wide']);
  });

  it('orders projects with High issues by the nearest deadline of these, overdue first, none last', () => {
    expect(laneNames([
      inProject(1, 'No deadline', { id: 1, priority: 'High' }),
      inProject(2, 'Later', { id: 2, priority: 'High', deadline: '2026-12-20' }),
      inProject(3, 'Overdue', { id: 3, priority: 'High', deadline: '2026-01-05' }),
      inProject(4, 'Sooner', { id: 4, priority: 'High', deadline: '2026-12-01' }),
    ])).toEqual(['Overdue', 'Sooner', 'Later', 'No deadline']);
  });

  it('takes the earliest deadline of all High issues of a project', () => {
    expect(laneNames([
      inProject(1, 'Alpha', { id: 1, priority: 'High', deadline: '2026-12-10' }),
      inProject(2, 'Beta', { id: 2, priority: 'High', deadline: '2026-12-20' }),
      inProject(2, 'Beta', { id: 3, priority: 'High', deadline: '2026-12-05' }),
    ])).toEqual(['Beta', 'Alpha']);
  });

  it('counts the deadline of an open task, not of a done one', () => {
    expect(laneNames([
      inProject(1, 'Alpha', { id: 1, priority: 'High', deadline: '2026-12-10' }),
      inProject(2, 'Beta', { id: 2, priority: 'High', tasks: [makeTask({ done: false, deadline: '2026-12-01' })] }),
      inProject(3, 'Gamma', { id: 3, priority: 'High', tasks: [makeTask({ done: true, deadline: '2026-11-01' })] }),
    ])).toEqual(['Beta', 'Alpha', 'Gamma']);
  });

  it('puts the project with more High issues first when the deadlines are equal', () => {
    expect(laneNames([
      inProject(1, 'Alpha', { id: 1, priority: 'High' }),
      inProject(2, 'Beta', { id: 2, priority: 'High' }),
      inProject(2, 'Beta', { id: 3, priority: 'High' }),
    ])).toEqual(['Beta', 'Alpha']);
  });

  it('ignores deadlines and planned dates of Normal issues', () => {
    expect(laneNames([
      inProject(1, 'Alpha', { id: 1, deadline: '2026-01-05', planned_dates: ['2026-01-05'] }),
      inProject(2, 'Beta', { id: 2 }),
      inProject(2, 'Beta', { id: 3 }),
    ])).toEqual(['Beta', 'Alpha']);
  });

  it('ignores High issues in Done', () => {
    expect(laneNames([
      inProject(1, 'Alpha', { id: 1, priority: 'High', status: 'Done', deadline: '2026-01-05' }),
      inProject(2, 'Beta', { id: 2 }),
    ])).toEqual(['Beta', 'Alpha']);
  });

  it('puts the project with the most open cards first when no project has High issues; Done does not count', () => {
    expect(laneNames([
      inProject(1, 'Alpha', { id: 1 }),
      inProject(1, 'Alpha', { id: 2, status: 'Done' }),
      inProject(1, 'Alpha', { id: 3, status: 'Done' }),
      inProject(2, 'Wide', { id: 4 }),
      inProject(2, 'Wide', { id: 5, status: 'Stage2' }),
    ])).toEqual(['Wide', 'Alpha']);
  });

  it('sorts lanes that are equal otherwise by project name', () => {
    expect(laneNames([
      inProject(3, 'charlie', { id: 1 }),
      inProject(1, 'Alpha', { id: 2 }),
      inProject(2, 'beta', { id: 3 }),
    ])).toEqual(['Alpha', 'beta', 'charlie']);
  });
});

describe('buildLanes: order within a cell', () => {
  it('keeps the board order in every category, in In Progress after the stage', () => {
    const [lane] = buildLanes([
      myIssue({ id: 1, title: 'todo pos 2', status: 'Todo', position: 2 }),
      myIssue({ id: 2, title: 'todo pos 1 overdue high', status: 'Todo', position: 1, priority: 'High', deadline: '2026-01-05' }),
      myIssue({ id: 3, title: 'todo pos 0', status: 'Todo', position: 0 }),
      myIssue({ id: 4, title: 'stage1 pos 0 high', status: 'Stage1', position: 0, priority: 'High' }),
      myIssue({ id: 5, title: 'stage3 pos 1', status: 'Stage3', position: 1 }),
      myIssue({ id: 6, title: 'stage3 pos 0', status: 'Stage3', position: 0 }),
      myIssue({ id: 7, title: 'done pos 1 new', status: 'Done', position: 1, updated_at: '2026-11-15T10:00:00Z' }),
      myIssue({ id: 8, title: 'done pos 0 old', status: 'Done', position: 0, updated_at: '2026-11-01T10:00:00Z' }),
    ]);

    expect(titles(lane.cells.notStarted)).toEqual(['todo pos 0', 'todo pos 1 overdue high', 'todo pos 2']);
    expect(titles(lane.cells.inProgress)).toEqual(['stage3 pos 0', 'stage3 pos 1', 'stage1 pos 0 high']);
    expect(titles(lane.cells.done)).toEqual(['done pos 0 old', 'done pos 1 new']);
  });

  it('puts the later stage first, from right to left on the board', () => {
    const [lane] = buildLanes([
      myIssue({ id: 1, title: 'stage1', status: 'Stage1' }),
      myIssue({ id: 2, title: 'stage3', status: 'Stage3' }),
      myIssue({ id: 3, title: 'stage4', status: 'Stage4' }),
      myIssue({ id: 4, title: 'stage2', status: 'Stage2' }),
    ]);

    expect(titles(lane.cells.inProgress)).toEqual(['stage4', 'stage3', 'stage2', 'stage1']);
  });

  it('breaks ties of the board position by ID', () => {
    const [lane] = buildLanes([
      myIssue({ id: 10, title: 'id 10', position: 0 }),
      myIssue({ id: 9, title: 'id 9', position: 0 }),
    ]);

    expect(titles(lane.cells.notStarted)).toEqual(['id 9', 'id 10']);
  });
});
