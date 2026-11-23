import { describe, it, expect, vi, beforeEach, afterEach, assert } from 'vitest';
import { getEffectiveDeadlineInfo, createDeadlineBadge, renderPlanningPanel, processDroppedCard, setupPlanningPanel, buildPlanningList } from '../components/planning.ts';
import type { Issue, ReleaseRef } from '../models.ts';
import * as api from '../api.ts';
import * as utils from '../utils.ts';
import { state, isFilterActive } from '../state.ts'; // Imported from mock

// Mock dependencies
vi.mock('../utils.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils.ts')>();
  return {
    byId: actual.byId, bySelector: actual.bySelector, errorMessage: actual.errorMessage, containsTarget: actual.containsTarget,
    getDeadlineStatus: actual.getDeadlineStatus, getTaskDeadlineStatus: actual.getTaskDeadlineStatus, showNotification: vi.fn(),
    todayISO: actual.todayISO, addDaysISO: actual.addDaysISO, formatISODate: actual.formatISODate,
  };
});
import { makeIssue, makeProject, makeTask, makeUserRef } from './fixtures.ts';
import { byId, bySelector } from '../utils.ts';

vi.mock('../state.ts', () => ({
  state: {
    issues: [],
    filter: { label: null, priority: null, search: '' },
    currentUser: { role: 'admin' }
  },
  isFilterActive: vi.fn(),
}));

vi.mock('../api.ts', () => ({
  updateIssue: vi.fn(),
}));

vi.mock('../drag.ts', () => ({
  getDraggedCard: vi.fn(),
  setDraggedCard: vi.fn(),
}));

describe('planning.ts', () => {
  const baseDate = new Date('2023-10-10T12:00:00'); // Tuesday

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(baseDate);
    // Setup minimal DOM for renderPlanningPanel
    document.body.innerHTML = `
      <div id="planning-list"></div>
      <span id="planning-count">0</span>
    `;
    state.issues = [];
    state.filter.search = '';
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('getEffectiveDeadlineInfo', () => {
    it('returns null if no deadline in issue or tasks', () => {
      const issue = makeIssue({ id: 1, tasks: [] });
      expect(getEffectiveDeadlineInfo(issue)).toBeNull();
    });

    it('returns issue deadline if no tasks', () => {
      const issue = makeIssue({ id: 1, deadline: '2023-10-15', tasks: [] });
      expect(getEffectiveDeadlineInfo(issue)).toEqual({ date: '2023-10-15', isTask: false });
    });

    it('returns task deadline if issue has no deadline', () => {
      const issue = makeIssue({
        id: 1,
        tasks: [makeTask({ id: 1, deadline: '2023-10-12', done: false })]
      });
      expect(getEffectiveDeadlineInfo(issue)).toEqual({ date: '2023-10-12', isTask: true });
    });

    it('returns earliest deadline between issue and tasks', () => {
      const issue = makeIssue({
        id: 1,
        deadline: '2023-10-20',
        tasks: [
          makeTask({ id: 1, deadline: '2023-10-25', done: false }), // Later
          makeTask({ id: 2, deadline: '2023-10-18', done: false })  // Earliest
        ]
      });
      expect(getEffectiveDeadlineInfo(issue)).toEqual({ date: '2023-10-18', isTask: true });
    });

    it('ignores done tasks', () => {
      const issue = makeIssue({
        id: 1,
        deadline: '2023-10-20',
        tasks: [
          makeTask({ id: 1, deadline: '2023-10-10', done: true }) // Overdue but done
        ]
      });
      expect(getEffectiveDeadlineInfo(issue)).toEqual({ date: '2023-10-20', isTask: false });
    });
  });

  describe('createDeadlineBadge', () => {
    it('returns null if no effective deadline', () => {
      const issue = makeIssue({ id: 1 });
      expect(createDeadlineBadge(issue)).toBeNull();
    });

    it('creates standard deadline badge', () => {
      const issue = makeIssue({ id: 1, deadline: '2023-10-15' });
      const badge = createDeadlineBadge(issue);
      assert(badge);

      expect(badge.tagName).toBe('SPAN');
      expect(badge.textContent).toBe('Oct 15');
      expect(badge.title).toBe('Deadline');
      expect(badge.className).toBe('planning-item-deadline ');
    });

    it('creates overdue warning badge', () => {
      const issue = makeIssue({ id: 1, deadline: '2023-10-05' });
      const badge = createDeadlineBadge(issue);
      assert(badge);

      expect(badge.textContent).toBe('Oct 5');
      expect(badge.title).toBe('Overdue!');
      expect(badge.classList.contains('overdue')).toBe(true);
    });

    it('indicates Task Deadline in tooltip', () => {
      const issue = makeIssue({
        id: 1,
        tasks: [makeTask({ id: 1, deadline: '2023-10-12', done: false })]
      });
      const badge = createDeadlineBadge(issue);
      assert(badge);

      expect(badge.title).toBe('Task Deadline');
    });

    it('shows Planned Late warning if planned date > deadline', () => {
      const issue = makeIssue({
        id: 1,
        deadline: '2023-10-12',
        planned_dates: ['2023-10-15']
      });
      const badge = createDeadlineBadge(issue, '2023-10-15');
      assert(badge);

      expect(badge.textContent).toBe('Oct 12');
      expect(badge.classList.contains('overdue')).toBe(true);
      expect(badge.title).toBe('Planned late!');
    });

    it('uses latest planned date for late warning if no specific date provided', () => {
      const issue = makeIssue({
        id: 1,
        deadline: '2023-10-12',
        planned_dates: ['2023-10-10', '2023-10-15']
      });
      // No specificDateStr provided (e.g. general board view summary)
      const badge = createDeadlineBadge(issue);
      assert(badge);

      expect(badge.classList.contains('overdue')).toBe(true);
      expect(badge.title).toBe('Planned late!');
    });

    // Same rules as the deadline on the card (getDeadlineStatus / getTaskDeadlineStatus).
    const release: ReleaseRef = { id: 1, name: 'R1', status: 'open', release_date: '2023-10-14' };

    it('warns if the issue deadline is after the release date', () => {
      const badge = createDeadlineBadge(makeIssue({ id: 1, deadline: '2023-10-15', release }));
      assert(badge);

      expect(badge.classList.contains('overdue')).toBe(true);
      expect(badge.title).toBe('Past release date!');
    });

    it('warns if a task deadline without issue deadline is after the release date', () => {
      const issue = makeIssue({
        id: 1,
        release,
        tasks: [makeTask({ id: 1, deadline: '2023-10-15', done: false })],
      });
      const badge = createDeadlineBadge(issue);
      assert(badge);

      expect(badge.classList.contains('overdue')).toBe(true);
      expect(badge.title).toBe('Past release date!');
    });

    it('keeps a deadline before the release date unmarked', () => {
      const badge = createDeadlineBadge(makeIssue({ id: 1, deadline: '2023-10-13', release }));
      assert(badge);

      expect(badge.classList.contains('overdue')).toBe(false);
      expect(badge.title).toBe('Deadline');
    });
  });

  // Calendar dates count as the viewer's local day; the tz-west/tz-east projects run these too.
  describe('calendar-day boundaries (today is 2023-10-10)', () => {
    const titlesIn = (selector: string) =>
      [...byId('planning-list').querySelectorAll(`${selector} .planning-item-title`)].map(el => el.textContent);

    it('a deadline today is not overdue, one yesterday is', () => {
      expect(createDeadlineBadge(makeIssue({ id: 1, deadline: '2023-10-10' }))?.title).toBe('Deadline');
      expect(createDeadlineBadge(makeIssue({ id: 2, deadline: '2023-10-09' }))?.title).toBe('Overdue!');
    });

    it('shows the badge with the deadline day itself', () => {
      expect(createDeadlineBadge(makeIssue({ id: 1, deadline: '2023-10-12' }))?.textContent).toBe('Oct 12');
    });

    it('marks a plan one day after the deadline as late, not one on the deadline', () => {
      const issue = makeIssue({ id: 1, deadline: '2023-10-12', planned_dates: ['2023-10-12', '2023-10-13'] });
      expect(createDeadlineBadge(issue, '2023-10-12')?.title).toBe('Deadline');
      expect(createDeadlineBadge(issue, '2023-10-13')?.title).toBe('Planned late!');
    });

    it('puts plans up to day 9 in their day column, from day 10 in Future, before today in Past', () => {
      state.issues = [
        makeIssue({ id: 1, title: 'Yesterday', planned_dates: ['2023-10-09'], status: 'Todo' }),
        makeIssue({ id: 2, title: 'Today', planned_dates: ['2023-10-10'], status: 'Todo' }),
        makeIssue({ id: 3, title: 'Day 9', planned_dates: ['2023-10-19'], status: 'Todo' }),
        makeIssue({ id: 4, title: 'Day 10', planned_dates: ['2023-10-20'], status: 'Todo' }),
      ];
      renderPlanningPanel();

      expect(titlesIn('#day-past')).toEqual(['Yesterday']);
      expect(titlesIn('#day-2023-10-10')).toEqual(['Today']);
      expect(titlesIn('#day-2023-10-19')).toEqual(['Day 9']);
      expect(titlesIn('#day-future')).toEqual(['Day 10']);
    });

    it('lists an unplanned deadline on day 10 as near term, on day 11 as far term', () => {
      state.issues = [
        makeIssue({ id: 1, title: 'Day 10', deadline: '2023-10-20', planned_dates: [], status: 'Todo' }),
        makeIssue({ id: 2, title: 'Day 11', deadline: '2023-10-21', planned_dates: [], status: 'Todo' }),
      ];
      renderPlanningPanel();

      expect(titlesIn('.planning-section-content.far-term')).toEqual(['Day 11']);
      expect(titlesIn('.planning-section-unscheduled')).toEqual(['Day 10', 'Day 11']);
    });

    it('starts the day columns with today also late in the evening', () => {
      vi.setSystemTime(new Date(2023, 9, 10, 23, 30));
      renderPlanningPanel();
      expect(bySelector(byId('planning-list'), '.planning-day').dataset.date).toBe('2023-10-10');
    });
  });

  describe('renderPlanningPanel', () => {
    it('renders basic structure (next 10 days)', () => {
      renderPlanningPanel();

      const list = byId('planning-list');
      // 10 days generated loop + maybe Past/Future logic
      // Should have at least 10 '.planning-day' elements
      expect(list.querySelectorAll('.planning-day').length).toBeGreaterThanOrEqual(10);

      // Check first day is Today (Oct 10)
      const firstDay = bySelector(list, '.planning-day');
      expect(firstDay.textContent).toContain('Oct 10'); // "Tue, Oct 10"

      // Check count
      expect(byId('planning-count').textContent).toBe('0');
    });

    it('renders unscheduled issues section with near and far term splitting', () => {
      // Mock date is 2023-10-10
      state.issues = [
        makeIssue({ id: 1, title: 'Near Term', deadline: '2023-10-15', planned_dates: [], status: 'Todo' }), // +5 days
        makeIssue({ id: 2, title: 'Far Term', deadline: '2023-10-25', planned_dates: [], status: 'Todo' })  // +15 days
      ];

      renderPlanningPanel();

      const unscheduledSection = bySelector(byId('planning-list'), '.planning-section-unscheduled');
      expect(bySelector(unscheduledSection, '.planning-section-title').textContent).toBe('Unplanned Deadlines');

      // Near term should be directly in the content
      const planningItems = unscheduledSection.querySelectorAll('.planning-item');
      // Both are in the DOM, but one is in the far-term container
      expect(planningItems).toHaveLength(2);

      const farHeader = bySelector(unscheduledSection, '.planning-section-subheader');
      expect(farHeader).not.toBeNull();
      expect(farHeader.textContent).toContain('10+ days away [1]');

      const farContent = bySelector(unscheduledSection, '.planning-section-content.far-term');
      expect(farContent.style.display).toBe('none'); // Default collapsed
    });

    it('toggles far term section visibility', () => {
      state.issues = [
        makeIssue({ id: 2, title: 'Far Term', deadline: '2023-10-25', planned_dates: [], status: 'Todo' })
      ];

      renderPlanningPanel();
      const unscheduledSection = bySelector(byId('planning-list'), '.planning-section-unscheduled');
      const farHeader = bySelector(unscheduledSection, '.planning-section-subheader');
      const farContent = bySelector(unscheduledSection, '.planning-section-content.far-term');

      // Click to expand
      farHeader.click();
      expect(farContent.style.display).toBe('flex');

      // Click to collapse
      farHeader.click();
      expect(farContent.style.display).toBe('none');
    });

    it('renders planned issues in correct day slot', () => {
      state.issues = [
        makeIssue({ id: 1, title: 'Planned Today', planned_dates: ['2023-10-10'], status: 'Todo' }), // Today
        makeIssue({ id: 2, title: 'Planned Tomorrow', planned_dates: ['2023-10-11'], status: 'Todo' }) // Tomorrow
      ];

      renderPlanningPanel();

      const list = byId('planning-list');

      const dayToday = bySelector(list, '#day-2023-10-10');
      expect(dayToday).not.toBeNull();
      expect(dayToday.querySelectorAll('.planning-item')).toHaveLength(1);
      expect(dayToday.textContent).toContain('Planned Today');

      const dayTomorrow = bySelector(list, '#day-2023-10-11');
      expect(dayTomorrow).not.toBeNull();
      expect(dayTomorrow.textContent).toContain('Planned Tomorrow');

      expect(byId('planning-count').textContent).toBe('2');
    });

    it('renders Past Planning section for overdue planned issues', () => {
      state.issues = [
        makeIssue({ id: 1, title: 'Old Plan', planned_dates: ['2023-10-01'], status: 'Todo' })
      ];

      renderPlanningPanel();

      const pastDay = byId('day-past');
      expect(pastDay).not.toBeNull();
      expect(pastDay.classList.contains('past')).toBe(true);
      expect(pastDay.textContent).toContain('Past Planning');
      expect(pastDay.textContent).toContain('Old Plan');
    });

    it('renders Future Planning section for distant future issues', () => {
      state.issues = [
        makeIssue({ id: 1, title: 'Far Future', planned_dates: ['2023-12-01'], status: 'Todo' })
      ];

      renderPlanningPanel();

      const futureDay = byId('day-future');
      expect(futureDay).not.toBeNull();
      expect(futureDay.textContent).toContain('Future Planning');
      expect(futureDay.textContent).toContain('Far Future');
    });

    it('toggles empty class on days', () => {
      renderPlanningPanel();
      const list = byId('planning-list');
      const emptyDay = bySelector(list, '.planning-day');
      expect(emptyDay.classList.contains('empty')).toBe(true);
    });

    it('removes date when clicking remove button on planning item', async () => {
      const issue = makeIssue({ id: 1, title: 'Test', planned_dates: ['2023-10-10'], status: 'Todo' });
      state.issues = [issue];

      renderPlanningPanel();

      const list = byId('planning-list');
      const item = bySelector(list, '.planning-item');
      const removeBtn = bySelector(item, '.planning-item-remove');

      await removeBtn.click();

      expect(issue.planned_dates).toEqual([]);
      expect(api.updateIssue).toHaveBeenCalled();
    });

    it('setupPlanningPanel wires up the callbacks used when rendering without args', async () => {
      const openModal = vi.fn();
      const rerenderActiveView = vi.fn();
      setupPlanningPanel(vi.fn(), openModal, rerenderActiveView);

      const issue = makeIssue({ id: 1, title: 'Test', planned_dates: ['2023-10-10'], status: 'Todo' });
      state.issues = [issue];

      // Render with no args — must reuse the callbacks set via setupPlanningPanel.
      renderPlanningPanel();

      const list = byId('planning-list');
      const item = bySelector(list, '.planning-item');
      item.click();
      expect(openModal).toHaveBeenCalledWith(issue);

      const removeBtn = bySelector(item, '.planning-item-remove');
      await removeBtn.click();
      expect(rerenderActiveView).toHaveBeenCalled();
    });

    it('filters issues based on state filter', () => {
      state.issues = [
        makeIssue({ id: 1, title: 'Keep', planned_dates: ['2023-10-10'], status: 'Todo' }),
        makeIssue({ id: 2, title: 'Filtered', planned_dates: ['2023-10-10'], status: 'Todo' })
      ];
      state.filter.search = 'Keep';

      renderPlanningPanel();

      const list = byId('planning-list');
      const dayToday = bySelector(list, '#day-2023-10-10');

      expect(dayToday.querySelectorAll('.planning-item')).toHaveLength(1);
      expect(dayToday.textContent).toContain('Keep');
      expect(dayToday.textContent).not.toContain('Filtered');
    });

    it('should revert planned_dates and show notification when remove date button fails', async () => {
      const refreshApp = vi.fn();
      const rerenderActiveView = vi.fn();
      const issue = makeIssue({ id: 1, title: 'Test', planned_dates: ['2023-10-10'], status: 'Todo' });
      state.issues = [issue];

      renderPlanningPanel(refreshApp, vi.fn(), rerenderActiveView);

      vi.mocked(api.updateIssue).mockRejectedValueOnce(new Error('Remove failed'));

      const list = byId('planning-list');
      const removeBtn = bySelector(list, '.planning-item-remove');
      await removeBtn.click();

      expect(issue.planned_dates).toEqual(['2023-10-10']); // reverted
      expect(utils.showNotification).toHaveBeenCalledWith('Remove failed', 'error');
      // Local state is already reverted, so only a light re-render is needed — not a full refresh.
      expect(rerenderActiveView).toHaveBeenCalled();
      expect(refreshApp).not.toHaveBeenCalled();
    });

    it('should show notification and call refreshApp when planning drop fails', async () => {
      const refreshApp = vi.fn();
      const issue = makeIssue({ id: 1, title: 'Test', planned_dates: [], status: 'Todo' });
      state.issues = [issue];

      const dragModule = await import('../drag.ts');
      const draggedCard = document.createElement('div');
      draggedCard.dataset.id = '1';
      vi.mocked(dragModule.getDraggedCard).mockReturnValue(draggedCard);

      vi.mocked(api.updateIssue).mockRejectedValueOnce(new Error('Drop failed'));

      renderPlanningPanel(refreshApp, vi.fn());

      // Dispatch drop on today's day slot
      const dayToday = byId('day-2023-10-10');
      dayToday.dispatchEvent(new Event('drop'));

      await vi.waitFor(() => {
        expect(utils.showNotification).toHaveBeenCalledWith('Drop failed', 'error');
        expect(refreshApp).toHaveBeenCalled();
      });
    });

    it('shows the assignee badge before the title of a draggable item, without a second line', () => {
      state.issues = [makeIssue({
        id: 1, title: 'Assigned', planned_dates: ['2023-10-10'], status: 'Todo',
        assignee_id: 3, assignee: makeUserRef({ id: 3, first_name: 'Ada', last_name: 'Lovelace' }),
      })];

      renderPlanningPanel();

      const item = bySelector(byId('planning-list'), '.planning-item');
      expect(item.draggable).toBe(true);
      expect(item.classList.contains('read-only')).toBe(false);
      expect(item.firstElementChild?.classList.contains('user-badge')).toBe(true);
      expect(item.firstElementChild?.textContent).toBe('AL');
      expect(item.querySelector('.planning-item-text')).toBeNull();
    });

    it('shows "shown/total" while a filter is active, counting unplanned deadlines and planned dates but not Done', () => {
      state.issues = [
        makeIssue({ id: 1, title: 'Keep', planned_dates: ['2023-10-10', '2023-10-11'], status: 'Todo' }),
        makeIssue({ id: 2, title: 'Hidden unplanned', deadline: '2023-10-12', planned_dates: [], status: 'Todo' }),
        makeIssue({ id: 3, title: 'Hidden done', planned_dates: ['2023-10-10'], status: 'Done' }),
      ];
      state.filter.search = 'Keep';
      vi.mocked(isFilterActive).mockReturnValueOnce(true);

      renderPlanningPanel();

      // shown: Keep's 2 dates; total: Keep's 2 dates + 1 unplanned deadline, Done not counted
      expect(byId('planning-count').textContent).toBe('2/3');
    });

    it('makes planned and unplanned items drag sources', async () => {
      const dragModule = await import('../drag.ts');
      state.issues = [
        makeIssue({ id: 1, title: 'Planned', planned_dates: ['2023-10-10'], status: 'Todo' }),
        makeIssue({ id: 2, title: 'Unplanned', deadline: '2023-10-12', planned_dates: [], status: 'Todo' }),
      ];
      renderPlanningPanel();

      const cases: [string, string][] = [['.planning-item[data-id="1"]', 'copyMove'], ['.planning-item.unscheduled', 'move']];
      for (const [selector, effect] of cases) {
        const item = bySelector(byId('planning-list'), selector);
        const dataTransfer = { effectAllowed: '' };
        item.dispatchEvent(Object.assign(new Event('dragstart'), { dataTransfer }));
        expect(dragModule.setDraggedCard).toHaveBeenLastCalledWith(item);
        expect(item.classList.contains('dragging')).toBe(true);
        expect(dataTransfer.effectAllowed).toBe(effect);

        item.dispatchEvent(new Event('dragend'));
        expect(dragModule.setDraggedCard).toHaveBeenLastCalledWith(null);
        expect(item.classList.contains('dragging')).toBe(false);
      }
    });

    it('highlights every card of the issue while hovering its item', () => {
      // Two cards with the same ID: the hidden board and My Work can both show the issue.
      document.body.insertAdjacentHTML('beforeend', '<div class="card" data-id="1"></div><div class="card" data-id="1"></div><div class="card" data-id="2"></div>');
      state.issues = [makeIssue({ id: 1, title: 'Planned', planned_dates: ['2023-10-10'], status: 'Todo' })];
      renderPlanningPanel();
      const item = bySelector(byId('planning-list'), '.planning-item');
      const highlighted = () => [...document.querySelectorAll<HTMLElement>('.card.hover-highlight')].map(c => c.dataset.id);

      item.dispatchEvent(new Event('mouseenter'));
      expect(highlighted()).toEqual(['1', '1']);

      item.dispatchEvent(new Event('mouseleave'));
      expect(highlighted()).toEqual([]);
    });
  });

  describe('buildPlanningList read-only (My Work)', () => {
    const projectLine = (issue: Issue) => {
      const el = document.createElement('span');
      el.className = 'planning-item-project';
      el.textContent = issue.project?.name ?? '';
      return el;
    };

    function buildReadOnly(issues: Issue[], openModal = vi.fn()) {
      const list = document.createElement('div');
      document.body.appendChild(list);
      const count = buildPlanningList(list, issues, { readOnly: true, itemSubline: projectLine, openModal });
      return { list, count, openModal };
    }

    it('renders items without drag, drop, remove button or element IDs', async () => {
      const issue = makeIssue({ id: 1, title: 'Mine', planned_dates: ['2023-10-10', '2023-10-01'], status: 'Todo' });
      const { list, count } = buildReadOnly([issue]);

      expect(count).toBe(2);
      expect(list.querySelectorAll('[id]')).toHaveLength(0);
      expect(list.querySelector('.planning-item-remove')).toBeNull();
      list.querySelectorAll<HTMLElement>('.planning-item').forEach(item => {
        expect(item.draggable).toBe(false);
        expect(item.classList.contains('read-only')).toBe(true);
      });

      const dragModule = await import('../drag.ts');
      const dragged = document.createElement('div');
      dragged.dataset.id = '1';
      vi.mocked(dragModule.getDraggedCard).mockReturnValue(dragged);
      bySelector(list, '.planning-day[data-date="2023-10-11"]').dispatchEvent(new Event('drop'));
      await Promise.resolve();
      expect(api.updateIssue).not.toHaveBeenCalled();
    });

    it('shows the project name as a line under the title, without assignee badge', () => {
      const issue = makeIssue({
        id: 1, title: 'Mine', planned_dates: ['2023-10-10'], status: 'Todo',
        assignee_id: 3, assignee: makeUserRef({ id: 3, first_name: 'Ada', last_name: 'Lovelace' }),
        project: makeProject({ id: 2, name: 'Beta Project' }),
      });
      const { list } = buildReadOnly([issue]);

      const item = bySelector(list, '.planning-item');
      expect(item.querySelector('.user-badge')).toBeNull();
      const text = bySelector(item, '.planning-item-text');
      expect([...text.children].map(c => c.className)).toEqual(['planning-item-title', 'planning-item-project']);
      expect(bySelector(text, '.planning-item-project').textContent).toBe('Beta Project');
    });

    it('opens the issue on click, also for an unplanned deadline', () => {
      const planned = makeIssue({ id: 1, title: 'Planned', planned_dates: ['2023-10-10'], status: 'Todo' });
      const unplanned = makeIssue({ id: 2, title: 'Unplanned', deadline: '2023-10-12', planned_dates: [], status: 'Todo' });
      const { list, openModal } = buildReadOnly([planned, unplanned]);

      bySelector(list, '.planning-item[data-id="1"]').click();
      const unscheduled = bySelector(list, '.planning-item.unscheduled');
      expect(unscheduled.draggable).toBe(false);
      unscheduled.click();

      expect(openModal).toHaveBeenNthCalledWith(1, planned);
      expect(openModal).toHaveBeenNthCalledWith(2, unplanned);
    });

    it('does not collide with the board panel in the same document', () => {
      state.issues = [makeIssue({ id: 1, title: 'Board issue', planned_dates: ['2023-10-10'], status: 'Todo' })];
      const { list } = buildReadOnly([makeIssue({ id: 2, title: 'My issue', planned_dates: ['2023-10-10'], status: 'Todo' })]);

      renderPlanningPanel();

      const boardToday = byId('day-2023-10-10');
      expect(boardToday.textContent).toContain('Board issue');
      expect(boardToday.textContent).not.toContain('My issue');
      const myToday = bySelector(list, '.planning-day[data-date="2023-10-10"]');
      expect(myToday.textContent).toContain('My issue');
      expect(myToday.textContent).not.toContain('Board issue');
    });
  });

  describe('processDroppedCard', () => {
    it('adds new date to planned_dates when dragging from unscheduled', async () => {
      const issue = makeIssue({ id: 1, title: 'Test', planned_dates: [] });
      state.issues = [issue];

      const draggedCard = document.createElement('div');
      draggedCard.dataset.id = '1';
      // sourceDateStr is undefined (from unscheduled)

      await processDroppedCard(draggedCard, '2023-10-15');

      expect(issue.planned_dates).toEqual(['2023-10-15']);
      expect(api.updateIssue).toHaveBeenCalled();
    });

    it('moves instance when dragging between days', async () => {
      const issue = makeIssue({ id: 1, title: 'Test', planned_dates: ['2023-10-10', '2023-10-12'] });
      state.issues = [issue];

      const draggedCard = document.createElement('div');
      draggedCard.dataset.id = '1';
      draggedCard.dataset.dateInstance = '2023-10-10'; // Moving this one

      await processDroppedCard(draggedCard, '2023-10-15');

      // Removed 10-10, added 10-15
      expect(issue.planned_dates).toEqual(['2023-10-12', '2023-10-15']);
      expect(api.updateIssue).toHaveBeenCalled();
    });

    it('ignores drop if date already exists', async () => {
      const issue = makeIssue({ id: 1, title: 'Test', planned_dates: ['2023-10-10'] });
      state.issues = [issue];

      const draggedCard = document.createElement('div');
      draggedCard.dataset.id = '1';

      await processDroppedCard(draggedCard, '2023-10-10');

      expect(issue.planned_dates).toEqual(['2023-10-10']);
      expect(api.updateIssue).not.toHaveBeenCalled();
    });
  });
});
