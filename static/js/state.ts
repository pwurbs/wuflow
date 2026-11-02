import type { Issue, Label, Project, Release, StatusConfig, User } from './models.ts';
import type { Priority } from './domain-constants.ts';

// User filter values: a user ID or one of the fixed choices.
export type UserFilter = number | 'me' | 'unassigned';

export interface Filter {
  labelId: number | '__no_label__' | null;
  priority: Priority | null;
  assigneeId: UserFilter | null;
  search: string;
  releaseId: number | '__no_release__' | null;
  releaseOwnerFilter: UserFilter | null;
  releaseSearch: string;
  releaseFilterIds: (number | null)[]; // backlog release lanes, null = "No Release" lane
}

export interface State {
  issues: Issue[];
  releases: Release[];
  labels: Label[];
  labelsProjectId: number | null;
  users: User[];
  projects: Project[];
  currentIssue: Issue | null;
  currentUser: User | null;
  selectedProjectId: number | null;
  statusConfig: StatusConfig | null;
  filter: Filter;
}

export const state: State = {
  issues: [],
  releases: [],
  labels: [],              // labels of labelsProjectId, loaded by refreshApp
  labelsProjectId: null,   // project the cached labels belong to (null = none cached)
  users: [],
  projects: [],
  currentIssue: null,
  currentUser: null,
  selectedProjectId: null, // null = show all projects (project selector context)
  statusConfig: null,      // StatusConfig for selectedProjectId, null until loaded
  filter: {
    labelId: null,
    priority: null,
    assigneeId: null,
    search: '',
    releaseId: null,
    releaseOwnerFilter: null,
    releaseSearch: '',
    releaseFilterIds: [],
  },
};

export function setFilterLabel(labelId: Filter['labelId']) {
  state.filter.labelId = labelId;
}

export function setFilterPriority(priority: Filter['priority']) {
  state.filter.priority = priority;
}

export function setFilterAssignee(assigneeId: Filter['assigneeId']) {
  state.filter.assigneeId = assigneeId;
}

export function setFilterSearch(term: string) {
  state.filter.search = term;
}

export function setSelectedProject(projectId: number | null) {
  state.selectedProjectId = projectId;
}

export function setIssues(newIssues: Issue[]) {
  state.issues = newIssues;
}


export function setCurrentIssue(issue: Issue | null) {
  state.currentIssue = issue;
}

export function setCurrentUser(user: User | null) {
  state.currentUser = user;
}

export function setStatusConfig(cfg: StatusConfig | null) {
  state.statusConfig = cfg;
}

export function setReleases(releases: Release[]) {
  state.releases = releases;
}

export function setLabels(labels: Label[], projectId: number | null) {
  state.labels = labels;
  state.labelsProjectId = projectId;
}

export function setUsers(users: User[]) {
  state.users = users;
}

export function setProjects(projects: Project[]) {
  state.projects = projects;
}

export function setFilterRelease(releaseId: Filter['releaseId']) {
  state.filter.releaseId = releaseId;
}

export function setFilterReleaseOwner(id: Filter['releaseOwnerFilter']) {
  state.filter.releaseOwnerFilter = id;
}

export function pruneReleaseFilterIds(validIds: Set<number | null>) {
  state.filter.releaseFilterIds = state.filter.releaseFilterIds.filter(id => validIds.has(id));
}

export function toggleBacklogReleaseFilter(releaseId: number | null) {
  const ids = state.filter.releaseFilterIds;
  const idx = ids.indexOf(releaseId);
  if (idx === -1) ids.push(releaseId);
  else ids.splice(idx, 1);
}

export function setFilterReleaseSearch(term: string) {
  state.filter.releaseSearch = term;
}

export function isFilterActive(): boolean {
  const { labelId, priority, assigneeId, search, releaseId, releaseOwnerFilter, releaseSearch, releaseFilterIds } = state.filter;
  return !!(labelId !== null || priority !== null || assigneeId !== null || releaseId !== null ||
    releaseOwnerFilter !== null ||
    search.trim() !== '' ||
    releaseSearch.trim() !== '' ||
    releaseFilterIds.length > 0);
}
