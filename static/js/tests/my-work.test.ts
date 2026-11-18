import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupMyWorkView, loadMyIssues, renderMyWork, mergeMyIssue } from '../components/my-work.ts';
import * as api from '../api.ts';
import { state } from '../state.ts';
import { byId, bySelector } from '../utils.ts';
import { makeIssue, makeProject, makeRelease, makeUserRef } from './fixtures.ts';
import type { MyIssue } from '../models.ts';

vi.mock('../api.ts', () => ({
  fetchMyIssues: vi.fn(),
  updateIssue: vi.fn(),
}));

const alpha = makeProject({ id: 1, name: 'Alpha' });
const beta = makeProject({ id: 2, name: 'Beta' });
const me = makeUserRef({ id: 5, first_name: 'Me', last_name: 'Myself' });

function myIssue(overrides: Partial<MyIssue>): MyIssue {
  return {
    ...makeIssue({ status: 'Todo', project_id: 1, project: alpha, assignee_id: 5, assignee: me }),
    status_name: 'Todo',
    ...overrides,
  };
}

const ISSUES: MyIssue[] = [
  myIssue({ id: 1, title: 'Beta todo', project_id: 2, project: beta, release_id: 9, release: makeRelease({ id: 9, name: 'v9' }) }),
  myIssue({ id: 2, title: 'Beta testing', project_id: 2, project: beta, status: 'Stage2', status_name: 'Testing', release_id: 9, release: makeRelease({ id: 9, name: 'v9' }) }),
  myIssue({ id: 3, title: 'Alpha working', status: 'Stage1', status_name: 'Working', planned_dates: ['2026-11-17'] }),
  myIssue({ id: 4, title: 'Alpha done', status: 'Done', status_name: 'Done' }),
];

const cell = (laneIndex: number, category: string) =>
  document.querySelectorAll<HTMLElement>(`#my-work-grid .my-work-cell[data-category="${category}"]:not(.my-work-cell--fill)`)[laneIndex];
const cardTitles = (el: HTMLElement) => [...el.querySelectorAll('.board-card-title')].map(t => t.textContent);

describe('My Work view', () => {
  const openModal = vi.fn();

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-17T10:00:00'));
    document.body.innerHTML = `
      <div id="my-work-grid"></div>
      <div id="my-work-planning-list"></div>
      <span id="my-work-planning-count"></span>
    `;
    vi.clearAllMocks();
    setupMyWorkView(openModal);
    vi.mocked(api.fetchMyIssues).mockResolvedValue(structuredClone(ISSUES));
    await loadMyIssues();
    renderMyWork();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the three category headers with their totals in one head', () => {
    const headers = [...document.querySelectorAll('#my-work-grid > .my-work-head > .column-header')];
    expect(headers.map(h => h.querySelector('h2')?.textContent)).toEqual(['Not Started', 'In Progress', 'Done']);
    expect(headers.map(h => h.querySelector('.count')?.textContent)).toEqual(['1', '2', '1']);
  });

  it('names each project lane, alphabetically, in a pill in its Not Started cell', () => {
    const pills = [...document.querySelectorAll<HTMLElement>('#my-work-grid .my-work-lane-pill')];
    expect(pills.map(p => p.textContent)).toEqual(['Alpha', 'Beta']);
    expect(pills.map(p => p.title)).toEqual(['Alpha', 'Beta']);
    expect(pills.map(p => p.closest<HTMLElement>('.my-work-cell')?.dataset.category)).toEqual(['notStarted', 'notStarted']);
    expect(pills[0].querySelector('svg.my-work-lane-icon')).not.toBeNull();
    // No count per lane: the category headers have them.
    expect(pills[0].querySelector('.count')).toBeNull();
  });

  it('draws a separator line only between two lanes', () => {
    const grid = byId('my-work-grid');
    const separators = [...grid.querySelectorAll('.my-work-lane-separator')];
    expect(separators).toHaveLength(1);
    expect(separators[0].previousElementSibling).toBe(cell(0, 'done'));
    expect(separators[0].nextElementSibling).toBe(cell(1, 'notStarted'));
  });

  it('puts each card into its project lane and category', () => {
    expect(cardTitles(cell(0, 'inProgress'))).toEqual(['Alpha working']);
    expect(cardTitles(cell(0, 'done'))).toEqual(['Alpha done']);
    expect(cardTitles(cell(1, 'notStarted'))).toEqual(['Beta todo']);
    expect(cardTitles(cell(1, 'inProgress'))).toEqual(['Beta testing']);
  });

  it('shows the column name chip only in In Progress, in place of the release', () => {
    expect(bySelector(cell(1, 'inProgress'), '.stage-chip').textContent).toBe('Testing');
    expect(bySelector(cell(0, 'inProgress'), '.stage-chip').textContent).toBe('Working');
    expect(cell(1, 'notStarted').querySelector('.release-chip')).toBeNull();
    expect(cell(0, 'done').querySelector('.release-chip')).toBeNull();
    expect(byId('my-work-grid').textContent).not.toContain('v9');
  });

  it('shows board cards without assignee badge that open the issue and cannot be dragged', () => {
    const cards = [...document.querySelectorAll<HTMLElement>('#my-work-grid .card.board-card')];
    expect(cards).toHaveLength(4);
    cards.forEach(card => {
      expect(card.querySelector('.user-badge')).toBeNull();
      expect(card.draggable).toBe(false);
    });

    bySelector(cell(1, 'inProgress'), '.card').click();
    expect(openModal).toHaveBeenCalledWith(expect.objectContaining({ id: 2, project_id: 2 }));
  });

  it('shows my planning read-only with the project name under the title', () => {
    const list = byId('my-work-planning-list');
    const item = bySelector(list, '.planning-item[data-id="3"]');
    expect(item.draggable).toBe(false);
    expect(item.querySelector('.user-badge')).toBeNull();
    expect(item.querySelector('.planning-item-remove')).toBeNull();
    expect(bySelector(item, '.planning-item-project').textContent).toBe('Alpha');
    expect(byId('my-work-planning-count').textContent).toBe('1');

    item.click();
    expect(openModal).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }));
  });

  it('applies changes from the issue dialog to the cached issue', () => {
    mergeMyIssue(makeIssue({ ...ISSUES[2], title: 'Renamed', priority: 'High' }));
    renderMyWork();

    expect(cardTitles(cell(0, 'inProgress'))).toEqual(['Renamed']);
    // The column name comes from the list endpoint and is kept.
    expect(bySelector(cell(0, 'inProgress'), '.stage-chip').textContent).toBe('Working');
  });

  it('shows a message when no active issues are assigned', async () => {
    vi.mocked(api.fetchMyIssues).mockResolvedValue([]);
    await loadMyIssues();
    renderMyWork();

    expect(bySelector(document, '.my-work-empty').textContent).toBe('No active issues are assigned to you.');
    expect(document.querySelectorAll('.my-work-lane-pill')).toHaveLength(0);
    expect(document.querySelectorAll('.my-work-lane-separator')).toHaveLength(0);
  });

  describe('filters', () => {
    afterEach(() => {
      state.filter.search = '';
      state.filter.priority = null;
      state.filter.labelId = null;
    });

    it('filters cards, lanes and planning by title or description and shows "shown/total"', () => {
      mergeMyIssue(makeIssue({ ...ISSUES[2], description: 'contains the needle' }));
      state.filter.search = 'needle';
      renderMyWork();

      expect(cardTitles(byId('my-work-grid'))).toEqual(['Alpha working']);
      expect([...document.querySelectorAll('.my-work-lane-name')].map(l => l.textContent)).toEqual(['Alpha']);
      const counts = [...document.querySelectorAll('#my-work-grid .column-header .count')].map(c => c.textContent);
      expect(counts).toEqual(['0/1', '1/2', '0/1']);
      expect(byId('my-work-planning-count').textContent).toBe('1/1');
    });

    it('filters cards, lanes and planning by priority and shows "shown/total"', () => {
      mergeMyIssue(makeIssue({ ...ISSUES[1], priority: 'High' }));
      state.filter.priority = 'High';
      renderMyWork();

      expect(cardTitles(byId('my-work-grid'))).toEqual(['Beta testing']);
      expect([...document.querySelectorAll('.my-work-lane-name')].map(l => l.textContent)).toEqual(['Beta']);
      expect(document.querySelectorAll('.my-work-lane-separator')).toHaveLength(0);
      const counts = [...document.querySelectorAll('#my-work-grid .column-header .count')].map(c => c.textContent);
      expect(counts).toEqual(['0/1', '1/2', '0/1']);
      // The only planned issue (Alpha working) has normal priority.
      expect(byId('my-work-planning-list').querySelector('.planning-item')).toBeNull();
      expect(byId('my-work-planning-count').textContent).toBe('0/1');
    });

    it('combines the priority filter with the search', () => {
      mergeMyIssue(makeIssue({ ...ISSUES[1], priority: 'High' }));
      mergeMyIssue(makeIssue({ ...ISSUES[2], priority: 'High' }));
      state.filter.priority = 'High'; // leaves out Beta todo
      state.filter.search = 'beta'; // leaves out Alpha working
      renderMyWork();

      expect(cardTitles(byId('my-work-grid'))).toEqual(['Beta testing']);
    });

    it('ignores the project filters of the toolbar', () => {
      state.filter.labelId = 99; // a label filter set on a project board
      renderMyWork();

      expect(document.querySelectorAll('#my-work-grid .card')).toHaveLength(4);
      expect(document.querySelectorAll('#my-work-grid .column-header .count')[1].textContent).toBe('2');
    });

    it('says so when nothing matches', () => {
      state.filter.search = 'no such text';
      renderMyWork();

      expect(bySelector(document, '.my-work-empty').textContent).toBe('No issues match the filters.');
    });

    it('says so when no issue has the chosen priority', () => {
      state.filter.priority = 'High';
      renderMyWork();

      expect(bySelector(document, '.my-work-empty').textContent).toBe('No issues match the filters.');
      expect(document.querySelectorAll('#my-work-grid .column-header .count')[0].textContent).toBe('0/1');
    });
  });

  it('passes a load error on and keeps the last list', async () => {
    vi.mocked(api.fetchMyIssues).mockRejectedValue(new Error('offline'));

    await expect(loadMyIssues()).rejects.toThrow('offline');
    renderMyWork();
    expect(document.querySelectorAll('#my-work-grid .card')).toHaveLength(4);
  });
});
