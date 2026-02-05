import { updateIssue } from './api.js';
import { state } from './state.js';

export async function handleMoveTop(issue, allIssuesInList, refreshCallback) {
  if (allIssuesInList.length <= 1 || allIssuesInList[0].id === issue.id) return;

  // Create a new array without the issue
  const otherIssues = allIssuesInList.filter(i => i.id !== issue.id);
  // Add the issue to the beginning
  const newOrder = [issue, ...otherIssues];

  await updatePositions(newOrder, refreshCallback);
}

export async function handleMoveBottom(issue, allIssuesInList, refreshCallback) {
  if (allIssuesInList.length <= 1 || allIssuesInList[allIssuesInList.length - 1].id === issue.id) return;

  // Create a new array without the issue
  const otherIssues = allIssuesInList.filter(i => i.id !== issue.id);
  // Add the issue to the end
  const newOrder = [...otherIssues, issue];

  await updatePositions(newOrder, refreshCallback);
}

export async function updatePositions(orderedIssues, refreshCallback) {
  const updates = [];
  orderedIssues.forEach((issue, index) => {
    if (issue.position !== index) {
      issue.position = index;
      updates.push(updateIssue(issue));
    }
  });

  if (updates.length > 0) {
    await Promise.all(updates);
    if (refreshCallback) refreshCallback();
  }
}

export function getListUpdates(listId, targetStatus) {
  const listElement = document.getElementById(listId);
  if (!listElement) return [];

  const cards = [...listElement.querySelectorAll('.card')];
  const updates = [];
  cards.forEach((card, index) => {
    const id = Number.parseInt(card.dataset.id);
    const issue = state.issues.find(i => i.id === id);
    if (issue && (issue.status !== targetStatus || issue.position !== index)) {
      issue.status = targetStatus;
      issue.position = index;
      updates.push(updateIssue(issue));
    }
  });
  return updates;
}
