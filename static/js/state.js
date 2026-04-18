export const state = {
  issues: [],
  currentIssue: null,
  currentUser: null,
  selectedProjectId: null, // null = show all projects (project selector context)
  statusConfig: null,      // StatusConfig for selectedProjectId, null until loaded
  filter: {
    labelId: null,
    priority: null,
    assigneeId: null,
    search: '',
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

export function isFilterActive() {
  const { labelId, priority, assigneeId, search } = state.filter;
  return !!(labelId !== null || priority !== null || assigneeId !== null || (search && search.trim() !== ''));
}
