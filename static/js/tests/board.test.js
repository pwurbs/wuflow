
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderBoard, setupBoardView } from '../components/board.js';
import * as state from '../state.js';
import * as card from '../components/card.js';
import * as filters from '../filters.js';
import * as drag from '../drag.js';
import * as api from '../api.js';

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
  getDraggedCard: vi.fn(),
  getDraggedCardOrigin: vi.fn(),
  getDragAfterElement: vi.fn(),
  setDraggedCard: vi.fn(),
  setDraggedCardOrigin: vi.fn(),
  setDragSuccess: vi.fn(),
  getDragSuccess: vi.fn()
}));

describe('Board Component', () => {
  beforeEach(() => {
    document.body.innerHTML = `
            <div id="col-todo" class="column-content" data-status="Todo"></div>
            <div id="col-pending" class="column-content" data-status="Pending"></div>
            <div id="col-working" class="column-content" data-status="Working"></div>
            <div id="col-done" class="column-content" data-status="Done"></div>
            
            <div class="column" data-status="Todo"><span class="count"></span><div class="column-content" id="col-todo"></div></div>
            <div class="column" data-status="Pending"><span class="count"></span><div class="column-content" id="col-pending"></div></div>
            <div class="column" data-status="Working"><span class="count"></span><div class="column-content" id="col-working"></div></div>
            <div class="column" data-status="Done"><span class="count"></span><div class="column-content" id="col-done"></div></div>
        `;
    vi.clearAllMocks();
  });

  describe('renderBoard', () => {
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

      const todoCount = document.querySelector('.column[data-status="Todo"] .count');
      expect(todoCount.textContent).toBe('2');

      const pendingCount = document.querySelector('.column[data-status="Pending"] .count');
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

  describe('setupBoardView', () => {
    it('should setup drag and drop event listeners', () => {
      const refreshApp = vi.fn();
      const openModal = vi.fn();

      setupBoardView(refreshApp, openModal);

      const colContent = document.querySelector('.column-content');
      expect(colContent).toBeTruthy();
    });

    it('should not move card if already in correct position during dragover', () => {
      setupBoardView(vi.fn(), vi.fn());

      const mockCard = document.createElement('div');
      mockCard.classList.add('card');
      const nextSibling = document.createElement('div');

      // Mock existing position
      Object.defineProperty(mockCard, 'nextElementSibling', { value: nextSibling });

      drag.getDraggedCard.mockReturnValue(mockCard);
      drag.getDragAfterElement.mockReturnValue(nextSibling); // Same as current next sibling

      const colContent = document.getElementById('col-todo');

      // Spy on appendChild/insertBefore to ensure they are NOT called
      const appendSpy = vi.spyOn(colContent, 'appendChild');
      const insertSpy = vi.spyOn(nextSibling, 'before');

      const event = new Event('dragover', { bubbles: true, cancelable: true });
      colContent.dispatchEvent(event);

      expect(drag.getDraggedCard).toHaveBeenCalled();
      expect(appendSpy).not.toHaveBeenCalled();
      expect(insertSpy).not.toHaveBeenCalled();
    });

    it('should revert card if drag was not successful', () => {
      setupBoardView(vi.fn(), vi.fn());

      const issues = [{ id: 1, title: 'Task 1', status: 'Todo' }];
      state.state.issues = issues;
      filters.filterIssues.mockReturnValue(issues);
      filters.sortByPosition.mockReturnValue(issues);

      renderBoard();

      // Capture the options passed to createCardElement
      // The last call to createCardElement should have the options as 3rd arg
      const lastCall = card.createCardElement.mock.lastCall;
      const options = lastCall[2];

      expect(options.onDragEnd).toBeDefined();

      // Simulate drag end with failure
      drag.getDragSuccess.mockReturnValue(false);

      const mockCardEl = document.createElement('div');
      const mockParent = document.createElement('div');
      const mockSibling = document.createElement('div');

      mockParent.appendChild(mockSibling);
      document.body.appendChild(mockParent); // Must be in document

      drag.getDraggedCardOrigin.mockReturnValue({
        parent: mockParent,
        nextSibling: mockSibling
      });

      // Spy on insertBefore/appendChild logic
      const beforeSpy = vi.spyOn(mockSibling, 'before');

      // Execute callback
      options.onDragEnd(mockCardEl);

      expect(beforeSpy).toHaveBeenCalledWith(mockCardEl);

      // Cleanup
      mockParent.remove();
    });

    it('should handle dragover event', () => {
      setupBoardView(vi.fn(), vi.fn());

      const mockCard = document.createElement('div');
      mockCard.classList.add('card');
      mockCard.dataset.id = '1';

      drag.getDraggedCard.mockReturnValue(mockCard);
      drag.getDragAfterElement.mockReturnValue(null);

      const colContent = document.getElementById('col-todo');
      const event = new Event('dragover', { bubbles: true, cancelable: true });

      colContent.dispatchEvent(event);

      expect(drag.getDraggedCard).toHaveBeenCalled();
    });

    it('should ignore drop event if dragged element is not a card', async () => {
      setupBoardView(vi.fn(), vi.fn());

      const mockDiv = document.createElement('div');
      // No 'card' class
      drag.getDraggedCard.mockReturnValue(mockDiv);

      const colContent = document.getElementById('col-todo');
      const event = new Event('drop', { bubbles: true, cancelable: true });
      colContent.dispatchEvent(event);

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(api.updateIssue).not.toHaveBeenCalled();
    });

    it('should handle drop event and update issues', async () => {
      const refreshApp = vi.fn();
      setupBoardView(refreshApp, vi.fn());

      const mockCard = document.createElement('div');
      mockCard.classList.add('card');
      mockCard.dataset.id = '1';

      state.state.issues = [
        { id: 1, title: 'Task 1', status: 'Todo', position: 0 }
      ];

      drag.getDraggedCard.mockReturnValue(mockCard);
      api.updateIssue.mockResolvedValue({});

      const colWorking = document.getElementById('col-working');
      colWorking.appendChild(mockCard);

      const event = new Event('drop', { bubbles: true, cancelable: true });
      colWorking.dispatchEvent(event);

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(drag.getDraggedCard).toHaveBeenCalled();
    });



    it('should not process dragover if dragged element is not a card', () => {
      setupBoardView(vi.fn(), vi.fn());

      const mockDiv = document.createElement('div');
      drag.getDraggedCard.mockReturnValue(mockDiv);

      const colContent = document.getElementById('col-todo');
      const event = new Event('dragover', { bubbles: true, cancelable: true });

      colContent.dispatchEvent(event);

      expect(drag.getDragAfterElement).not.toHaveBeenCalled();
    });
  });
});
