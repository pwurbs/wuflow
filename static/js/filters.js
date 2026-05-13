/**
 * Filter logic extracted from board.js and backlog.js
 * Pure functions with no DOM dependencies for easy unit testing
 */

/**
 * Filter issues based on label, priority, assignee, and search criteria.
 * Project filtering is handled server-side; this function does not filter by project.
 * @param {Array} issues - Array of issue objects
 * @param {Object} filter - Filter criteria { labelId, priority, assigneeId, search }
 * @param {number|null} [currentUserId] - ID of the current user, required when filter.assigneeId === 'me'
 * @returns {Array} Filtered issues
 */
export function filterIssues(issues, filter, currentUserId) {
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
        return currentUserId != null && issue.assignee_id === currentUserId;
      } else if (filter.assigneeId === '' || filter.assigneeId === 'unassigned') {
        return issue.assignee_id === null;
      } else {
        return issue.assignee_id === Number.parseInt(filter.assigneeId);
      }
    });
  }

  // Release filter
  if (filter.releaseId !== null && filter.releaseId !== undefined) {
    result = result.filter(issue => matchesRelease(issue, filter.releaseId));
  }

  // Backlog lane multi-release filter (OR logic)
  if (filter.releaseFilterIds?.length) {
    result = result.filter(issue => matchesReleaseIds(issue, filter.releaseFilterIds));
  }

  // Search filter (matches id, title or description)
  if (filter.search) {
    const term = filter.search.trim().toLowerCase();
    if (term) {
      result = result.filter(issue =>
        String(issue.id).includes(term) ||
        issue.title.toLowerCase().includes(term) ||
        issue.description?.toLowerCase().includes(term)
      );
    }
  }

  return result;
}

function matchesRelease(issue, releaseId) {
  if (releaseId === '__no_release__') return !issue.release_id;
  return issue.release_id === releaseId;
}

function matchesReleaseIds(issue, releaseFilterIds) {
  return releaseFilterIds.includes(issue.release_id);
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
