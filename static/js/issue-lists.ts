// Issue list loading: shared cache for the issue lists of the selected project.
// state.issues holds the active issues; the open and archived lists are only needed by the
// Backlog, Archive and Releases views, so they are loaded on demand and merged into it. A list
// is fetched at most once per load; concurrent requests for it join the one in flight.
// Kept separate from state.ts, which stays free of API calls. See docs/frontend.md (Data Loading).
import { fetchActiveIssuesByProject, fetchOpenIssuesByProject, fetchArchivedIssuesByProject } from './api.ts';
import { state, setIssues } from './state.ts';
import type { Issue } from './models.ts';

// The lists each view needs on top of the active issues (Releases: progress counts every
// issue of the project).
export type IssueListKind = keyof typeof LIST_FETCHERS;

export const VIEW_ISSUE_LISTS: Record<'backlog' | 'archive' | 'releases', IssueListKind[]> = {
  backlog: ['open'],
  archive: ['archived'],
  releases: ['open', 'archived'],
};

const LIST_FETCHERS = {
  open: fetchOpenIssuesByProject,
  archived: fetchArchivedIssuesByProject,
};

type Lists = Partial<Record<IssueListKind, Promise<void>>>;

// Bumped by every loadIssues(), so results of a superseded load are discarded.
let generation = 0;
// Resolves once state.issues holds the active issues of the current generation.
let activeLoad = Promise.resolve();
// Promise of the current generation per list (in flight or loaded).
let lists: Lists = {};
// The lists state.issues contains.
let mergedLists: Lists = {};

// Without a selected project (the user has none) there is nothing to fetch.
function fetchForSelectedProject(fetcher: (projectId: number) => Promise<Issue[]>) {
  const projectId = state.selectedProjectId;
  return projectId === null ? Promise.resolve([]) : fetcher(projectId);
}

function mergeIntoIssues(issues: Issue[]) {
  const existingIds = new Set(state.issues.map(i => i.id));
  for (const issue of issues) {
    if (!existingIds.has(issue.id)) state.issues.push(issue);
  }
}

/**
 * Reloads the active issues and drops the cached open/archived lists. The given lists
 * (e.g. ['open'] for the Backlog) are fetched in the same wave as the active issues.
 * Everything is stored together, once ready has resolved too. If any of it fails,
 * state.issues and its lists stay as they were. A superseded load resolves without storing.
 */
export function loadIssues(kinds: IssueListKind[] = [], ready: Promise<unknown> = Promise.resolve()): Promise<void> {
  const gen = ++generation;
  const load: Promise<void> = Promise.all([
    fetchForSelectedProject(fetchActiveIssuesByProject),
    Promise.all(kinds.map(kind => fetchForSelectedProject(LIST_FETCHERS[kind]))),
    ready,
  ]).then(([active, loadedLists]) => {
    if (gen !== generation) return;
    setIssues(active);
    loadedLists.forEach(mergeIntoIssues);
    mergedLists = listsOf(kinds, load);
  }).catch(err => {
    if (gen !== generation) return; // superseded: the newer load reports its own errors
    activeLoad = Promise.resolve();
    lists = { ...mergedLists };
    throw err;
  });
  activeLoad = load;
  lists = listsOf(kinds, load);
  return load;
}

function listsOf(kinds: IssueListKind[], load: Promise<void>): Lists {
  return Object.fromEntries(kinds.map(kind => [kind, load]));
}

/**
 * Makes sure the given lists ('open', 'archived') are merged into state.issues. Lists
 * already loaded cost nothing; lists in flight are joined instead of fetched again.
 * A list that failed to load is fetched again by the next call.
 */
export function ensureIssueLists(kinds: IssueListKind[]) {
  return Promise.all(kinds.map(kind => lists[kind] ??= loadList(kind)));
}

function loadList(kind: IssueListKind): Promise<void> {
  const gen = generation;
  // Merge only after the active issues are in place, or setIssues() would drop them.
  const load: Promise<void> = Promise.all([fetchForSelectedProject(LIST_FETCHERS[kind]), activeLoad]).then(([issues]) => {
    if (gen !== generation) return;
    mergeIntoIssues(issues);
    mergedLists[kind] = load;
  }).catch(err => {
    if (gen !== generation) return; // superseded: the newer load reports its own errors
    if (lists[kind] === load) delete lists[kind];
    throw err;
  });
  return load;
}

// Forgets the cached lists without fetching anything (used by tests).
export function resetIssueLists() {
  generation++;
  lists = {};
  mergedLists = {};
  activeLoad = Promise.resolve();
}
