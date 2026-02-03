import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getEffectiveDeadlineInfo, createDeadlineBadge, renderPlanningPanel } from '../components/planning.js';
import { state } from '../state.js'; // Imported from mock

// Mock dependencies
vi.mock('../state.js', () => ({
  state: {
    issues: []
  }
}));

vi.mock('../api.js', () => ({
  updateIssue: vi.fn(),
}));

vi.mock('../drag.js', () => ({
  getDraggedCard: vi.fn(),
  setDraggedCard: vi.fn(),
}));

describe('planning.js', () => {
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
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('getEffectiveDeadlineInfo', () => {
    it('returns null if no deadline in issue or tasks', () => {
      const issue = { id: 1, tasks: [] };
      expect(getEffectiveDeadlineInfo(issue)).toBeNull();
    });

    it('returns issue deadline if no tasks', () => {
      const issue = { id: 1, deadline: '2023-10-15', tasks: [] };
      const result = getEffectiveDeadlineInfo(issue);
      expect(result).toEqual({ date: new Date('2023-10-15'), isTask: false });
    });

    it('returns task deadline if issue has no deadline', () => {
      const issue = {
        id: 1,
        tasks: [{ id: 't1', deadline: '2023-10-12', done: false }]
      };
      const result = getEffectiveDeadlineInfo(issue);
      expect(result).toEqual({ date: new Date('2023-10-12'), isTask: true });
    });

    it('returns earliest deadline between issue and tasks', () => {
      const issue = {
        id: 1,
        deadline: '2023-10-20',
        tasks: [
          { id: 't1', deadline: '2023-10-25', done: false }, // Later
          { id: 't2', deadline: '2023-10-18', done: false }  // Earliest
        ]
      };
      const result = getEffectiveDeadlineInfo(issue);
      expect(result).toEqual({ date: new Date('2023-10-18'), isTask: true });
    });

    it('ignores done tasks', () => {
      const issue = {
        id: 1,
        deadline: '2023-10-20',
        tasks: [
          { id: 't1', deadline: '2023-10-10', done: true } // Overdue but done
        ]
      };
      const result = getEffectiveDeadlineInfo(issue);
      expect(result).toEqual({ date: new Date('2023-10-20'), isTask: false });
    });
  });

  describe('createDeadlineBadge', () => {
    it('returns null if no effective deadline', () => {
      const issue = { id: 1 };
      expect(createDeadlineBadge(issue)).toBeNull();
    });

    it('creates standard deadline badge', () => {
      const issue = { id: 1, deadline: '2023-10-15' };
      const badge = createDeadlineBadge(issue);

      expect(badge.tagName).toBe('SPAN');
      expect(badge.textContent).toContain('⏰');
      expect(badge.textContent).toContain('Oct 15');
      expect(badge.title).toBe('Deadline');
      expect(badge.className).toBe('planning-item-deadline ');
    });

    it('creates overdue warning badge', () => {
      const issue = { id: 1, deadline: '2023-10-05' };
      const badge = createDeadlineBadge(issue);

      expect(badge.textContent).toContain('⚠️');
      expect(badge.title).toBe('Overdue!');
      expect(badge.classList.contains('overdue')).toBe(true);
    });

    it('indicates Task Deadline in tooltip', () => {
      const issue = {
        id: 1,
        tasks: [{ id: 't1', deadline: '2023-10-12', done: false }]
      };
      const badge = createDeadlineBadge(issue);

      expect(badge.title).toBe('Task Deadline');
    });

    it('shows Planned Late warning if planned date > deadline', () => {
      const issue = {
        id: 1,
        deadline: '2023-10-12',
        planned_date: '2023-10-15'
      };
      const badge = createDeadlineBadge(issue);

      expect(badge.textContent).toContain('⚠️');
      expect(badge.classList.contains('overdue')).toBe(true);
      expect(badge.title).toBe('Planned late!');
    });
  });

  describe('renderPlanningPanel', () => {
    it('renders basic structure (next 10 days)', () => {
      renderPlanningPanel();

      const list = document.getElementById('planning-list');
      // 10 days generated loop + maybe Past/Future logic
      // Should have at least 10 '.planning-day' elements
      expect(list.querySelectorAll('.planning-day').length).toBeGreaterThanOrEqual(10);

      // Check first day is Today (Oct 10)
      const firstDay = list.querySelector('.planning-day');
      expect(firstDay.textContent).toContain('Oct 10'); // "Tue, Oct 10"

      // Check count
      expect(document.getElementById('planning-count').textContent).toBe('0');
    });

    it('renders unscheduled issues section', () => {
      state.issues = [
        { id: 1, title: 'Unscheduled One', deadline: '2023-10-20', planned_date: null, status: 'Todo' }
      ];

      renderPlanningPanel();

      const unscheduledSection = document.getElementById('planning-list').querySelector('.planning-section-unscheduled');
      expect(unscheduledSection).not.toBeNull();
      expect(unscheduledSection.textContent).toContain('Unscheduled Issues');
      expect(unscheduledSection.querySelectorAll('.planning-item').length).toBe(1);
      expect(document.getElementById('planning-count').textContent).toBe('1');
    });

    it('renders planned issues in correct day slot', () => {
      state.issues = [
        { id: 1, title: 'Planned Today', planned_date: '2023-10-10', status: 'Todo' }, // Today
        { id: 2, title: 'Planned Tomorrow', planned_date: '2023-10-11', status: 'Todo' } // Tomorrow
      ];

      renderPlanningPanel();

      const list = document.getElementById('planning-list');

      const dayToday = list.querySelector('#day-2023-10-10');
      expect(dayToday).not.toBeNull();
      expect(dayToday.querySelectorAll('.planning-item').length).toBe(1);
      expect(dayToday.textContent).toContain('Planned Today');

      const dayTomorrow = list.querySelector('#day-2023-10-11');
      expect(dayTomorrow).not.toBeNull();
      expect(dayTomorrow.textContent).toContain('Planned Tomorrow');

      expect(document.getElementById('planning-count').textContent).toBe('2');
    });

    it('renders Past Planning section for overdue planned issues', () => {
      state.issues = [
        { id: 1, title: 'Old Plan', planned_date: '2023-10-01', status: 'Todo' }
      ];

      renderPlanningPanel();

      const pastDay = document.getElementById('day-past');
      expect(pastDay).not.toBeNull();
      expect(pastDay.classList.contains('past')).toBe(true);
      expect(pastDay.textContent).toContain('Past Planning');
      expect(pastDay.textContent).toContain('Old Plan');
    });

    it('renders Future Planning section for distant future issues', () => {
      state.issues = [
        { id: 1, title: 'Far Future', planned_date: '2023-12-01', status: 'Todo' }
      ];

      renderPlanningPanel();

      const futureDay = document.getElementById('day-future');
      expect(futureDay).not.toBeNull();
      expect(futureDay.textContent).toContain('Future Planning');
      expect(futureDay.textContent).toContain('Far Future');
    });

    it('toggles empty class on days', () => {
      renderPlanningPanel();
      const list = document.getElementById('planning-list');
      const emptyDay = list.querySelector('.planning-day');
      expect(emptyDay.classList.contains('empty')).toBe(true);
    });
  });
});
