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
  if (filter.label) {
    if (filter.label === '__no_label__') {
      result = result.filter(issue => !issue.label);
    } else {
      result = result.filter(issue => issue.label && issue.label.name === filter.label);
    }
  }

  // Priority filter
  if (filter.priority) {
    result = result.filter(issue => issue.priority === filter.priority);
  }

  // Search filter (matches title or description)
  if (filter.search) {
    const term = filter.search.toLowerCase();
    result = result.filter(issue =>
      issue.title.toLowerCase().includes(term) ||
      issue.description?.toLowerCase().includes(term)
    );
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
