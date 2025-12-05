export const state = {
  issues: [],
  currentIssue: null
};

export function setIssues(newIssues) {
  state.issues = newIssues;
}

export function setCurrentIssue(issue) {
  state.currentIssue = issue;
}
