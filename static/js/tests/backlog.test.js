import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderBacklog, setupBacklogView, resetOpenLoaded } from '../components/backlog.js';
import * as state from '../state.js';
import * as card from '../components/card.js';
import * as api from '../api.js';
import * as dragModule from '../drag.js';

// Mock dependencies
vi.mock('../state.js', () => ({
  state: {
    issues: [],
    releases: [],
    filter: { releaseFilterIds: [] },
    currentUser: { role: 'admin' }
  },
  isFilterActive: vi.fn(),
  toggleBacklogReleaseFilter: vi.fn(),
  pruneReleaseFilterIds: vi.fn(),
}));

vi.mock('../api.js', () => ({
  updateIssue: vi.fn().mockResolvedValue({}),
  updateIssuePositions: vi.fn().mockResolvedValue(),
  fetchOpenIssuesByProject: vi.fn().mockResolvedValue([])
}));

const { mockCreateCardElement } = vi.hoisted(() => {
  return {
    mockCreateCardElement: vi.fn((issue, isBoard, callbacks) => {
      const div = document.createElement('div');
      div.className = 'card';
      div.dataset.id = issue.id;
      div.textContent = issue.title;

      // Store callbacks on the element for testing
      div._callbacks = callbacks;
      return div;
    })
  };
});

vi.mock('../components/card.js', () => ({
  createCardElement: mockCreateCardElement
}));

vi.mock('../filters.js', () => ({
  filterIssues: vi.fn(issues => issues),
  filterByStatus: vi.fn((issues, status) => issues.filter(i => i.status === status)), // Simple implementation for test
  sortByPosition: vi.fn(issues => issues.sort((a, b) => a.position - b.position))
}));

// Mock Drag module functions but we don't need them for moving logic test essentially, mainly for setup
vi.mock('../drag.js', () => ({
  getDraggedCard: vi.fn(),
  getDragAfterElement: vi.fn(),
  setDraggedCard: vi.fn(),
  setDraggedCardOrigin: vi.fn(),
}));

describe('Backlog Component', () => {
  beforeEach(() => {
    document.body.innerHTML = `
        <div id="backlog-release-lanes" class="hidden"></div>
        <div id="backlog-list"></div>
        <div id="move-to-todo-list"></div>
        <span id="backlog-count"></span>
        <span id="todo-count"></span>
        <div id="backlog-open-section"></div>
        <div id="backlog-todo-section"></div>
    `;
    vi.clearAllMocks();
    mockCreateCardElement.mockClear();
    resetOpenLoaded(); // Reset lazy-load state between tests
  });

  describe('renderBacklog', () => {
    it('should render cards with move callbacks', async () => {
      const issues = [
        { id: 1, title: 'Item 1', status: 'Open', position: 0 },
        { id: 2, title: 'Item 2', status: 'Open', position: 1 },
        { id: 3, title: 'Item 3', status: 'Todo', position: 0 }
      ];
      state.state.issues = issues;
      // Mocks for filter/sort are simple pass-throughs or simple logic above

      const refreshApp = vi.fn();
      const openModal = vi.fn();

      await renderBacklog(refreshApp, openModal);

      const backlogList = document.getElementById('backlog-list');
      expect(backlogList.children).toHaveLength(2);

      // Check if createCardElement was called with move callbacks
      // The 3rd argument is 'callbacks'
      const calls = card.createCardElement.mock.calls;
      expect(calls).toHaveLength(3);

      // Check for callbacks existence
      calls.forEach(call => {
        expect(call[2].onMoveTop).toBeDefined();
        expect(call[2].onMoveBottom).toBeDefined();
      });
    });

    it('handleMoveTop should save the new order in one positions request', async () => {
      const issues = [
        { id: 1, title: 'Item 1', status: 'Open', position: 0 },
        { id: 2, title: 'Item 2', status: 'Open', position: 1 },
        { id: 3, title: 'Item 3', status: 'Open', position: 2 }
      ];
      state.state.issues = structuredClone(issues); // Deep copy

      const refreshApp = vi.fn();
      const rerenderActiveView = vi.fn();
      await renderBacklog(refreshApp, vi.fn(), rerenderActiveView);

      const backlogList = document.getElementById('backlog-list');
      const card3 = backlogList.children[2]; // Item 3

      // Trigger move top on Item 3
      const onMoveTop = card3._callbacks.onMoveTop;
      await onMoveTop();

      // Item 3 moves to pos 0. Item 1 to 1, Item 2 to 2.
      // updatePositions only sends changed items — here all three, in one request.
      expect(api.updateIssuePositions).toHaveBeenCalledTimes(1);
      expect(api.updateIssuePositions).toHaveBeenCalledWith(undefined, [
        { id: 3, position: 0 }, { id: 1, position: 1 }, { id: 2, position: 2 }
      ]);
      expect(api.updateIssue).not.toHaveBeenCalled();

      // On success, only the light local re-render fires — not the full app refresh.
      expect(rerenderActiveView).toHaveBeenCalled();
      expect(refreshApp).not.toHaveBeenCalled();
    });

    it('handleMoveTop should be null if already at top', async () => {
      const issues = [
        { id: 1, title: 'Item 1', status: 'Open', position: 0 },
        { id: 2, title: 'Item 2', status: 'Open', position: 1 }
      ];
      state.state.issues = structuredClone(issues);

      await renderBacklog(vi.fn(), vi.fn());
      const card1 = document.getElementById('backlog-list').children[0];

      expect(card1._callbacks.onMoveTop).toBeNull();
      expect(api.updateIssue).not.toHaveBeenCalled();
    });

    it('handleMoveBottom should reorder issues', async () => {
      const issues = [
        { id: 1, title: 'Item 1', status: 'Open', position: 0 },
        { id: 2, title: 'Item 2', status: 'Open', position: 1 },
        { id: 3, title: 'Item 3', status: 'Open', position: 2 }
      ];
      state.state.issues = structuredClone(issues);

      const refreshApp = vi.fn();
      const rerenderActiveView = vi.fn();
      await renderBacklog(refreshApp, vi.fn(), rerenderActiveView);

      const backlogList = document.getElementById('backlog-list');
      const card1 = backlogList.children[0]; // Item 1

      // Trigger move bottom on Item 1
      const onMoveBottom = card1._callbacks.onMoveBottom;
      await onMoveBottom();

      // Item 1 moves to end (pos 2).
      // Item 2 moves to 0. Item 3 moves to 1.
      expect(api.updateIssuePositions).toHaveBeenCalledTimes(1);
      expect(api.updateIssuePositions).toHaveBeenCalledWith(undefined, [
        { id: 2, position: 0 }, { id: 3, position: 1 }, { id: 1, position: 2 }
      ]);
      expect(api.updateIssue).not.toHaveBeenCalled();
      expect(rerenderActiveView).toHaveBeenCalled();
      expect(refreshApp).not.toHaveBeenCalled();
    });

    it('should deduplicate open issues already present in state', async () => {
      // Simulate an issue that is already in state (e.g. loaded as "To do" earlier)
      // but is also returned by fetchOpenIssuesByProject (shouldn't happen normally,
      // but the merge guard must not create duplicates regardless).
      state.state.issues = [
        { id: 1, title: 'Already There', status: 'Open', position: 0 }
      ];

      api.fetchOpenIssuesByProject.mockResolvedValueOnce([
        { id: 1, title: 'Already There', status: 'Open', position: 0 }, // duplicate
        { id: 2, title: 'New Open', status: 'Open', position: 1 }       // new
      ]);

      await renderBacklog(vi.fn(), vi.fn());

      // id=1 must not be added again; id=2 must be merged in
      expect(state.state.issues).toHaveLength(2);
      expect(state.state.issues.find(i => i.id === 2)).toBeDefined();
    });

    it('handleMoveBottom should be null if already at bottom', async () => {
      const issues = [
        { id: 1, title: 'Item 1', status: 'Open', position: 0 },
        { id: 2, title: 'Item 2', status: 'Open', position: 1 }
      ];
      state.state.issues = structuredClone(issues);

      await renderBacklog(vi.fn(), vi.fn());
      const card2 = document.getElementById('backlog-list').children[1];

      expect(card2._callbacks.onMoveBottom).toBeNull();
      expect(api.updateIssue).not.toHaveBeenCalled();
    });

    it('handleTogglePriority should flip priority and call updateIssue', async () => {
      const issues = [{ id: 1, title: 'Item 1', status: 'Open', position: 0, priority: 'Normal' }];
      state.state.issues = structuredClone(issues);

      const rerenderActiveView = vi.fn();
      await renderBacklog(vi.fn(), vi.fn(), rerenderActiveView);

      const card1 = document.getElementById('backlog-list').children[0];
      await card1._callbacks.onTogglePriority();

      expect(api.updateIssue).toHaveBeenCalledWith(undefined, expect.objectContaining({ priority: 'High' }));
      expect(rerenderActiveView).toHaveBeenCalled();
    });

    it('handleAssignToMe should assign the issue to the current user and call updateIssue', async () => {
      state.state.currentUser = { id: 5, first_name: 'Me', last_name: 'User', role: 'admin' };
      const issues = [{ id: 1, title: 'Item 1', status: 'Open', position: 0, assignee_id: 7 }];
      state.state.issues = structuredClone(issues);

      const rerenderActiveView = vi.fn();
      await renderBacklog(vi.fn(), vi.fn(), rerenderActiveView);

      const card1 = document.getElementById('backlog-list').children[0];
      expect(card1._callbacks.onAssignToMe).toBeDefined();
      await card1._callbacks.onAssignToMe();

      expect(api.updateIssue).toHaveBeenCalledWith(undefined, expect.objectContaining({ assignee_id: 5 }));
      expect(rerenderActiveView).toHaveBeenCalled();
    });
  });

  describe('renderBacklogReleaseLanes', () => {
    it('should hide the container when there are no open releases', async () => {
      state.state.releases = [];
      await renderBacklog(vi.fn(), vi.fn());
      const container = document.getElementById('backlog-release-lanes');
      expect(container.classList.contains('hidden')).toBe(true);
    });

    it('should show release cards for each open release plus No Release', async () => {
      state.state.releases = [
        { id: 1, name: 'v1.0', status: 'open', release_date: null, created_at: '2024-01-01' },
        { id: 2, name: 'v2.0', status: 'open', release_date: null, created_at: '2024-02-01' },
        { id: 3, name: 'v3.0', status: 'closed', release_date: null, created_at: '2024-03-01' },
      ];
      state.state.issues = [];
      await renderBacklog(vi.fn(), vi.fn());
      const container = document.getElementById('backlog-release-lanes');
      expect(container.classList.contains('hidden')).toBe(false);
      const cards = container.querySelectorAll('.release-lane-card');
      // 2 open releases + No Release card
      expect(cards).toHaveLength(3);
    });

    it('should mark a lane card as active when its release id is in releaseFilterIds', async () => {
      state.state.releases = [
        { id: 1, name: 'v1.0', status: 'open', release_date: null, created_at: '2024-01-01' },
      ];
      state.state.filter.releaseFilterIds = [1];
      state.state.issues = [];
      await renderBacklog(vi.fn(), vi.fn());
      const cards = document.querySelectorAll('.release-lane-card');
      expect(cards[0].classList.contains('active')).toBe(true);
    });

    it('should display the correct issue count on each lane card', async () => {
      state.state.releases = [
        { id: 10, name: 'v1.0', status: 'open', release_date: null, created_at: '2024-01-01' },
      ];
      state.state.issues = [
        { id: 1, title: 'A', status: 'Open', position: 0, release_id: 10 },
        { id: 2, title: 'B', status: 'Todo', position: 1, release_id: 10 },
        { id: 3, title: 'C', status: 'Open', position: 2, release_id: null },
      ];
      await renderBacklog(vi.fn(), vi.fn());
      const cards = document.querySelectorAll('.release-lane-card');
      // v1.0 card: 2 issues (Open + Board), No Release card: 1 issue
      expect(cards[0].querySelector('.release-lane-count').textContent).toBe('2');
      expect(cards[1].querySelector('.release-lane-count').textContent).toBe('1');
    });

    it('should sort open releases by release_date ascending', async () => {
      state.state.releases = [
        { id: 1, name: 'Far', status: 'open', release_date: '2025-12-01', created_at: '2024-01-01' },
        { id: 2, name: 'Near', status: 'open', release_date: '2025-01-01', created_at: '2024-01-01' },
      ];
      state.state.issues = [];
      await renderBacklog(vi.fn(), vi.fn());
      const names = [...document.querySelectorAll('.release-lane-name')].map(el => el.textContent);
      expect(names[0]).toBe('Near');
      expect(names[1]).toBe('Far');
    });

    it('should toggle filter and re-render when a lane card is clicked', async () => {
      state.state.releases = [
        { id: 1, name: 'v1.0', status: 'open', release_date: null, created_at: '2024-01-01' },
      ];
      state.state.issues = [];
      await renderBacklog(vi.fn(), vi.fn());
      const card = document.querySelector('.release-lane-card');
      card.click();
      expect(state.toggleBacklogReleaseFilter).toHaveBeenCalledWith(1);
    });

    it('should assign a release to a dragged issue on drop', async () => {
      state.state.releases = [
        { id: 1, name: 'v1.0', status: 'open', release_date: null, created_at: '2024-01-01' },
      ];
      state.state.issues = [
        { id: 99, title: 'Test', status: 'Open', position: 0, release_id: null },
      ];
      api.updateIssue.mockResolvedValueOnce({ issue: { id: 99, release_id: 1 } });

      const mockCard = document.createElement('div');
      mockCard.className = 'card';
      mockCard.dataset.id = '99';
      dragModule.getDraggedCard.mockReturnValue(mockCard);

      await renderBacklog(vi.fn(), vi.fn());

      const laneCard = document.querySelector('.release-lane-card');
      const dropEvent = new Event('drop', { bubbles: false, cancelable: true });
      laneCard.dispatchEvent(dropEvent);

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(api.updateIssue).toHaveBeenCalledWith(undefined, expect.objectContaining({ id: 99, release_id: 1 }));
    });

    it('should add drag-over class on dragover when a card is being dragged', async () => {
      state.state.releases = [
        { id: 1, name: 'v1.0', status: 'open', release_date: null, created_at: '2024-01-01' },
      ];
      state.state.issues = [];

      const mockCard = document.createElement('div');
      mockCard.className = 'card';
      mockCard.dataset.id = '99';
      dragModule.getDraggedCard.mockReturnValue(mockCard);

      await renderBacklog(vi.fn(), vi.fn());

      const laneCard = document.querySelector('.release-lane-card');
      const dragoverEvent = new Event('dragover', { bubbles: false, cancelable: true });
      laneCard.dispatchEvent(dragoverEvent);

      expect(laneCard.classList.contains('drag-over')).toBe(true);
      expect(dragoverEvent.defaultPrevented).toBe(true);
    });

    it('should show filtered counts when a filter is active', async () => {
      state.isFilterActive.mockReturnValue(true);
      state.state.issues = [
        { id: 1, title: 'A', status: 'Open', position: 0 },
        { id: 2, title: 'B', status: 'Open', position: 1 },
        { id: 3, title: 'C', status: 'Todo', position: 0 },
      ];

      await renderBacklog(vi.fn(), vi.fn());

      // filterIssues mock is pass-through, so filtered == total — counts render as "n/n".
      expect(document.getElementById('backlog-count').textContent).toBe('2/2');
      expect(document.getElementById('todo-count').textContent).toBe('1/1');
    });

    it('should not call updateIssue if issue already has the target release', async () => {
      state.state.releases = [
        { id: 1, name: 'v1.0', status: 'open', release_date: null, created_at: '2024-01-01' },
      ];
      state.state.issues = [
        { id: 99, title: 'Test', status: 'Open', position: 0, release_id: 1 },
      ];

      const mockCard = document.createElement('div');
      mockCard.className = 'card';
      mockCard.dataset.id = '99';
      dragModule.getDraggedCard.mockReturnValue(mockCard);

      await renderBacklog(vi.fn(), vi.fn());

      const laneCard = document.querySelector('.release-lane-card');
      const dropEvent = new Event('drop', { bubbles: false, cancelable: true });
      laneCard.dispatchEvent(dropEvent);

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(api.updateIssue).not.toHaveBeenCalled();
    });
  });

  describe('setupBacklogView', () => {
    it('should setup event listeners including drag and drop', () => {
      // Create elements that setupBacklogView expects
      const backlogList = document.getElementById('backlog-list');
      const openSection = document.getElementById('backlog-open-section');

      // Add spies for addEventListener
      const backlogListSpy = vi.spyOn(backlogList, 'addEventListener');
      const openSectionSpy = vi.spyOn(openSection, 'addEventListener');

      setupBacklogView(vi.fn(), vi.fn());

      expect(backlogListSpy).toHaveBeenCalledWith('dragover', expect.any(Function));
      expect(backlogListSpy).toHaveBeenCalledWith('drop', expect.any(Function));
      expect(openSectionSpy).toHaveBeenCalledWith('dragover', expect.any(Function));
    });

    it('should put the card back when a drop on a section header cannot be saved', async () => {
      const refreshApp = vi.fn();
      const rerenderActiveView = vi.fn();
      setupBacklogView(refreshApp, vi.fn(), rerenderActiveView);

      const todoSection = document.getElementById('backlog-todo-section');
      const issue = { id: 7, title: 'Open item', status: 'Open', position: 0, planned_dates: ['2026-10-12'] };
      state.state.issues = [issue];
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.id = '7';
      const dragModule = await import('../drag.js');
      dragModule.getDraggedCard.mockReturnValue(card);
      api.updateIssue.mockRejectedValueOnce(new Error('Connection to the server failed. The change was not saved.'));

      Object.defineProperty(todoSection, 'offsetParent', { get() { return document.body; } });
      todoSection.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));

      await vi.waitFor(() => expect(rerenderActiveView).toHaveBeenCalled());
      expect(api.updateIssue).toHaveBeenCalledWith(undefined, expect.objectContaining({ id: 7 }));
      // The old status is back after the failure, so the re-render shows the card in Open again
      expect(issue).toMatchObject({ status: 'Open', planned_dates: ['2026-10-12'] });
      expect(refreshApp).toHaveBeenCalled();
    });

    it('should change only the status when a card is dropped on a section header', async () => {
      const refreshApp = vi.fn();
      const rerenderActiveView = vi.fn();
      setupBacklogView(refreshApp, vi.fn(), rerenderActiveView);

      const openSection = document.getElementById('backlog-open-section');
      const issue = { id: 99, title: 'Todo item', status: 'Todo', planned_dates: ['2026-10-20'] };
      state.state.issues = [issue];

      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.id = '99';
      const dragModule = await import('../drag.js');
      dragModule.getDraggedCard.mockReturnValue(card);

      Object.defineProperty(openSection, 'offsetParent', {
        get() { return document.body; }
      });
      openSection.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));

      await new Promise(resolve => setTimeout(resolve, 0));

      // Planned dates change only in the planning sidebar or the issue modal, never by a status move.
      expect(api.updateIssue).toHaveBeenCalledWith(undefined, expect.objectContaining({
        id: 99,
        status: 'Open',
        planned_dates: ['2026-10-20']
      }));
      // On success, only the light local re-render fires — not the full app refresh.
      expect(rerenderActiveView).toHaveBeenCalled();
      expect(refreshApp).not.toHaveBeenCalled();
    });

    it('should ignore a planning item dropped on a section (the planning sidebar is not shown here)', async () => {
      setupBacklogView(vi.fn(), vi.fn(), vi.fn());

      const openSection = document.getElementById('backlog-open-section');
      state.state.issues = [{ id: 98, title: 'Plan Item', status: 'Todo', planned_dates: ['2026-10-20'] }];
      const item = document.createElement('div');
      item.classList.add('planning-item');
      item.dataset.id = '98';
      const dragModule = await import('../drag.js');
      dragModule.getDraggedCard.mockReturnValue(item);

      Object.defineProperty(openSection, 'offsetParent', {
        get() { return document.body; }
      });
      openSection.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(api.updateIssue).not.toHaveBeenCalled();
      expect(state.state.issues[0]).toMatchObject({ status: 'Todo', planned_dates: ['2026-10-20'] });
    });

    it('should handle drop on list (reorder within list)', async () => {
      const refreshApp = vi.fn();
      setupBacklogView(refreshApp, vi.fn());

      const backlogList = document.getElementById('backlog-list');

      // Mock state with 2 items
      state.state.issues = [
        { id: 1, title: 'Item 1', status: 'Open', position: 0 },
        { id: 2, title: 'Item 2', status: 'Open', position: 1 }
      ];

      // Simulate that Item 2 was dragged and dropped before Item 1
      const card1 = document.createElement('div');
      card1.className = 'card';
      card1.dataset.id = '1';

      const card2 = document.createElement('div');
      card2.className = 'card';
      card2.dataset.id = '2';

      backlogList.appendChild(card2);
      backlogList.appendChild(card1);

      // Mock dragged element
      const dragModule = await import('../drag.js');
      dragModule.getDraggedCard.mockReturnValue(card2);

      Object.defineProperty(backlogList, 'offsetParent', {
        get() { return document.body; }
      });
      const event = new Event('drop', { bubbles: true, cancelable: true });
      backlogList.dispatchEvent(event);

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 0));

      // A reorder within one list is a single positions request
      expect(api.updateIssuePositions).toHaveBeenCalledTimes(1);
      expect(api.updateIssuePositions).toHaveBeenCalledWith(undefined, [
        { id: 2, position: 0 }, { id: 1, position: 1 }
      ]);
      expect(api.updateIssue).not.toHaveBeenCalled();
    });

    it('should put the cards back in their old order when the reorder cannot be saved', async () => {
      const refreshApp = vi.fn();
      const rerenderActiveView = vi.fn();
      setupBacklogView(refreshApp, vi.fn(), rerenderActiveView);

      const backlogList = document.getElementById('backlog-list');
      state.state.issues = [
        { id: 1, title: 'Item 1', status: 'Open', position: 0 },
        { id: 2, title: 'Item 2', status: 'Open', position: 1 }
      ];
      const card1 = document.createElement('div');
      card1.className = 'card';
      card1.dataset.id = '1';
      const card2 = document.createElement('div');
      card2.className = 'card';
      card2.dataset.id = '2';
      backlogList.appendChild(card2); // Item 2 dragged above Item 1
      backlogList.appendChild(card1);

      const dragModule = await import('../drag.js');
      dragModule.getDraggedCard.mockReturnValue(card2);
      api.updateIssuePositions.mockRejectedValueOnce(new Error('Connection to the server failed. The change was not saved.'));

      Object.defineProperty(backlogList, 'offsetParent', {
        get() { return document.body; }
      });
      backlogList.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));

      await vi.waitFor(() => expect(rerenderActiveView).toHaveBeenCalled());
      // The old positions are back, so the re-render shows the old order even offline
      expect(state.state.issues.map(i => [i.id, i.position])).toEqual([[1, 0], [2, 1]]);
      expect(refreshApp).toHaveBeenCalled();
    });
  });
});
