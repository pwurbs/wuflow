
import { describe, it, expect, vi, beforeEach, assert } from 'vitest';
import { renderBoard, setupBoardView } from '../components/board.ts';
import * as state from '../state.ts';
import * as card from '../components/card.ts';
import * as filters from '../filters.ts';
import * as drag from '../drag.ts';
import * as api from '../api.ts';
import * as listUtils from '../list-utils.ts';
import * as utils from '../utils.ts';
import { makeIssue, makeUser } from './fixtures.ts';
import { bySelector } from '../utils.ts';

// The callbacks renderBoard passed to createCardElement for the issue with this id.
function cardOptions(id: number) {
  const options = vi.mocked(card.createCardElement).mock.calls.find(c => c[0].id === id)?.[2];
  assert(options);
  return options;
}

// Mock dependencies
vi.mock('../state.ts', () => ({
  state: {
    issues: [],
    filter: {},
    currentUser: { role: 'admin' }
  },
  isFilterActive: vi.fn(),
}));

vi.mock('../api.ts', () => ({
  updateIssue: vi.fn(),
  updateIssuePositions: vi.fn()
}));

vi.mock('../components/card.ts', () => ({
  createCardElement: vi.fn((issue) => {
    const div = document.createElement('div');
    div.className = 'card';
    div.dataset.id = issue.id;
    div.textContent = issue.title;
    return div;
  })
}));

vi.mock('../filters.ts', () => ({
  filterIssues: vi.fn(issues => issues),
  sortByPosition: vi.fn(issues => issues)
}));

vi.mock('../drag.ts', () => ({
  getDraggedCard: vi.fn(),
  getDraggedCardOrigin: vi.fn(),
  getDragAfterElement: vi.fn(),
  setDraggedCard: vi.fn(),
  setDraggedCardOrigin: vi.fn(),
  setDragSuccess: vi.fn(),
  getDragSuccess: vi.fn().mockReturnValue(false)

}));

vi.mock('../utils.ts', async (importOriginal) => ({
  bySelector: (await importOriginal<typeof import('../utils.ts')>()).bySelector,
  errorMessage: (await importOriginal<typeof import('../utils.ts')>()).errorMessage,
  containsTarget: (await importOriginal<typeof import('../utils.ts')>()).containsTarget,
  showNotification: vi.fn()
}));

vi.mock('../status-config.ts', () => ({
  STATUS_OPEN: 'Open',
  getBoardColumns: vi.fn(() => [
    { statusKey: 'Todo',   displayName: 'Todo'    },
    { statusKey: 'Stage1', displayName: 'Pending' },
    { statusKey: 'Stage2', displayName: 'Working' },
    { statusKey: 'Done',   displayName: 'Done'    },
  ])
}));

// The card actions are mocked; saving a drop uses the real saveIssueOrder (with the mocked
// api.ts), so the tests also cover how a failed save restores the old order.
vi.mock('../list-utils.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../list-utils.ts')>()),
  handleMoveTop:        vi.fn(),
  handleMoveBottom:     vi.fn(),
  handleTogglePriority: vi.fn(),
  handleAssignToMe:     vi.fn()
}));

vi.mock('../components/planning.ts', () => ({
  renderPlanningPanel: vi.fn()
}));

describe('Board Component', () => {
  beforeEach(() => {
    document.body.innerHTML = `<div class="board-columns"><aside class="sidebar"></aside></div>`;
    state.state.issues = [];
    state.state.currentUser = makeUser({ id: 100, role: 'admin' });
    vi.clearAllMocks();
  });

  describe('renderBoard', () => {
    it('should render issues into correct columns', () => {
      const issues = [
        makeIssue({ id: 1, title: 'Task 1', status: 'Todo' }),
        makeIssue({ id: 2, title: 'Task 2', status: 'Stage2' }),
        makeIssue({ id: 3, title: 'Task 3', status: 'Done' })
      ];

      state.state.issues = issues;
      vi.mocked(filters.filterIssues).mockReturnValue(issues);
      vi.mocked(filters.sortByPosition).mockReturnValue(issues);

      renderBoard();

      expect(bySelector(document, '.column[data-status="Todo"] .column-content').children).toHaveLength(1);
      expect(bySelector(document, '.column[data-status="Stage1"] .column-content').children).toHaveLength(0);
      expect(bySelector(document, '.column[data-status="Stage2"] .column-content').children).toHaveLength(1);
      expect(bySelector(document, '.column[data-status="Done"] .column-content').children).toHaveLength(1);

      expect(card.createCardElement).toHaveBeenCalledTimes(3);
    });

    it('should update column counts', () => {
      const issues = [
        makeIssue({ id: 1, title: 'Task 1', status: 'Todo' }),
        makeIssue({ id: 2, title: 'Task 2', status: 'Todo' })
      ];
      state.state.issues = issues;
      vi.mocked(filters.filterIssues).mockReturnValue(issues);
      vi.mocked(filters.sortByPosition).mockReturnValue(issues);

      renderBoard();

      const todoCount = bySelector(document, '.column[data-status="Todo"] .count');
      expect(todoCount.textContent).toBe('2');

      const pendingCount = bySelector(document, '.column[data-status="Stage1"] .count');
      expect(pendingCount.textContent).toBe('0');
    });

    it('should filter issues properly', () => {
      state.state.issues = [makeIssue({ id: 1, status: 'Todo' })];
      // Mock filter to return empty
      vi.mocked(filters.filterIssues).mockReturnValue([]);
      vi.mocked(filters.sortByPosition).mockReturnValue([]);

      renderBoard();

      expect(bySelector(document, '.column[data-status="Todo"] .column-content').children).toHaveLength(0);
      expect(filters.filterIssues).toHaveBeenCalled();
    });
  });

  describe('setupBoardView', () => {
    it('should setup drag and drop event listeners', () => {
      const refreshApp = vi.fn();
      const openModal = vi.fn();

      setupBoardView(refreshApp, openModal, undefined);
      renderBoard();

      const colContent = document.querySelector('.column-content');
      expect(colContent).toBeTruthy();
    });

    it('should not move card if already in correct position during dragover', () => {
      setupBoardView(vi.fn(), vi.fn(), undefined);
      renderBoard();

      const mockCard = document.createElement('div');
      mockCard.classList.add('card');
      const nextSibling = document.createElement('div');

      // Mock existing position
      Object.defineProperty(mockCard, 'nextElementSibling', { value: nextSibling });

      vi.mocked(drag.getDraggedCard).mockReturnValue(mockCard);
      vi.mocked(drag.getDragAfterElement).mockReturnValue(nextSibling); // Same as current next sibling

      const colContent = bySelector(document, '.column[data-status="Todo"] .column-content');
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

    it('should not move the last card of a column while it stays at the end during dragover', async () => {
      const actualDrag = await vi.importActual<typeof import('../drag.ts')>('../drag.ts');
      vi.mocked(drag.getDragAfterElement).mockImplementationOnce(actualDrag.getDragAfterElement);
      setupBoardView(vi.fn(), vi.fn(), undefined);
      renderBoard();

      const colContent = bySelector(document, '.column[data-status="Todo"] .column-content');
      const draggedCard = document.createElement('div');
      draggedCard.classList.add('card', 'dragging');
      colContent.appendChild(draggedCard);
      vi.mocked(drag.getDraggedCard).mockReturnValue(draggedCard);
      const appendSpy = vi.spyOn(colContent, 'appendChild');

      colContent.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));

      expect(appendSpy).not.toHaveBeenCalled();
    });

    it('should revert card if drag was not successful', () => {
      setupBoardView(vi.fn(), vi.fn(), undefined);

      const issues = [makeIssue({ id: 1, title: 'Task 1', status: 'Todo' })];
      state.state.issues = issues;
      vi.mocked(filters.filterIssues).mockReturnValue(issues);
      vi.mocked(filters.sortByPosition).mockReturnValue(issues);

      renderBoard();

      // Capture the options passed to createCardElement
      // The last call to createCardElement should have the options as 3rd arg
      const options = vi.mocked(card.createCardElement).mock.lastCall?.[2];
      assert(options?.onDragEnd);

      // Simulate drag end with failure
      vi.mocked(drag.getDragSuccess).mockReturnValue(false);

      const mockCardEl = document.createElement('div');
      const mockParent = document.createElement('div');
      const mockSibling = document.createElement('div');

      mockParent.appendChild(mockSibling);
      document.body.appendChild(mockParent); // Must be in document

      vi.mocked(drag.getDraggedCardOrigin).mockReturnValue({
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
      setupBoardView(vi.fn(), vi.fn(), undefined);
      renderBoard();

      const mockCard = document.createElement('div');
      mockCard.classList.add('card');
      const otherCard = document.createElement('div');
      otherCard.classList.add('card');

      vi.mocked(drag.getDraggedCard).mockReturnValue(mockCard);
      vi.mocked(drag.getDragAfterElement).mockReturnValue(null); // Should append to end

      const colContent = bySelector(document, '.column[data-status="Todo"] .column-content');
      colContent.appendChild(otherCard); // Not empty, and mockCard.nextElementSibling is null

      const appendSpy = vi.spyOn(colContent, 'appendChild');

      const event = new Event('dragover', { bubbles: true, cancelable: true });
      colContent.dispatchEvent(event);

      expect(appendSpy).toHaveBeenCalledWith(mockCard);
    });


    it('should insert card before afterElement during dragover', () => {
      setupBoardView(vi.fn(), vi.fn(), undefined);
      renderBoard();

      const mockCard = document.createElement('div');
      mockCard.classList.add('card');
      const afterElement = document.createElement('div');
      afterElement.classList.add('card');
      const someOtherCard = document.createElement('div');
      someOtherCard.classList.add('card');

      const colContent = bySelector(document, '.column[data-status="Todo"] .column-content');
      colContent.appendChild(someOtherCard);
      colContent.appendChild(afterElement);

      vi.mocked(drag.getDraggedCard).mockReturnValue(mockCard);
      vi.mocked(drag.getDragAfterElement).mockReturnValue(afterElement);

      const beforeSpy = vi.spyOn(afterElement, 'before');

      const event = new Event('dragover', { bubbles: true, cancelable: true });
      colContent.dispatchEvent(event);

      expect(beforeSpy).toHaveBeenCalledWith(mockCard);
    });


    it('should revert card to origin when dragleave is triggered (leaving column)', () => {
      setupBoardView(vi.fn(), vi.fn(), undefined);
      renderBoard();

      const mockCard = document.createElement('div');
      mockCard.classList.add('card');
      const mockParent = document.createElement('div');
      const mockSibling = document.createElement('div');
      mockParent.appendChild(mockSibling);
      document.body.appendChild(mockParent);

      vi.mocked(drag.getDraggedCard).mockReturnValue(mockCard);
      vi.mocked(drag.getDraggedCardOrigin).mockReturnValue({
        parent: mockParent,
        nextSibling: mockSibling
      });

      const colContent = bySelector(document, '.column[data-status="Todo"] .column-content');
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
      setupBoardView(refreshApp, vi.fn(), undefined);
      renderBoard();

      const mockCard = document.createElement('div');
      mockCard.classList.add('card');
      mockCard.dataset.id = '1';

      // Mock issues state
      state.state.issues = [
        makeIssue({ id: 1, title: 'Task 1', status: 'Todo', position: 0 })
      ];

      vi.mocked(drag.getDraggedCard).mockReturnValue(mockCard);
      vi.mocked(drag.setDragSuccess).mockImplementation(() => { });
      vi.mocked(api.updateIssue, { partial: true }).mockResolvedValue({});

      const workingContent = bySelector(document, '.column[data-status="Stage2"] .column-content');
      workingContent.appendChild(mockCard);

      const event = new Event('drop', { bubbles: true, cancelable: true });
      workingContent.dispatchEvent(event);

      // The moved card changed status, so it is saved with its per-issue PUT
      await vi.waitFor(() => {
        expect(api.updateIssue).toHaveBeenCalledWith(1, expect.objectContaining({
          id: 1,
          status: 'Stage2',
          position: 0
        }));
      });
      expect(api.updateIssuePositions).not.toHaveBeenCalled();
    });

    it('should only update issues if status or position changed', async () => {
      const refreshApp = vi.fn();

      // Render the issue into the board so the card exists at the correct position
      const issues = [makeIssue({ id: 1, title: 'Task 1', status: 'Todo', position: 0 })];
      state.state.issues = issues;
      vi.mocked(filters.filterIssues).mockReturnValue(issues);
      vi.mocked(filters.sortByPosition).mockReturnValue(issues);

      setupBoardView(refreshApp, vi.fn(), undefined);
      renderBoard();

      // Get the card rendered by renderBoard
      const colContent = bySelector(document, '.column[data-status="Todo"] .column-content');
      const renderedCard = bySelector(colContent, '.card');

      vi.mocked(drag.getDraggedCard).mockReturnValue(renderedCard);
      // Drop in the same column — status and position unchanged
      const event = new Event('drop', { bubbles: true, cancelable: true });
      colContent.dispatchEvent(event);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(api.updateIssue).not.toHaveBeenCalled();
      expect(api.updateIssuePositions).not.toHaveBeenCalled();
    });



    it('should pass onMoveTop, onMoveBottom, onTogglePriority to createCardElement', () => {
      // Two issues in the same column so onMoveTop/onMoveBottom aren't both null
      // (a lone issue is simultaneously first and last in its column).
      const issues = [
        makeIssue({ id: 1, title: 'Task 1', status: 'Todo', position: 0, priority: 'Normal' }),
        makeIssue({ id: 2, title: 'Task 2', status: 'Todo', position: 1, priority: 'Normal' })
      ];
      state.state.issues = issues;
      vi.mocked(filters.filterIssues).mockReturnValue(issues);
      vi.mocked(filters.sortByPosition).mockReturnValue(issues);

      renderBoard(vi.fn(), vi.fn(), vi.fn());

      const optionsFirst  = cardOptions(1);
      const optionsSecond = cardOptions(2);

      expect(optionsFirst.onMoveTop).toBeNull();
      assert(optionsSecond.onMoveTop);
      expect(optionsSecond.onMoveBottom).toBeNull();
      assert(optionsFirst.onMoveBottom);
      assert(optionsFirst.onTogglePriority);

      optionsSecond.onMoveTop();
      expect(listUtils.handleMoveTop).toHaveBeenCalledWith(issues[1], issues, expect.any(Function), expect.any(Function));

      optionsFirst.onMoveBottom();
      expect(listUtils.handleMoveBottom).toHaveBeenCalledWith(issues[0], issues, expect.any(Function), expect.any(Function));

      optionsFirst.onTogglePriority();
      expect(listUtils.handleTogglePriority).toHaveBeenCalledWith(issues[0], expect.any(Function));
    });

    it('should pass onAssignToMe only when user is not the assignee', () => {
      state.state.currentUser = makeUser({ id: 99, first_name: 'Me', last_name: 'User' });
      const issues = [
        makeIssue({ id: 1, status: 'Todo', position: 0, assignee_id: 99 }),
        makeIssue({ id: 2, status: 'Todo', position: 1, assignee_id: 7  })
      ];
      state.state.issues = issues;
      vi.mocked(filters.filterIssues).mockReturnValue(issues);
      vi.mocked(filters.sortByPosition).mockReturnValue(issues);

      renderBoard();

      const optionsAssigned   = cardOptions(1);
      const optionsUnassigned = cardOptions(2);

      expect(optionsAssigned.onAssignToMe).toBeUndefined();
      assert(optionsUnassigned.onAssignToMe);

      optionsUnassigned.onAssignToMe();
      expect(listUtils.handleAssignToMe).toHaveBeenCalledWith(issues[1], state.state.currentUser, expect.any(Function));
    });

    it('should not process dragover if dragged element is not a card', () => {
      setupBoardView(vi.fn(), vi.fn(), undefined);
      renderBoard();

      const mockDiv = document.createElement('div');
      vi.mocked(drag.getDraggedCard).mockReturnValue(mockDiv);

      const colContent = bySelector(document, '.column[data-status="Todo"] .column-content');
      const event = new Event('dragover', { bubbles: true, cancelable: true });

      colContent.dispatchEvent(event);

      expect(drag.getDragAfterElement).not.toHaveBeenCalled();
    });

    it('should restore card to origin position on dragleave from column', () => {
      setupBoardView(vi.fn(), vi.fn(), undefined);
      renderBoard();

      const mockCard = document.createElement('div');
      mockCard.classList.add('card');

      const parent = document.createElement('div');
      const sibling = document.createElement('div');
      parent.appendChild(sibling);

      vi.mocked(drag.getDraggedCard).mockReturnValue(mockCard);
      vi.mocked(drag.getDraggedCardOrigin).mockReturnValue({ parent, nextSibling: sibling });

      const colContent = bySelector(document, '.column[data-status="Todo"] .column-content');
      const outsideEl = document.createElement('div');
      document.body.appendChild(outsideEl);

      const event = new MouseEvent('dragleave', { bubbles: true, cancelable: true, relatedTarget: outsideEl });
      colContent.dispatchEvent(event);

      expect(parent.firstChild).toBe(mockCard);
      outsideEl.remove();
    });

    it('should re-render board without API call when user lacks update permission', async () => {
      state.state.currentUser = null;
      setupBoardView(vi.fn(), vi.fn(), undefined);
      renderBoard();

      const mockCard = document.createElement('div');
      mockCard.classList.add('card');
      vi.mocked(drag.getDraggedCard).mockReturnValue(mockCard);

      const colContent = bySelector(document, '.column[data-status="Todo"] .column-content');
      const event = new Event('drop', { bubbles: true, cancelable: true });
      colContent.dispatchEvent(event);

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(api.updateIssue).not.toHaveBeenCalled();
    });

    it('should show notification and still call refreshApp on drop failure', async () => {
      const refreshApp = vi.fn();
      setupBoardView(refreshApp, vi.fn(), undefined);
      renderBoard();

      const mockCard = document.createElement('div');
      mockCard.classList.add('card');
      mockCard.dataset.id = '1';

      state.state.issues = [
        makeIssue({ id: 1, title: 'Task 1', status: 'Todo', position: 0 })
      ];

      vi.mocked(drag.getDraggedCard).mockReturnValue(mockCard);
      vi.mocked(api.updateIssue).mockRejectedValue(new Error('Network error'));

      const workingContent = bySelector(document, '.column[data-status="Stage2"] .column-content');
      workingContent.appendChild(mockCard);

      const event = new Event('drop', { bubbles: true, cancelable: true });
      workingContent.dispatchEvent(event);

      await vi.waitFor(() => {
        expect(utils.showNotification).toHaveBeenCalledWith('Network error', 'error');
        expect(refreshApp).toHaveBeenCalled();
      });
    });

    it('should put the card back in its old column when the save fails (refresh not possible offline)', async () => {
      setupBoardView(vi.fn(), vi.fn(), undefined); // refreshApp does nothing, like when the server is unreachable
      // Earlier tests change these mocks' return values; render the real issue list here
      vi.mocked(filters.filterIssues).mockImplementation(issues => issues);
      vi.mocked(filters.sortByPosition).mockImplementation(issues => issues);
      state.state.issues = [
        makeIssue({ id: 1, title: 'Task 1', status: 'Stage1', position: 0 })
      ];
      renderBoard();

      const card = bySelector(document, '.card[data-id="1"]');
      vi.mocked(drag.getDraggedCard).mockReturnValue(card);
      vi.mocked(api.updateIssue).mockRejectedValue(new Error('Connection to the server failed. The change was not saved.'));

      const targetContent = bySelector(document, '.column[data-status="Stage2"] .column-content');
      targetContent.appendChild(card);
      targetContent.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));

      await vi.waitFor(() => {
        expect(utils.showNotification).toHaveBeenCalledWith('Connection to the server failed. The change was not saved.', 'error');
      });
      expect(state.state.issues[0]).toMatchObject({ status: 'Stage1', position: 0 });
      expect(document.querySelector('.column[data-status="Stage1"] .card[data-id="1"]')).not.toBeNull();
      expect(document.querySelector('.column[data-status="Stage2"] .card[data-id="1"]')).toBeNull();
    });

    it('should put the cards back in their old order when a reorder within a column fails', async () => {
      const refreshApp = vi.fn();
      setupBoardView(refreshApp, vi.fn(), undefined); // refreshApp does nothing, like when the server is unreachable
      vi.mocked(filters.filterIssues).mockImplementation(issues => issues);
      vi.mocked(filters.sortByPosition).mockImplementation(issues => [...issues].sort((a, b) => a.position - b.position));
      state.state.issues = [
        makeIssue({ id: 1, title: 'Task 1', status: 'Stage1', position: 0 }),
        makeIssue({ id: 2, title: 'Task 2', status: 'Stage1', position: 1 })
      ];
      renderBoard();

      const column = bySelector(document, '.column[data-status="Stage1"] .column-content');
      const card2 = bySelector(column, '.card[data-id="2"]');
      vi.mocked(drag.getDraggedCard).mockReturnValue(card2);
      vi.mocked(api.updateIssuePositions).mockRejectedValue(new Error('Connection to the server failed. The change was not saved.'));

      column.prepend(card2); // card 2 dragged to the top
      column.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));

      await vi.waitFor(() => {
        expect(utils.showNotification).toHaveBeenCalledWith('Connection to the server failed. The change was not saved.', 'error');
      });
      expect(api.updateIssuePositions).toHaveBeenCalledWith(1, [{ id: 2, position: 0 }, { id: 1, position: 1 }]);
      expect(state.state.issues.map(i => [i.id, i.position])).toEqual([[1, 0], [2, 1]]);
      // renderBoard rebuilds the columns, so query the re-rendered one
      const rendered = bySelector(document, '.column[data-status="Stage1"] .column-content');
      expect([...rendered.querySelectorAll<HTMLElement>('.card')].map(c => c.dataset.id)).toEqual(['1', '2']);
      expect(refreshApp).toHaveBeenCalled();
    });
  });
});
