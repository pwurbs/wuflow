import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderArchive, setupArchiveView, resetArchivedLoaded } from '../components/archive.js';
import * as state from '../state.js';
import * as api from '../api.js';

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
  updateIssue: vi.fn().mockResolvedValue({}),
  archiveIssue: vi.fn().mockResolvedValue({}),
  fetchArchivedIssuesByProject: vi.fn().mockResolvedValue([])
}));

const { mockCreateCardElement } = vi.hoisted(() => {
  return {
    mockCreateCardElement: vi.fn((issue, isBoard, callbacks) => {
      const div = document.createElement('div');
      div.className = 'card';
      div.dataset.id = issue.id;
      div.textContent = issue.title;
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
  filterByStatus: vi.fn((issues, status) => issues.filter(i => i.status === status)),
  sortByPosition: vi.fn(issues => issues.sort((a, b) => a.position - b.position))
}));

vi.mock('../drag.js', () => ({
  getDraggedCard: vi.fn(),
  getDragAfterElement: vi.fn(),
}));

vi.mock('../utils.js', () => ({
  canArchive: vi.fn().mockReturnValue({ allowed: true }),
  showConfirm: vi.fn().mockResolvedValue(true),
  showNotification: vi.fn(),
}));

describe('Archive Component', () => {
  beforeEach(() => {
    document.body.innerHTML = `
        <div id="archive-done-section">
            <div id="archive-done-list"></div>
        </div>
        <span id="archive-count"></span>
        <span id="done-count-archive"></span>
        <div id="archive-archive-section">
            <div id="archive-list"></div>
        </div>
    `;
    vi.clearAllMocks();
    mockCreateCardElement.mockClear();
    resetArchivedLoaded(); // Reset lazy-load state between tests
  });

  describe('renderArchive', () => {
    it('should render cards in correct columns', async () => {
      const issues = [
        { id: 1, title: 'Item 1', status: 'Archive', position: 0 },
        { id: 2, title: 'Item 2', status: 'Done', position: 0 }
      ];
      state.state.issues = issues;

      await renderArchive(vi.fn(), vi.fn());

      const archiveList = document.getElementById('archive-list');
      const doneList = document.getElementById('archive-done-list');

      // 1 archived issue + 1 month header
      expect(archiveList.children).toHaveLength(2);
      expect(doneList.children).toHaveLength(1);
      expect(document.getElementById('archive-count').textContent).toBe('1');
      expect(document.getElementById('done-count-archive').textContent).toBe('1');

      // Verify that move callbacks are NOT passed (arrows disabled for alignment)
      const doneListCards = doneList.querySelectorAll('.card');
      doneListCards.forEach(cardEl => {
        expect(cardEl._callbacks.onMoveTop).toBeUndefined();
        expect(cardEl._callbacks.onMoveBottom).toBeUndefined();
      });
    });
  });

  describe('setupArchiveView', () => {
    it('should setup event listeners', () => {
      const archiveList = document.getElementById('archive-list');
      const spy = vi.spyOn(archiveList, 'addEventListener');

      setupArchiveView(vi.fn(), vi.fn());

      expect(spy).toHaveBeenCalledWith('dragover', expect.any(Function));
      expect(spy).toHaveBeenCalledWith('drop', expect.any(Function));
    });

    it('should handle drop to archive', async () => {
      const refreshApp = vi.fn();
      setupArchiveView(refreshApp, vi.fn());

      const list = document.getElementById('archive-list');

      // Mock Dragged Card
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.id = '99';

      const dragModule = await import('../drag.js');
      dragModule.getDraggedCard.mockReturnValue(card);

      // Mock State
      state.state.issues = [{ id: 99, status: 'Done', position: 0 }];

      // Simulate dragover moving the card to the list
      list.appendChild(card);

      const section = document.getElementById('archive-archive-section');
      for (const el of [list, section]) {
        Object.defineProperty(el, 'offsetParent', { get() { return document.body; } });
      }
      const event = new Event('drop', { bubbles: true, cancelable: true });
      list.dispatchEvent(event);

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(api.archiveIssue).toHaveBeenCalledWith(undefined, 99);
      expect(refreshApp).toHaveBeenCalled();
    });

    it('should ignore a planning item dropped on the archive section (the planning sidebar is not shown here)', async () => {
      const refreshApp = vi.fn();
      setupArchiveView(refreshApp, vi.fn());

      const section = document.getElementById('archive-archive-section');
      const item = document.createElement('div');
      item.classList.add('planning-item');
      item.dataset.id = '100';
      const dragModule = await import('../drag.js');
      dragModule.getDraggedCard.mockReturnValue(item);
      state.state.issues = [{ id: 100, status: 'Done', planned_dates: ['2023-01-01'] }];

      Object.defineProperty(section, 'offsetParent', {
        get() { return document.body; }
      });
      section.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(api.archiveIssue).not.toHaveBeenCalled();
      expect(state.state.issues[0].status).toBe('Done');
    });

    // Last in this block: archive.js keeps the re-render callback in module state, and the
    // tests above expect it to be unset.
    it('should put the card back in Done when archiving by drag cannot be saved', async () => {
      const refreshApp = vi.fn();
      const rerenderActiveView = vi.fn();
      setupArchiveView(refreshApp, vi.fn(), rerenderActiveView);

      const list = document.getElementById('archive-list');
      const section = document.getElementById('archive-archive-section');
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.id = '98';
      const dragModule = await import('../drag.js');
      dragModule.getDraggedCard.mockReturnValue(card);
      const issue = { id: 98, status: 'Done', position: 0 };
      state.state.issues = [issue];
      api.archiveIssue.mockRejectedValueOnce(new Error('Connection to the server failed. The change was not saved.'));

      for (const el of [list, section]) {
        Object.defineProperty(el, 'offsetParent', { get() { return document.body; } });
      }
      list.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));

      await vi.waitFor(() => expect(rerenderActiveView).toHaveBeenCalled());
      expect(api.archiveIssue).toHaveBeenCalledWith(undefined, 98);
      // Not archived on the server, so it must not look archived
      expect(issue.status).toBe('Done');
      expect(refreshApp).toHaveBeenCalled();
    });
  });
});
