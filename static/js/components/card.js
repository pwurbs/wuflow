import { escapeHtml, stripHtml } from '../utils.js';
import { setDraggedCard, setDraggedCardOrigin } from '../drag.js';

export function createCardElement(issue, isBoard = false, callbacks = {}) {
  const card = document.createElement('div');
  card.className = 'card';
  if (isBoard) {
    card.classList.add('board-card');
  }
  card.draggable = true;
  card.dataset.id = issue.id;
  if (issue.priority === 'High') {
    card.classList.add('high-priority');
  }

  const completedTasks = issue.tasks ? issue.tasks.filter(t => t.done).length : 0;
  const totalTasks = issue.tasks ? issue.tasks.length : 0;
  const openTasks = totalTasks - completedTasks;

  if (isBoard) {
    // New Board Card Layout
    card.innerHTML = `
            <div class="board-card-title">${escapeHtml(issue.title)}</div>
            <div class="board-card-label-space">
                ${issue.label ? `<span class="label-chip" style="background-color: ${issue.label.color}20; color: ${issue.label.color}; border: 1px solid ${issue.label.color};">${escapeHtml(issue.label.name)}</span>` : ''}
            </div>
            <div class="board-card-bottom">
                <div class="board-card-id">#${issue.id}</div>
                <div class="board-card-meta-right">
                    ${issue.deadline ? `<div class="board-card-deadline">📅 ${new Date(issue.deadline).toLocaleDateString(navigator.language, { month: 'numeric', day: 'numeric', year: 'numeric' })}</div>` : ''}
                    <div class="board-task-info">
                        <span class="board-task-icon">☐</span>
                        <span>${openTasks}</span>
                        ${issue.tasks && openTasks > 0 ? `
                        <div class="board-task-tooltip">
                            <ul>
                                ${issue.tasks.filter(t => !t.done).map(t => `
                                    <li>
                                        <span class="tooltip-icon">☐</span>
                                        <span class="tooltip-title">${escapeHtml(t.title)}</span>
                                        ${t.deadline ? `<span class="tooltip-deadline">📅 ${new Date(t.deadline).toLocaleDateString(navigator.language, { month: 'numeric', day: 'numeric' })}</span>` : ''}
                                    </li>
                                `).join('')}
                            </ul>
                        </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
  } else {
    // Existing Backlog Card Layout
    card.innerHTML = `
            <div class="card-main-content">
                <div class="card-title"><span class="card-id">Issue #${issue.id}</span> ${escapeHtml(issue.title)}</div>
                <div class="card-description">${escapeHtml(stripHtml(issue.description || ''))}</div>
            </div>
            ${'' /* Task list hidden for backlog view to match Open issues layout */}
            ${(() => {
        const hasDeadline = !!issue.deadline;
        const showProgress = totalTasks > 0;

        if (!hasDeadline && !showProgress) return '';

        return `<div class="card-meta">
                    ${hasDeadline ? `<span>📅 ${new Date(issue.deadline).toLocaleDateString(navigator.language)}</span>` : '<span></span>'}
                    ${showProgress ? `<div class="board-task-info">
                        <span class="board-task-icon">☐</span>
                        <span>${openTasks}</span>
                    </div>` : ''}
                </div>`;
      })()}
      ${issue.label ? `<div class="backlog-card-label" style="background-color: ${issue.label.color}20; color: ${issue.label.color}; border: 1px solid ${issue.label.color};">${escapeHtml(issue.label.name)}</div>` : ''}
        `;
  }

  // Event Listeners
  card.addEventListener('click', () => {
    if (callbacks.openModal) {
      callbacks.openModal(issue);
    }
  });

  card.addEventListener('dragstart', function (e) {
    setDraggedCard(this);
    setDraggedCardOrigin({
      parent: this.parentNode,
      nextSibling: this.nextElementSibling
    });
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';

    if (callbacks.onDragStart) callbacks.onDragStart(this);
  });

  card.addEventListener('dragend', function (e) {
    this.classList.remove('dragging');
    setDraggedCard(null);
    setDraggedCardOrigin(null);



    if (callbacks.onDragEnd) callbacks.onDragEnd(this, e);
  });

  // Hover handlers for planning/deadline highlighting
  card.addEventListener('mouseenter', () => {
    document.querySelectorAll(`.planning-item[data-id="${issue.id}"]`).forEach(el => el.classList.add('hover-highlight'));
    document.querySelectorAll(`.deadline-item[data-issue-id="${issue.id}"]`).forEach(el => el.classList.add('hover-highlight'));
  });

  card.addEventListener('mouseleave', () => {
    document.querySelectorAll(`.planning-item[data-id="${issue.id}"]`).forEach(el => el.classList.remove('hover-highlight'));
    document.querySelectorAll(`.deadline-item[data-issue-id="${issue.id}"]`).forEach(el => el.classList.remove('hover-highlight'));
  });

  return card;
}
