// Issue list loading: shared cache for the issue lists of the selected project.
// state.issues holds the active issues; the open and archived lists are only needed by the
// Backlog, Archive and Releases views, so they are loaded on demand and merged into it. A list
// is fetched at most once per load; concurrent requests for it join the one in flight.
// Kept separate from state.js, which stays free of API calls. See docs/frontend.md (Data Loading).
import { fetchActiveIssuesByProject, fetchOpenIssuesByProject, fetchArchivedIssuesByProject } from './api.js';
import { state, setIssues } from './state.js';

const LIST_FETCHERS = {
  open: fetchOpenIssuesByProject,
  archived: fetchArchivedIssuesByProject,
};

// Bumped by every loadIssues(), so results of a superseded load are discarded.
let generation = 0;
// Resolves once state.issues holds the active issues of the current generation.
let activeLoad = Promise.resolve();
// 'open' | 'archived' -> promise of the current generation (in flight or done).
let lists = {};

function mergeIntoIssues(issues) {
  const existingIds = new Set(state.issues.map(i => i.id));
  for (const issue of issues) {
    if (!existingIds.has(issue.id)) state.issues.push(issue);
  }
}

/**
 * Reloads the active issues and drops the cached open/archived lists. The given lists
 * (e.g. ['open'] for the Backlog) are fetched in the same wave as the active issues.
 */
export function loadIssues(kinds = []) {
  generation++;
  lists = {};
  const gen = generation;
  activeLoad = fetchActiveIssuesByProject(state.selectedProjectId).then(issues => {
    if (gen === generation) setIssues(issues);
  });
  return Promise.all([activeLoad, ensureIssueLists(kinds)]);
}

/**
 * Makes sure the given lists ('open', 'archived') are merged into state.issues. Lists
 * already loaded cost nothing; lists in flight are joined instead of fetched again.
 */
export function ensureIssueLists(kinds) {
  const gen = generation;
  const base = activeLoad;
  return Promise.all(kinds.map(kind => {
    lists[kind] ??= LIST_FETCHERS[kind](state.selectedProjectId).then(async issues => {
      // Merge only after the active issues are in place, or setIssues() would drop them.
      await base;
      if (gen === generation) mergeIntoIssues(issues);
    });
    return lists[kind];
  }));
}

// Forgets the cached lists without fetching anything (used by tests).
export function resetIssueLists() {
  generation++;
  lists = {};
  activeLoad = Promise.resolve();
}
