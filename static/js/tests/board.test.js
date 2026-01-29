
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderBoard } from '../components/board.js';
import * as state from '../state.js';
import * as api from '../api.js';
import * as card from '../components/card.js';
import * as filters from '../filters.js';

// Mock dependencies
vi.mock('../state.js', () => ({
  state: {
    issues: [],
    filter: {}
  }
}));

vi.mock('../api.js', () => ({
  updateIssue: vi.fn()
}));

vi.mock('../components/card.js', () => ({
  createCardElement: vi.fn((issue) => {
    const div = document.createElement('div');
    div.className = 'card';
    div.dataset.id = issue.id;
    div.textContent = issue.title;
    return div;
  })
}));

vi.mock('../filters.js', () => ({
  filterIssues: vi.fn(issues => issues),
  sortByPosition: vi.fn(issues => issues)
}));

vi.mock('../drag.js', () => ({
  draggedCard: null,
  draggedCardOrigin: null,
  getDragAfterElement: vi.fn()
}));

describe('Board Component', () => {
  beforeEach(() => {
    document.body.innerHTML = `
            <div id="col-todo" class="column-content" data-status="Todo"></div>
            <div id="col-pending" class="column-content" data-status="Pending"></div>
            <div id="col-working" class="column-content" data-status="Working"></div>
            <div id="col-done" class="column-content" data-status="Done"></div>
            
            <div data-status="Todo"><span class="count"></span></div>
            <div data-status="Pending"><span class="count"></span></div>
            <div data-status="Working"><span class="count"></span></div>
            <div data-status="Done"><span class="count"></span></div>
        `;
    vi.clearAllMocks();
  });

  it('should render issues into correct columns', () => {
    const issues = [
      { id: 1, title: 'Task 1', status: 'Todo' },
      { id: 2, title: 'Task 2', status: 'Working' },
      { id: 3, title: 'Task 3', status: 'Done' }
    ];

    state.state.issues = issues;
    filters.filterIssues.mockReturnValue(issues);
    filters.sortByPosition.mockReturnValue(issues);

    renderBoard();

    expect(document.getElementById('col-todo').children.length).toBe(1);
    expect(document.getElementById('col-pending').children.length).toBe(0);
    expect(document.getElementById('col-working').children.length).toBe(1);
    expect(document.getElementById('col-done').children.length).toBe(1);

    expect(card.createCardElement).toHaveBeenCalledTimes(3);
  });

  it('should update column counts', () => {
    const issues = [
      { id: 1, title: 'Task 1', status: 'Todo' },
      { id: 2, title: 'Task 2', status: 'Todo' }
    ];
    state.state.issues = issues;
    filters.filterIssues.mockReturnValue(issues);
    filters.sortByPosition.mockReturnValue(issues);

    renderBoard();

    const todoCount = document.querySelector('div[data-status="Todo"] .count');
    expect(todoCount.textContent).toBe('2');

    const pendingCount = document.querySelector('div[data-status="Pending"] .count');
    expect(pendingCount.textContent).toBe('0');
  });

  it('should filter issues properly', () => {
    state.state.issues = [{ id: 1, status: 'Todo' }];
    // Mock filter to return empty
    filters.filterIssues.mockReturnValue([]);
    filters.sortByPosition.mockReturnValue([]);

    renderBoard();

    expect(document.getElementById('col-todo').children.length).toBe(0);
    expect(filters.filterIssues).toHaveBeenCalled();
  });
});
