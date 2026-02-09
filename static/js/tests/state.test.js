import { describe, it, expect, beforeEach } from 'vitest';
import {
  state,
  setFilterLabel,
  setFilterPriority,
  setFilterSearch,
  setIssues,
  setCurrentIssue,
  isFilterActive
} from '../state.js';

describe('state', () => {
  // Reset state before each test
  beforeEach(() => {
    state.issues = [];
    state.currentIssue = null;
    state.filter = { label: null, priority: null, search: '' };
  });

  describe('setFilterLabel', () => {
    it('should set the label filter', () => {
      setFilterLabel('Bug');
      expect(state.filter.label).toBe('Bug');
    });

    it('should set label to __no_label__ for unlabeled filter', () => {
      setFilterLabel('__no_label__');
      expect(state.filter.label).toBe('__no_label__');
    });

    it('should clear label filter when set to null', () => {
      setFilterLabel('Bug');
      setFilterLabel(null);
      expect(state.filter.label).toBeNull();
    });
  });

  describe('setFilterPriority', () => {
    it('should set priority to High', () => {
      setFilterPriority('High');
      expect(state.filter.priority).toBe('High');
    });

    it('should set priority to Normal', () => {
      setFilterPriority('Normal');
      expect(state.filter.priority).toBe('Normal');
    });

    it('should clear priority filter when set to null', () => {
      setFilterPriority('High');
      setFilterPriority(null);
      expect(state.filter.priority).toBeNull();
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

    it('should replace existing issues', () => {
      setIssues([{ id: 1, title: 'Old' }]);
      setIssues([{ id: 2, title: 'New' }]);
      expect(state.issues).toHaveLength(1);
      expect(state.issues[0].title).toBe('New');
    });
  });

  describe('setCurrentIssue', () => {
    it('should set current issue', () => {
      const issue = { id: 1, title: 'Test Issue' };
      setCurrentIssue(issue);
      expect(state.currentIssue).toEqual(issue);
    });

    it('should clear current issue when set to null', () => {
      setCurrentIssue({ id: 1, title: 'Test' });
      setCurrentIssue(null);
      expect(state.currentIssue).toBeNull();
    });
  });

  describe('filter state isolation', () => {
    it('should not affect other filters when setting one', () => {
      setFilterLabel('Bug');
      setFilterPriority('High');
      setFilterSearch('login');

      expect(state.filter.label).toBe('Bug');
      expect(state.filter.priority).toBe('High');
      expect(state.filter.search).toBe('login');
    });
  });

  describe('isFilterActive', () => {
    it('should return false when no filters are set', () => {
      expect(isFilterActive()).toBe(false);
    });

    it('should return true when label filter is set', () => {
      state.filter.label = 'Bug';
      expect(isFilterActive()).toBe(true);
    });

    it('should return true when priority filter is set', () => {
      state.filter.priority = 'High';
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
