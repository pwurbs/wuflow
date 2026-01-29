import { describe, it, expect } from 'vitest';
import { filterIssues, filterByStatus, sortByPosition } from '../filters.js';

// Test fixtures
const createIssue = (overrides = {}) => ({
  id: 1,
  title: 'Default Title',
  description: 'Default description',
  status: 'Open',
  priority: 'Normal',
  position: 0,
  label: null,
  ...overrides
});

const mockIssues = [
  createIssue({ id: 1, title: 'Login Bug', priority: 'High', label: { name: 'Bug', color: '#ff0000' }, position: 2 }),
  createIssue({ id: 2, title: 'Add Dark Mode', priority: 'Normal', label: { name: 'Feature', color: '#00ff00' }, position: 0 }),
  createIssue({ id: 3, title: 'Fix Typo', priority: 'Normal', label: null, position: 1 }),
  createIssue({ id: 4, title: 'API Integration', description: 'Login endpoint', priority: 'High', status: 'Working', position: 3 }),
];

describe('filterIssues', () => {
  describe('edge cases', () => {
    it('should return empty array for null issues', () => {
      expect(filterIssues(null, {})).toEqual([]);
    });

    it('should return empty array for undefined issues', () => {
      expect(filterIssues(undefined, {})).toEqual([]);
    });

    it('should return empty array for non-array issues', () => {
      expect(filterIssues('not an array', {})).toEqual([]);
    });

    it('should return all issues when filter is empty', () => {
      const filter = { label: null, priority: null, search: '' };
      expect(filterIssues(mockIssues, filter)).toHaveLength(4);
    });
  });

  describe('label filter', () => {
    it('should filter by label name', () => {
      const filter = { label: 'Bug', priority: null, search: '' };
      const result = filterIssues(mockIssues, filter);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Login Bug');
    });

    it('should filter to show only unlabeled issues with __no_label__', () => {
      const filter = { label: '__no_label__', priority: null, search: '' };
      const result = filterIssues(mockIssues, filter);
      expect(result).toHaveLength(2); // "Fix Typo" and "API Integration" have no label
    });

    it('should return empty when label not found', () => {
      const filter = { label: 'NonExistent', priority: null, search: '' };
      expect(filterIssues(mockIssues, filter)).toHaveLength(0);
    });
  });

  describe('priority filter', () => {
    it('should filter by High priority', () => {
      const filter = { label: null, priority: 'High', search: '' };
      const result = filterIssues(mockIssues, filter);
      expect(result).toHaveLength(2);
      expect(result.every(i => i.priority === 'High')).toBe(true);
    });

    it('should filter by Normal priority', () => {
      const filter = { label: null, priority: 'Normal', search: '' };
      const result = filterIssues(mockIssues, filter);
      expect(result).toHaveLength(2);
      expect(result.every(i => i.priority === 'Normal')).toBe(true);
    });
  });

  describe('search filter', () => {
    it('should search in title (case insensitive)', () => {
      const filter = { label: null, priority: null, search: 'login' };
      const result = filterIssues(mockIssues, filter);
      expect(result).toHaveLength(2); // "Login Bug" and "API Integration" (description has login)
    });

    it('should search in description', () => {
      const filter = { label: null, priority: null, search: 'endpoint' };
      const result = filterIssues(mockIssues, filter);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('API Integration');
    });

    it('should handle issues without description', () => {
      const issues = [createIssue({ id: 1, title: 'Test', description: null })];
      const filter = { label: null, priority: null, search: 'test' };
      expect(filterIssues(issues, filter)).toHaveLength(1);
    });
  });

  describe('combined filters', () => {
    it('should apply label and priority filters together', () => {
      const filter = { label: 'Bug', priority: 'High', search: '' };
      const result = filterIssues(mockIssues, filter);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Login Bug');
    });

    it('should apply all three filters together', () => {
      const filter = { label: '__no_label__', priority: 'High', search: 'api' };
      const result = filterIssues(mockIssues, filter);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('API Integration');
    });

    it('should return empty when filters are mutually exclusive', () => {
      const filter = { label: 'Bug', priority: 'Normal', search: '' };
      expect(filterIssues(mockIssues, filter)).toHaveLength(0);
    });
  });
});

describe('filterByStatus', () => {
  it('should return empty array for null issues', () => {
    expect(filterByStatus(null, 'Open')).toEqual([]);
  });

  it('should filter issues by status', () => {
    const result = filterByStatus(mockIssues, 'Open');
    expect(result).toHaveLength(3);
  });

  it('should return issues matching Working status', () => {
    const result = filterByStatus(mockIssues, 'Working');
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('API Integration');
  });

  it('should return empty array when no matches', () => {
    expect(filterByStatus(mockIssues, 'Done')).toHaveLength(0);
  });
});

describe('sortByPosition', () => {
  it('should return empty array for null issues', () => {
    expect(sortByPosition(null)).toEqual([]);
  });

  it('should sort issues by position ascending', () => {
    const result = sortByPosition(mockIssues);
    expect(result[0].id).toBe(2); // position 0
    expect(result[1].id).toBe(3); // position 1
    expect(result[2].id).toBe(1); // position 2
    expect(result[3].id).toBe(4); // position 3
  });

  it('should not mutate original array', () => {
    const original = [...mockIssues];
    sortByPosition(mockIssues);
    expect(mockIssues).toEqual(original);
  });
});
