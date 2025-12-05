import { state } from '../state.js';
import { escapeHtml } from '../utils.js';

export function renderDeadlineList() {
  const deadlineList = document.getElementById('deadline-list');
  const deadlineCount = document.getElementById('deadline-count');
  deadlineList.innerHTML = '';

  const deadlineItems = [];
  state.issues.forEach(issue => {
    if (issue.deadline && issue.status !== 'Done') {
      deadlineItems.push({
        id: issue.id,
        issue_id: issue.id,
        title: issue.title,
        deadline: issue.deadline,
        isIssue: true
      });
    }
    if (issue.tasks) {
      issue.tasks.forEach(task => {
        if (task.deadline && !task.done) {
          deadlineItems.push({ ...task, issueTitle: issue.title, isIssue: false });
        }
      });
    }
  });

  deadlineItems.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
  deadlineCount.textContent = deadlineItems.length;

  deadlineItems.forEach(item => {
    const li = document.createElement('li');
    li.className = 'deadline-item';
    li.dataset.issueId = item.issue_id;

    const date = new Date(item.deadline).toLocaleDateString(navigator.language, { weekday: 'short', month: 'short', day: 'numeric' });
    const isOverdue = new Date(item.deadline) < new Date();

    li.innerHTML = `
            <span class="deadline-date ${isOverdue ? 'overdue' : ''}">
                ${isOverdue ? '<span class="overdue-indicator">⚠️</span>' : ''}${date}
            </span>
            <span class="deadline-task" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
        `;

    // Interaction: Scroll to card
    li.style.cursor = 'pointer';
    li.addEventListener('click', () => {
      // We need to dispatch event or call global to switch view and highlight
      // Dispatch event on document?
      const event = new CustomEvent('nav-to-issue', { detail: { issueId: item.issue_id } });
      document.dispatchEvent(event);
    });

    li.addEventListener('mouseenter', () => {
      const card = document.querySelector(`.card[data-id="${item.issue_id}"]`);
      if (card) card.classList.add('hover-highlight');
    });
    li.addEventListener('mouseleave', () => {
      const card = document.querySelector(`.card[data-id="${item.issue_id}"]`);
      if (card) card.classList.remove('hover-highlight');
    });

    deadlineList.appendChild(li);
  });
}
