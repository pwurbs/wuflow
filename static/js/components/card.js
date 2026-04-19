import { escapeHtml } from '../utils.js';
import { COLOR_REGEX } from '../validation-config.js';
import { setDraggedCard, setDraggedCardOrigin } from '../drag.js';

export function createCardElement(issue, isBoard = false, callbacks = {}) {
  const card = document.createElement('div');
  card.className = 'card';
  if (isBoard) {
    card.classList.add('board-card');
  }
  card.draggable = issue.status !== 'Archive';
  card.dataset.id = issue.id;
  card.classList.toggle('is-archived', issue.status === 'Archive');
  if (issue.priority === 'High') {
    card.classList.add('high-priority');
  }

  const completedTasks = issue.tasks ? issue.tasks.filter(t => t.done).length : 0;
  const totalTasks = issue.tasks ? issue.tasks.length : 0;
  const openTasks = totalTasks - completedTasks;

  if (isBoard) {
    card.innerHTML = getBoardCardHTML(issue, openTasks);
  } else {
    card.innerHTML = getBacklogCardHTML(issue, openTasks, totalTasks);
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
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => {
      this.classList.add('dragging');
      document.body.classList.add('is-dragging');
    }, 0);

    if (callbacks.onDragStart) callbacks.onDragStart(this);
  });

  card.addEventListener('dragend', function (e) {
    this.classList.remove('dragging');
    document.body.classList.remove('is-dragging');
    setDraggedCard(null);
    setDraggedCardOrigin(null);

    if (callbacks.onDragEnd) callbacks.onDragEnd(this, e);
  });

  // Hover handlers for planning highlighting
  card.addEventListener('mouseenter', () => {
    document.querySelectorAll(`.planning-item[data-id="${issue.id}"]`).forEach(el => el.classList.add('hover-highlight'));
  });

  card.addEventListener('mouseleave', () => {
    document.querySelectorAll(`.planning-item[data-id="${issue.id}"]`).forEach(el => el.classList.remove('hover-highlight'));
  });

  return card;
}

function getBoardCardHTML(issue, openTasks) {
  const labelColor = issue.label && COLOR_REGEX.test(issue.label.color) ? issue.label.color : '#808080';

  return `
            <div class="board-card-title">${escapeHtml(issue.title)}</div>
            <div class="board-card-label-space">
                ${issue.label ? `<span class="label-chip" style="background-color: ${labelColor}20; color: ${labelColor}; border: 1px solid ${labelColor};">${escapeHtml(issue.label.name)}</span>` : ''}
            </div>
            <div class="board-card-bottom">
                <div class="board-card-id-group" style="display: flex; align-items: center; gap: 8px;">
                  <div class="board-card-id">#${issue.id}</div>
                  ${getAssigneeBadgeHTML(issue)}
                </div>
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
}

function getBacklogCardHTML(issue, openTasks, totalTasks) {
  const labelColor = issue.label && COLOR_REGEX.test(issue.label.color) ? issue.label.color : '#808080';

  const taskTooltipHTML = openTasks > 0 ? `
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
    </div>` : '';

  return `
    <div class="backlog-card-left">
        <span class="card-id">Issue #${issue.id}</span>
        ${issue.assignee ? getAssigneeBadgeHTML(issue) : '<span class="backlog-badge-placeholder"></span>'}
        <span class="backlog-card-title">${escapeHtml(issue.title)}</span>
    </div>
    <div class="backlog-card-spacer"></div>
    <div class="backlog-card-right">
        ${issue.label ? `<span class="label-chip" style="background-color: ${labelColor}20; color: ${labelColor}; border: 1px solid ${labelColor};">${escapeHtml(issue.label.name)}</span>` : ''}
        ${issue.deadline ? `<span class="backlog-card-deadline">📅 ${new Date(issue.deadline).toLocaleDateString(navigator.language, { month: 'numeric', day: 'numeric', year: 'numeric' })}</span>` : ''}
        ${totalTasks > 0 ? `
        <div class="board-task-info">
            <span class="board-task-icon">☐</span>
            <span>${openTasks}</span>
            ${taskTooltipHTML}
        </div>
        ` : ''}
    </div>
  `;
}

function getAssigneeBadgeHTML(issue, extraStyle = '') {
  if (!issue.assignee) return '';
  const initials = getUserInitials(issue.assignee);
  const fullName = `${issue.assignee.first_name} ${issue.assignee.last_name}`;
  return `<span class="user-badge" title="Assignee: ${escapeHtml(fullName)}" style="${extraStyle}">${escapeHtml(initials)}</span>`;
}

function getUserInitials(user) {
  if (!user) return '?';
  const first = user.first_name ? user.first_name.charAt(0) : '';
  const last = user.last_name ? user.last_name.charAt(0) : '';
  return (first + last).toUpperCase() || '?';
}

