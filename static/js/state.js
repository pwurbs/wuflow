export const state = {
  issues: [],
  releases: [],
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
  },
};

export function setFilterLabel(labelId) {
  state.filter.labelId = labelId;
}

export function setFilterPriority(priority) {
  state.filter.priority = priority;
}

export function setFilterAssignee(assigneeId) {
  state.filter.assigneeId = assigneeId;
}

export function setFilterSearch(term) {
  state.filter.search = term;
}

export function setSelectedProject(projectId) {
  state.selectedProjectId = projectId;
}

export function setIssues(newIssues) {
  state.issues = newIssues;
}


export function setCurrentIssue(issue) {
  state.currentIssue = issue;
}

export function setCurrentUser(user) {
  state.currentUser = user;
}

export function setStatusConfig(cfg) {
  state.statusConfig = cfg;
}

export function setReleases(releases) {
  state.releases = releases;
}

export function setFilterRelease(releaseId) {
  state.filter.releaseId = releaseId;
}

export function setFilterReleaseOwner(id) {
  state.filter.releaseOwnerFilter = id;
}

export function setFilterReleaseSearch(term) {
  state.filter.releaseSearch = term;
}

export function isFilterActive() {
  const { labelId, priority, assigneeId, search, releaseId, releaseOwnerFilter, releaseSearch } = state.filter;
  return !!(labelId !== null || priority !== null || assigneeId !== null || releaseId !== null ||
    releaseOwnerFilter !== null ||
    search.trim() !== '' ||
    releaseSearch.trim() !== '');
}
