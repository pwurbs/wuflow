export const state = {
  issues: [],
  currentIssue: null,
  filter: { label: null }
};

export function setFilterLabel(label) {
  state.filter.label = label;
}

export function setIssues(newIssues) {
  state.issues = newIssues;
}

export function setCurrentIssue(issue) {
  state.currentIssue = issue;
}
