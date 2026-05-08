import { describe, it, expect, beforeEach } from 'vitest';
import {
  state,
  setFilterLabel,
  setFilterPriority,
  setFilterAssignee,
  setFilterSearch,
  setIssues,
  setCurrentIssue,
  setCurrentUser,
  isFilterActive
} from '../state.js';

describe('state', () => {
  // Reset state before each test
  beforeEach(() => {
    state.issues = [];
    state.currentIssue = null;
    state.filter = { labelId: null, priority: null, assigneeId: null, search: '', releaseId: null, releaseOwnerFilter: null, releaseSearch: '' };
  });

  describe('setFilterLabel', () => {
    it('should set the label filter', () => {
      setFilterLabel(1);
      expect(state.filter.labelId).toBe(1);
    });

    it('should set label to 0 for unlabeled filter', () => {
      setFilterLabel(0);
      expect(state.filter.labelId).toBe(0);
    });

    it('should clear label filter when set to null', () => {
      setFilterLabel(1);
      setFilterLabel(null);
      expect(state.filter.labelId).toBeNull();
    });
  });

  describe('setFilterPriority', () => {
    it('should set priority to High', () => {
      setFilterPriority('High');
      expect(state.filter.priority).toBe('High');
    });

    it('should clear priority filter when set to null', () => {
      setFilterPriority('High');
      setFilterPriority(null);
      expect(state.filter.priority).toBeNull();
    });
  });

  describe('setFilterAssignee', () => {
    it('should set assignee filter', () => {
      setFilterAssignee(5);
      expect(state.filter.assigneeId).toBe(5);
    });

    it('should clear assignee filter when set to null', () => {
      setFilterAssignee(5);
      setFilterAssignee(null);
      expect(state.filter.assigneeId).toBeNull();
    });
  });

  describe('setFilterSearch', () => {
    it('should set search term', () => {
      setFilterSearch('login');
      expect(state.filter.search).toBe('login');
    });

    it('should allow empty search term', () => {
      setFilterSearch('test');
      setFilterSearch('');
      expect(state.filter.search).toBe('');
    });
  });

  describe('setIssues', () => {
    it('should set issues array', () => {
      const issues = [
        { id: 1, title: 'Issue 1' },
        { id: 2, title: 'Issue 2' }
      ];
      setIssues(issues);
      expect(state.issues).toEqual(issues);
      expect(state.issues).toHaveLength(2);
    });
  });

  describe('setCurrentIssue', () => {
    it('should set current issue', () => {
      const issue = { id: 1, title: 'Test Issue' };
      setCurrentIssue(issue);
      expect(state.currentIssue).toEqual(issue);
    });
  });

  describe('setCurrentUser', () => {
    it('should set current user', () => {
      const user = { id: 1, email: 'test@example.com' };
      setCurrentUser(user);
      expect(state.currentUser).toEqual(user);
    });
  });

  describe('filter state isolation', () => {
    it('should not affect other filters when setting one', () => {
      setFilterLabel(1);
      setFilterPriority('High');
      setFilterAssignee(2);
      setFilterSearch('login');

      expect(state.filter.labelId).toBe(1);
      expect(state.filter.priority).toBe('High');
      expect(state.filter.assigneeId).toBe(2);
      expect(state.filter.search).toBe('login');
    });
  });

  describe('isFilterActive', () => {
    it('should return false when no filters are set', () => {
      expect(isFilterActive()).toBe(false);
    });

    it('should return true when label filter is set', () => {
      state.filter.labelId = 1;
      expect(isFilterActive()).toBe(true);
    });

    it('should return true when priority filter is set', () => {
      state.filter.priority = 'High';
      expect(isFilterActive()).toBe(true);
    });

    it('should return true when assignee filter is set', () => {
      state.filter.assigneeId = 1;
      expect(isFilterActive()).toBe(true);
    });

    it('should return true when search filter is set', () => {
      state.filter.search = 'test';
      expect(isFilterActive()).toBe(true);
    });

    it('should return false when search is empty string', () => {
      state.filter.search = '';
      expect(isFilterActive()).toBe(false);
    });

    it('should return false when search is whitespace only', () => {
      state.filter.search = '   ';
      expect(isFilterActive()).toBe(false);
    });
  });
});
