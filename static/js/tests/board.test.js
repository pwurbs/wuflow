
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderBoard, setupBoardView } from '../components/board.js';
import * as state from '../state.js';
import * as card from '../components/card.js';
import * as filters from '../filters.js';
import * as drag from '../drag.js';
import * as api from '../api.js';
import * as utils from '../utils.js';

// Mock dependencies
vi.mock('../state.js', () => ({
  state: {
    issues: [],
    filter: {},
    currentUser: { role: 'admin' }
  },
  isFilterActive: vi.fn(),
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
  getDragSuccess: vi.fn().mockReturnValue(false)

}));

vi.mock('../utils.js', () => ({
  showNotification: vi.fn()
}));

vi.mock('../status-config.js', () => ({
  STATUS_OPEN: 'Open',
  getBoardColumns: vi.fn(() => [
    { statusKey: 'Todo',   displayName: 'Todo'    },
    { statusKey: 'Stage1', displayName: 'Pending' },
    { statusKey: 'Stage2', displayName: 'Working' },
    { statusKey: 'Done',   displayName: 'Done'    },
  ])
}));

vi.mock('../list-utils.js', () => ({
  handleMoveTop:        vi.fn(),
  handleMoveBottom:     vi.fn(),
  handleTogglePriority: vi.fn(),
  handleAssignToMe:     vi.fn()
}));

describe('Board Component', () => {
  beforeEach(() => {
    document.body.innerHTML = `<div class="board-columns"><aside class="sidebar"></aside></div>`;
    state.state.issues = [];
    state.state.currentUser = { role: 'admin' };
    vi.clearAllMocks();
  });

  describe('renderBoard', () => {
    it('should render issues into correct columns', () => {
      const issues = [
        { id: 1, title: 'Task 1', status: 'Todo' },
        { id: 2, title: 'Task 2', status: 'Stage2' },
        { id: 3, title: 'Task 3', status: 'Done' }
      ];

      state.state.issues = issues;
      filters.filterIssues.mockReturnValue(issues);
      filters.sortByPosition.mockReturnValue(issues);

      renderBoard();

      expect(document.querySelector('.column[data-status="Todo"] .column-content').children.length).toBe(1);
      expect(document.querySelector('.column[data-status="Stage1"] .column-content').children.length).toBe(0);
      expect(document.querySelector('.column[data-status="Stage2"] .column-content').children.length).toBe(1);
      expect(document.querySelector('.column[data-status="Done"] .column-content').children.length).toBe(1);

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

      const pendingCount = document.querySelector('.column[data-status="Stage1"] .count');
      expect(pendingCount.textContent).toBe('0');
    });

    it('should filter issues properly', () => {
      state.state.issues = [{ id: 1, status: 'Todo' }];
      // Mock filter to return empty
      filters.filterIssues.mockReturnValue([]);
      filters.sortByPosition.mockReturnValue([]);

      renderBoard();

      expect(document.querySelector('.column[data-status="Todo"] .column-content').children.length).toBe(0);
      expect(filters.filterIssues).toHaveBeenCalled();
    });
  });

  describe('setupBoardView', () => {
    it('should setup drag and drop event listeners', () => {
      const refreshApp = vi.fn();
      const openModal = vi.fn();

      setupBoardView(refreshApp, openModal);
      renderBoard();

      const colContent = document.querySelector('.column-content');
      expect(colContent).toBeTruthy();
    });

    it('should not move card if already in correct position during dragover', () => {
      setupBoardView(vi.fn(), vi.fn());
      renderBoard();

      const mockCard = document.createElement('div');
      mockCard.classList.add('card');
      const nextSibling = document.createElement('div');

      // Mock existing position
      Object.defineProperty(mockCard, 'nextElementSibling', { value: nextSibling });

      drag.getDraggedCard.mockReturnValue(mockCard);
      drag.getDragAfterElement.mockReturnValue(nextSibling); // Same as current next sibling

      const colContent = document.querySelector('.column[data-status="Todo"] .column-content');
      colContent.appendChild(mockCard);
      colContent.appendChild(nextSibling);

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

    it('should append card during dragover if no afterElement is found', () => {
      setupBoardView(vi.fn(), vi.fn());
      renderBoard();

      const mockCard = document.createElement('div');
      mockCard.classList.add('card');
      const otherCard = document.createElement('div');
      otherCard.classList.add('card');

      drag.getDraggedCard.mockReturnValue(mockCard);
      drag.getDragAfterElement.mockReturnValue(null); // Should append to end

      const colContent = document.querySelector('.column[data-status="Todo"] .column-content');
      colContent.appendChild(otherCard); // Not empty, and mockCard.nextElementSibling is null

      const appendSpy = vi.spyOn(colContent, 'appendChild');

      const event = new Event('dragover', { bubbles: true, cancelable: true });
      colContent.dispatchEvent(event);

      expect(appendSpy).toHaveBeenCalledWith(mockCard);
    });


    it('should insert card before afterElement during dragover', () => {
      setupBoardView(vi.fn(), vi.fn());
      renderBoard();

      const mockCard = document.createElement('div');
      mockCard.classList.add('card');
      const afterElement = document.createElement('div');
      afterElement.classList.add('card');
      const someOtherCard = document.createElement('div');
      someOtherCard.classList.add('card');

      const colContent = document.querySelector('.column[data-status="Todo"] .column-content');
      colContent.appendChild(someOtherCard);
      colContent.appendChild(afterElement);

      drag.getDraggedCard.mockReturnValue(mockCard);
      drag.getDragAfterElement.mockReturnValue(afterElement);

      const beforeSpy = vi.spyOn(afterElement, 'before');

      const event = new Event('dragover', { bubbles: true, cancelable: true });
      colContent.dispatchEvent(event);

      expect(beforeSpy).toHaveBeenCalledWith(mockCard);
    });


    it('should revert card to origin when dragleave is triggered (leaving column)', () => {
      setupBoardView(vi.fn(), vi.fn());
      renderBoard();

      const mockCard = document.createElement('div');
      mockCard.classList.add('card');
      const mockParent = document.createElement('div');
      const mockSibling = document.createElement('div');
      mockParent.appendChild(mockSibling);
      document.body.appendChild(mockParent);

      drag.getDraggedCard.mockReturnValue(mockCard);
      drag.getDraggedCardOrigin.mockReturnValue({
        parent: mockParent,
        nextSibling: mockSibling
      });

      const colContent = document.querySelector('.column[data-status="Todo"] .column-content');
      const beforeSpy = vi.spyOn(mockSibling, 'before');

      //relatedTarget is null/outside
      const event = new MouseEvent('dragleave', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'relatedTarget', { value: document.body });

      colContent.dispatchEvent(event);

      expect(beforeSpy).toHaveBeenCalledWith(mockCard);

      mockParent.remove();
    });

    it('should handle drop event and call getBoardUpdates', async () => {
      const refreshApp = vi.fn();
      setupBoardView(refreshApp, vi.fn());
      renderBoard();

      const mockCard = document.createElement('div');
      mockCard.classList.add('card');
      mockCard.dataset.id = '1';

      // Mock issues state
      state.state.issues = [
        { id: 1, title: 'Task 1', status: 'Todo', position: 0 }
      ];

      drag.getDraggedCard.mockReturnValue(mockCard);
      drag.setDragSuccess.mockImplementation(() => { });
      api.updateIssue.mockResolvedValue({});

      const workingContent = document.querySelector('.column[data-status="Stage2"] .column-content');
      workingContent.appendChild(mockCard);

      const event = new Event('drop', { bubbles: true, cancelable: true });
      workingContent.dispatchEvent(event);

      // Wait for async operations (Promise.all)
      await vi.waitFor(() => {
        expect(api.updateIssue).toHaveBeenCalledWith(expect.objectContaining({
          id: 1,
          status: 'Stage2',
          position: 0
        }));
        expect(refreshApp).toHaveBeenCalled();
      });
    });

    it('should only update issues if status or position changed', async () => {
      const refreshApp = vi.fn();

      // Render the issue into the board so the card exists at the correct position
      const issues = [{ id: 1, title: 'Task 1', status: 'Todo', position: 0 }];
      state.state.issues = issues;
      filters.filterIssues.mockReturnValue(issues);
      filters.sortByPosition.mockReturnValue(issues);

      setupBoardView(refreshApp, vi.fn());
      renderBoard();

      // Get the card rendered by renderBoard
      const colContent = document.querySelector('.column[data-status="Todo"] .column-content');
      const renderedCard = colContent.querySelector('.card');

      drag.getDraggedCard.mockReturnValue(renderedCard);
      api.updateIssue.mockResolvedValue({});

      // Drop in the same column — status and position unchanged
      const event = new Event('drop', { bubbles: true, cancelable: true });
      colContent.dispatchEvent(event);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(api.updateIssue).not.toHaveBeenCalled();
    });



    it('should pass onMoveTop, onMoveBottom, onTogglePriority to createCardElement', () => {
      const issues = [{ id: 1, title: 'Task 1', status: 'Todo', position: 0 }];
      state.state.issues = issues;
      filters.filterIssues.mockReturnValue(issues);
      filters.sortByPosition.mockReturnValue(issues);

      renderBoard();

      const options = card.createCardElement.mock.lastCall[2];
      expect(options.onMoveTop).toBeDefined();
      expect(options.onMoveBottom).toBeDefined();
      expect(options.onTogglePriority).toBeDefined();
    });

    it('should pass onAssignToMe only when user is not the assignee', () => {
      state.state.currentUser = { id: 99, first_name: 'Me', last_name: 'User' };
      const issues = [
        { id: 1, status: 'Todo', position: 0, assignee_id: 99 },
        { id: 2, status: 'Todo', position: 1, assignee_id: 7  }
      ];
      state.state.issues = issues;
      filters.filterIssues.mockReturnValue(issues);
      filters.sortByPosition.mockReturnValue(issues);

      renderBoard();

      const calls = card.createCardElement.mock.calls;
      const optionsAssigned   = calls.find(c => c[0].id === 1)[2];
      const optionsUnassigned = calls.find(c => c[0].id === 2)[2];

      expect(optionsAssigned.onAssignToMe).toBeUndefined();
      expect(optionsUnassigned.onAssignToMe).toBeDefined();
    });

    it('should not process dragover if dragged element is not a card', () => {
      setupBoardView(vi.fn(), vi.fn());
      renderBoard();

      const mockDiv = document.createElement('div');
      drag.getDraggedCard.mockReturnValue(mockDiv);

      const colContent = document.querySelector('.column[data-status="Todo"] .column-content');
      const event = new Event('dragover', { bubbles: true, cancelable: true });

      colContent.dispatchEvent(event);

      expect(drag.getDragAfterElement).not.toHaveBeenCalled();
    });

    it('should show notification and still call refreshApp on drop failure', async () => {
      const refreshApp = vi.fn();
      setupBoardView(refreshApp, vi.fn());
      renderBoard();

      const mockCard = document.createElement('div');
      mockCard.classList.add('card');
      mockCard.dataset.id = '1';

      state.state.issues = [
        { id: 1, title: 'Task 1', status: 'Todo', position: 0 }
      ];

      drag.getDraggedCard.mockReturnValue(mockCard);
      api.updateIssue.mockRejectedValue(new Error('Network error'));

      const workingContent = document.querySelector('.column[data-status="Stage2"] .column-content');
      workingContent.appendChild(mockCard);

      const event = new Event('drop', { bubbles: true, cancelable: true });
      workingContent.dispatchEvent(event);

      await vi.waitFor(() => {
        expect(utils.showNotification).toHaveBeenCalledWith('Network error', 'error');
        expect(refreshApp).toHaveBeenCalled();
      });
    });
  });
});
