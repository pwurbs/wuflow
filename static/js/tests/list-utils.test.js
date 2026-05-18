import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api.js', () => ({ updateIssue: vi.fn(), archiveIssue: vi.fn() }));
vi.mock('../utils.js', () => ({ showNotification: vi.fn() }));
vi.mock('../drag.js', () => ({ getDraggedCard: vi.fn(), getDragAfterElement: vi.fn() }));
vi.mock('../state.js', () => ({ state: { issues: [] } }));

import { handleTogglePriority, handleAssignToMe } from '../list-utils.js';
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
