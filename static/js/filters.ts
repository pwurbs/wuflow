/**
 * Filter logic extracted from board.ts and backlog.ts
 * Pure functions with no DOM dependencies for easy unit testing
 */
import type { Issue } from './models.ts';
import type { Filter } from './state.ts';
import type { IssueStatus } from './status-config.ts';

/**
 * Filter issues based on label, priority, assignee, and search criteria.
 * Project filtering is handled server-side; this function does not filter by project.
 * @param issues - Array of issue objects
 * @param filter - Filter criteria { labelId, priority, assigneeId, search }
 * @param currentUserId - ID of the current user, required when filter.assigneeId === 'me'
 * @returns Filtered issues
 */
export function filterIssues(issues: Issue[], filter: Partial<Filter>, currentUserId?: number | null): Issue[] {
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
      } else if (filter.assigneeId === 'unassigned') {
        return issue.assignee_id === null;
      } else {
        return issue.assignee_id === filter.assigneeId;
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

function matchesRelease(issue: Issue, releaseId: Filter['releaseId']) {
  if (releaseId === '__no_release__') return !issue.release_id;
  return issue.release_id === releaseId;
}

function matchesReleaseIds(issue: Issue, releaseFilterIds: Filter['releaseFilterIds']) {
  return releaseFilterIds.includes(issue.release_id);
}

/**
 * Filter issues by status
 * @param issues - Array of issue objects
 * @param status - Status to filter by
 * @returns Issues matching the status
 */
export function filterByStatus(issues: Issue[], status: IssueStatus): Issue[] {
  if (!issues || !Array.isArray(issues)) {
    return [];
  }
  return issues.filter(issue => issue.status === status);
}

/**
 * Sort issues by position
 * @param issues - Array of issue objects
 * @returns Sorted issues (does not mutate original)
 */
export function sortByPosition(issues: Issue[]): Issue[] {
  if (!issues || !Array.isArray(issues)) {
    return [];
  }
  return [...issues].sort((a, b) => a.position - b.position);
}
