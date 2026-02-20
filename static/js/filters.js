import { state } from './state.js';

/**
 * Filter logic extracted from board.js and backlog.js
 * Pure functions with no DOM dependencies for easy unit testing
 */

/**
 * Filter issues based on label, priority, and search criteria
 * @param {Array} issues - Array of issue objects
 * @param {Object} filter - Filter criteria { label, priority, search }
 * @returns {Array} Filtered issues
 */
export function filterIssues(issues, filter) {
  if (!issues || !Array.isArray(issues)) {
    return [];
  }

  let result = issues;

  // Label filter
  if (filter.labelId !== null && filter.labelId !== undefined) {
    if (filter.labelId === '__no_label__') {
      result = result.filter(issue => !issue.label);
    } else {
      result = result.filter(issue => issue.label && issue.label.id === filter.labelId);
    }
  }

  // Priority filter
  if (filter.priority) {
    result = result.filter(issue => issue.priority === filter.priority);
  }

  // Assignee filter
  if (filter.assigneeId !== null && filter.assigneeId !== undefined) {
    result = result.filter(issue => {
      if (filter.assigneeId === 'me') {
        return issue.assignee_id === state.currentUser?.id;
      } else if (filter.assigneeId === '' || filter.assigneeId === 'unassigned') {
        return issue.assignee_id === null;
      } else {
        return issue.assignee_id === Number.parseInt(filter.assigneeId);
      }
    });
  }

  // Search filter (matches title or description)
  if (filter.search) {
    const term = filter.search.trim().toLowerCase();
    if (term) {
      result = result.filter(issue =>
        issue.title.toLowerCase().includes(term) ||
        issue.description?.toLowerCase().includes(term)
      );
    }
  }

  return result;
}

/**
 * Filter issues by status
 * @param {Array} issues - Array of issue objects
 * @param {string} status - Status to filter by
 * @returns {Array} Issues matching the status
 */
export function filterByStatus(issues, status) {
  if (!issues || !Array.isArray(issues)) {
    return [];
  }
  return issues.filter(issue => issue.status === status);
}

/**
 * Sort issues by position
 * @param {Array} issues - Array of issue objects
 * @returns {Array} Sorted issues (does not mutate original)
 */
export function sortByPosition(issues) {
  if (!issues || !Array.isArray(issues)) {
    return [];
  }
  return [...issues].sort((a, b) => a.position - b.position);
}
