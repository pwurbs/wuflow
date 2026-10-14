import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api.js', () => ({ updateIssue: vi.fn(), updateIssuePositions: vi.fn(), archiveIssue: vi.fn() }));
vi.mock('../utils.js', () => ({ showNotification: vi.fn() }));
vi.mock('../drag.js', () => ({ getDraggedCard: vi.fn(), getDragAfterElement: vi.fn() }));
vi.mock('../state.js', () => ({ state: { issues: [] } }));

import { handleTogglePriority, handleAssignToMe, handleMoveTop, applyOrderChange, saveIssueOrder, getListUpdates } from '../list-utils.js';
import { showNotification } from '../utils.js';
import { state } from '../state.js';
import * as api from '../api.js';

describe('handleTogglePriority', () => {
  beforeEach(() => vi.clearAllMocks());

  it('toggles High to Normal', async () => {
    const issue = { id: 1, priority: 'High' };
    api.updateIssue.mockResolvedValue({});
    await handleTogglePriority(issue, vi.fn());
    expect(issue.priority).toBe('Normal');
    expect(api.updateIssue).toHaveBeenCalledWith(undefined, issue);
  });

  it('toggles Normal to High', async () => {
    const issue = { id: 1, priority: 'Normal' };
    api.updateIssue.mockResolvedValue({});
    await handleTogglePriority(issue, vi.fn());
    expect(issue.priority).toBe('High');
  });

  it('calls refresh on success', async () => {
    const refresh = vi.fn();
    api.updateIssue.mockResolvedValue({});
    await handleTogglePriority({ id: 1, priority: 'Normal' }, refresh);
    expect(refresh).toHaveBeenCalled();
  });

  it('calls refresh on error', async () => {
    const refresh = vi.fn();
    api.updateIssue.mockRejectedValue(new Error('fail'));
    await handleTogglePriority({ id: 1, priority: 'Normal' }, refresh);
    expect(refresh).toHaveBeenCalled();
  });
});

describe('handleAssignToMe', () => {
  beforeEach(() => vi.clearAllMocks());

  const currentUser = { id: 42, first_name: 'Alice', last_name: 'Smith' };

  it('sets assignee_id and assignee on the issue', async () => {
    const issue = { id: 1, assignee_id: null };
    api.updateIssue.mockResolvedValue({});
    await handleAssignToMe(issue, currentUser, vi.fn());
    expect(issue.assignee_id).toBe(42);
    expect(issue.assignee).toBe(currentUser);
  });

  it('calls refresh on success', async () => {
    const refresh = vi.fn();
    api.updateIssue.mockResolvedValue({});
    await handleAssignToMe({ id: 1 }, currentUser, refresh);
    expect(refresh).toHaveBeenCalled();
  });

  it('calls refresh on error', async () => {
    const refresh = vi.fn();
    api.updateIssue.mockRejectedValue(new Error('fail'));
    await handleAssignToMe({ id: 1 }, currentUser, refresh);
    expect(refresh).toHaveBeenCalled();
  });
});

describe('saveIssueOrder', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends all positions in one positions request', async () => {
    api.updateIssuePositions.mockResolvedValue();
    const a = { id: 1, project_id: 5, status: 'Open', position: 0 };
    const b = { id: 2, project_id: 5, status: 'Open', position: 1 };
    await saveIssueOrder([applyOrderChange(a, 'Open', 1), applyOrderChange(b, 'Open', 0)]);
    expect(api.updateIssuePositions).toHaveBeenCalledTimes(1);
    expect(api.updateIssuePositions).toHaveBeenCalledWith(5, [{ id: 1, position: 1 }, { id: 2, position: 0 }]);
    expect(api.updateIssue).not.toHaveBeenCalled();
  });

  it('saves a status change with the issue PUT first and leaves it out of the positions request', async () => {
    const calls = [];
    api.updateIssue.mockImplementation(async () => { calls.push('updateIssue'); return {}; });
    api.updateIssuePositions.mockImplementation(async () => { calls.push('updateIssuePositions'); });
    const moved = { id: 1, project_id: 5, status: 'Stage1', position: 3 };
    const shifted = { id: 2, project_id: 5, status: 'Stage2', position: 0 };
    await saveIssueOrder([applyOrderChange(moved, 'Stage2', 0), applyOrderChange(shifted, 'Stage2', 1)]);
    expect(calls).toEqual(['updateIssue', 'updateIssuePositions']);
    expect(api.updateIssue).toHaveBeenCalledWith(5, moved);
    expect(api.updateIssuePositions).toHaveBeenCalledWith(5, [{ id: 2, position: 1 }]);
  });

  it('skips the positions request when only a status changed', async () => {
    api.updateIssue.mockResolvedValue({});
    await saveIssueOrder([applyOrderChange({ id: 1, project_id: 5, status: 'Open', position: 0 }, 'Todo', 0)]);
    expect(api.updateIssue).toHaveBeenCalledTimes(1);
    expect(api.updateIssuePositions).not.toHaveBeenCalled();
  });

  it('sends nothing for an empty change list', async () => {
    await saveIssueOrder([]);
    expect(api.updateIssue).not.toHaveBeenCalled();
    expect(api.updateIssuePositions).not.toHaveBeenCalled();
  });

  it('restores the old status and positions when the positions request fails', async () => {
    api.updateIssue.mockResolvedValue({});
    api.updateIssuePositions.mockRejectedValue(new Error('offline'));
    const moved = { id: 1, project_id: 5, status: 'Stage1', position: 3 };
    const shifted = { id: 2, project_id: 5, status: 'Stage2', position: 0 };
    await expect(saveIssueOrder([
      applyOrderChange(moved, 'Stage2', 0),
      applyOrderChange(shifted, 'Stage2', 1)
    ])).rejects.toThrow('offline');
    expect(moved).toMatchObject({ status: 'Stage1', position: 3 });
    expect(shifted).toMatchObject({ status: 'Stage2', position: 0 });
  });

  it('restores the old order and sends no positions when the status PUT fails', async () => {
    api.updateIssue.mockRejectedValue(new Error('fail'));
    const moved = { id: 1, project_id: 5, status: 'Open', position: 2 };
    const shifted = { id: 2, project_id: 5, status: 'Todo', position: 0 };
    await expect(saveIssueOrder([
      applyOrderChange(moved, 'Todo', 0),
      applyOrderChange(shifted, 'Todo', 1)
    ])).rejects.toThrow('fail');
    expect(api.updateIssuePositions).not.toHaveBeenCalled();
    expect(moved).toMatchObject({ status: 'Open', position: 2 });
    expect(shifted).toMatchObject({ status: 'Todo', position: 0 });
  });
});

describe('handleMoveTop error path', () => {
  beforeEach(() => vi.clearAllMocks());

  it('restores the old positions, re-renders and refreshes when the save fails', async () => {
    api.updateIssuePositions.mockRejectedValue(new Error('offline'));
    const issues = [
      { id: 1, project_id: 5, status: 'Open', position: 0 },
      { id: 2, project_id: 5, status: 'Open', position: 1 }
    ];
    const rerender = vi.fn();
    const refresh = vi.fn();
    await handleMoveTop(issues[1], issues, rerender, refresh);
    expect(issues.map(i => i.position)).toEqual([0, 1]);
    expect(showNotification).toHaveBeenCalledWith('offline', 'error');
    expect(rerender).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });
});

describe('getListUpdates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  function renderList(id, ids) {
    const list = document.createElement('div');
    list.id = id;
    ids.forEach(i => {
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.id = String(i);
      list.appendChild(card);
    });
    document.body.appendChild(list);
  }

  it('returns only changed issues with their previous values and applies them locally', () => {
    state.issues = [
      { id: 1, status: 'Open', position: 0 },
      { id: 2, status: 'Todo', position: 0 },
      { id: 3, status: 'Open', position: 2 }
    ];
    renderList('list', [2, 1, 3]); // issue 2 dropped in from Todo at the top; issue 3 stays at 2

    const { changes, archives } = getListUpdates('list', 'Open');

    expect(archives).toEqual([]);
    expect(changes.map(c => [c.issue.id, c.previous])).toEqual([[2, { status: 'Todo', position: 0 }], [1, { status: 'Open', position: 0 }]]);
    expect(state.issues.map(i => [i.id, i.status, i.position])).toEqual([[1, 'Open', 1], [2, 'Open', 0], [3, 'Open', 2]]);
    expect(api.updateIssue).not.toHaveBeenCalled();
  });

  it('starts an archive request for a card dropped into the Archive list', () => {
    api.archiveIssue.mockResolvedValue({});
    state.issues = [{ id: 1, project_id: 5, status: 'Done', position: 0 }];
    renderList('archive', [1]);

    const { changes, archives } = getListUpdates('archive', 'Archive');

    expect(changes).toEqual([]);
    expect(archives).toHaveLength(1);
    expect(api.archiveIssue).toHaveBeenCalledWith(5, 1);
  });

  it('returns empty results for a missing list', () => {
    expect(getListUpdates('nope', 'Open')).toEqual({ changes: [], archives: [] });
  });
});
