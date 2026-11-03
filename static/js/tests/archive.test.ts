import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderArchive, setupArchiveView } from '../components/archive.ts';
import { resetIssueLists } from '../issue-lists.ts';
import * as state from '../state.ts';
import * as api from '../api.ts';
import type { CardCallbacks } from '../components/card.ts';
import type { Issue } from '../models.ts';
import { makeIssue } from './fixtures.ts';
import { byId } from '../utils.ts';

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
  updateIssue: vi.fn().mockResolvedValue({}),
  updateIssuePositions: vi.fn().mockResolvedValue(undefined),
  archiveIssue: vi.fn().mockResolvedValue({}),
  fetchArchivedIssuesByProject: vi.fn().mockResolvedValue([]),
  fetchOpenIssuesByProject: vi.fn().mockResolvedValue([]),
  fetchActiveIssuesByProject: vi.fn().mockResolvedValue([])
}));

const { mockCreateCardElement, cardCallbacks } = vi.hoisted(() => {
  const cardCallbacks = new WeakMap<Element, CardCallbacks>();
  return {
    cardCallbacks,
    mockCreateCardElement: vi.fn((issue, isBoard, callbacks) => {
      const div = document.createElement('div');
      div.className = 'card';
      div.dataset.id = issue.id;
      div.textContent = issue.title;
      cardCallbacks.set(div, callbacks);
      return div;
    })
  };
});

vi.mock('../components/card.ts', () => ({
  createCardElement: mockCreateCardElement
}));

vi.mock('../filters.ts', () => ({
  filterIssues: vi.fn(issues => issues),
  filterByStatus: vi.fn((issues: Issue[], status: string) => issues.filter(i => i.status === status)),
  sortByPosition: vi.fn((issues: Issue[]) => issues.sort((a, b) => a.position - b.position))
}));

vi.mock('../drag.ts', () => ({
  getDraggedCard: vi.fn(),
  getDragAfterElement: vi.fn(),
}));

vi.mock('../utils.ts', async (importOriginal) => ({
  byId: (await importOriginal<typeof import('../utils.ts')>()).byId,
  errorMessage: (await importOriginal<typeof import('../utils.ts')>()).errorMessage,
  containsTarget: (await importOriginal<typeof import('../utils.ts')>()).containsTarget,
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
    resetIssueLists(); // Reset lazy-load state between tests
  });

  describe('renderArchive', () => {
    it('should render cards in correct columns', async () => {
      const issues = [
        makeIssue({ id: 1, title: 'Item 1', status: 'Archive', position: 0 }),
        makeIssue({ id: 2, title: 'Item 2', status: 'Done', position: 0 })
      ];
      state.state.issues = issues;

      await renderArchive(vi.fn(), vi.fn());

      const archiveList = byId('archive-list');
      const doneList = byId('archive-done-list');

      // 1 archived issue + 1 month header
      expect(archiveList.children).toHaveLength(2);
      expect(doneList.children).toHaveLength(1);
      expect(byId('archive-count').textContent).toBe('1');
      expect(byId('done-count-archive').textContent).toBe('1');

      // Verify that move callbacks are NOT passed (arrows disabled for alignment)
      const doneListCards = doneList.querySelectorAll('.card');
      doneListCards.forEach(cardEl => {
        expect(cardCallbacks.get(cardEl)?.onMoveTop).toBeUndefined();
        expect(cardCallbacks.get(cardEl)?.onMoveBottom).toBeUndefined();
      });
    });
  });

  describe('setupArchiveView', () => {
    it('should setup event listeners', () => {
      const archiveList = byId('archive-list');
      const spy = vi.spyOn(archiveList, 'addEventListener');

      setupArchiveView(vi.fn(), vi.fn(), undefined);

      expect(spy).toHaveBeenCalledWith('dragover', expect.any(Function));
      expect(spy).toHaveBeenCalledWith('drop', expect.any(Function));
    });

    it('should handle drop to archive', async () => {
      const refreshApp = vi.fn();
      setupArchiveView(refreshApp, vi.fn(), undefined);

      const list = byId('archive-list');

      // Mock Dragged Card
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.id = '99';

      const dragModule = await import('../drag.ts');
      vi.mocked(dragModule.getDraggedCard).mockReturnValue(card);

      // Mock State
      state.state.issues = [makeIssue({ id: 99, status: 'Done', position: 0 })];

      // Simulate dragover moving the card to the list
      list.appendChild(card);

      const section = document.getElementById('archive-archive-section');
      for (const el of [list, section]) {
        Object.defineProperty(el, 'offsetParent', { get() { return document.body; } });
      }
      const event = new Event('drop', { bubbles: true, cancelable: true });
      list.dispatchEvent(event);

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(api.archiveIssue).toHaveBeenCalledWith(1, 99);
      expect(refreshApp).toHaveBeenCalled();
    });

    it('should ignore a planning item dropped on the archive section (the planning sidebar is not shown here)', async () => {
      const refreshApp = vi.fn();
      setupArchiveView(refreshApp, vi.fn(), undefined);

      const section = byId('archive-archive-section');
      const item = document.createElement('div');
      item.classList.add('planning-item');
      item.dataset.id = '100';
      const dragModule = await import('../drag.ts');
      vi.mocked(dragModule.getDraggedCard).mockReturnValue(item);
      state.state.issues = [makeIssue({ id: 100, status: 'Done', planned_dates: ['2023-01-01'] })];

      Object.defineProperty(section, 'offsetParent', {
        get() { return document.body; }
      });
      section.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(api.archiveIssue).not.toHaveBeenCalled();
      expect(state.state.issues[0].status).toBe('Done');
    });

    it('should save a reorder within Done as one positions request and re-render the archive', async () => {
      setupArchiveView(vi.fn(), vi.fn(), undefined);

      const doneList = byId('archive-done-list');
      state.state.issues = [
        makeIssue({ id: 1, title: 'Item 1', status: 'Done', position: 0 }),
        makeIssue({ id: 2, title: 'Item 2', status: 'Done', position: 1 })
      ];
      const card1 = document.createElement('div');
      card1.className = 'card';
      card1.dataset.id = '1';
      const card2 = document.createElement('div');
      card2.className = 'card';
      card2.dataset.id = '2';
      doneList.appendChild(card2); // Item 2 dragged above Item 1
      doneList.appendChild(card1);

      const dragModule = await import('../drag.ts');
      vi.mocked(dragModule.getDraggedCard).mockReturnValue(card2);

      Object.defineProperty(doneList, 'offsetParent', {
        get() { return document.body; }
      });
      doneList.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));

      // renderArchive replaces the dropped cards with freshly created ones
      await vi.waitFor(() => expect(mockCreateCardElement).toHaveBeenCalledTimes(2));
      expect(api.updateIssuePositions).toHaveBeenCalledTimes(1);
      expect(api.updateIssuePositions).toHaveBeenCalledWith(1, [
        { id: 2, position: 0 }, { id: 1, position: 1 }
      ]);
      expect(api.updateIssue).not.toHaveBeenCalled();
      expect(api.archiveIssue).not.toHaveBeenCalled();
      expect([...doneList.querySelectorAll<HTMLElement>(':scope > *')].map(c => c.dataset.id)).toEqual(['2', '1']);
    });

    // Last in this block: archive.ts keeps the re-render callback in module state, and the
    // tests above expect it to be unset.
    it('should put the card back in Done when archiving by drag cannot be saved', async () => {
      const refreshApp = vi.fn();
      const rerenderActiveView = vi.fn();
      setupArchiveView(refreshApp, vi.fn(), rerenderActiveView);

      const list = byId('archive-list');
      const section = document.getElementById('archive-archive-section');
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.id = '98';
      const dragModule = await import('../drag.ts');
      vi.mocked(dragModule.getDraggedCard).mockReturnValue(card);
      const issue = makeIssue({ id: 98, status: 'Done', position: 0 });
      state.state.issues = [issue];
      vi.mocked(api.archiveIssue).mockRejectedValueOnce(new Error('Connection to the server failed. The change was not saved.'));

      for (const el of [list, section]) {
        Object.defineProperty(el, 'offsetParent', { get() { return document.body; } });
      }
      list.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));

      await vi.waitFor(() => expect(rerenderActiveView).toHaveBeenCalled());
      expect(api.archiveIssue).toHaveBeenCalledWith(1, 98);
      // Not archived on the server, so it must not look archived
      expect(issue.status).toBe('Done');
      expect(refreshApp).toHaveBeenCalled();
    });
  });
});
