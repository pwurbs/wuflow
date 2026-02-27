import { escapeHtml } from '../utils.js';
import { stripMarkdown } from '../markdown.js';
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
    const showMoveControls = callbacks.onMoveTop && callbacks.onMoveBottom;
    card.innerHTML = getBacklogCardHTML(issue, openTasks, totalTasks, showMoveControls);

    if (showMoveControls) {
      card.querySelector('.move-up').addEventListener('click', (e) => {
        e.stopPropagation();
        callbacks.onMoveTop();
      });
      card.querySelector('.move-down').addEventListener('click', (e) => {
        e.stopPropagation();
        callbacks.onMoveBottom();
      });
    }
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
  return `
            <div class="board-card-title">${escapeHtml(issue.title)}</div>
            <div class="board-card-label-space">
                ${issue.label ? `<span class="label-chip" style="background-color: ${issue.label.color}20; color: ${issue.label.color}; border: 1px solid ${issue.label.color};">${escapeHtml(issue.label.name)}</span>` : ''}
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

function getBacklogCardHTML(issue, openTasks, totalTasks, showMoveControls) {
  return `
            ${showMoveControls ? `
            <div class="card-move-controls">
                <div class="move-up" title="Move to Top">↑↑</div>
                <div class="move-down" title="Move to Bottom">↓↓</div>
            </div>
            ` : ''}
            <div class="card-main-content">
                <div class="card-header-row" style="display: flex; justify-content: space-between; align-items: flex-start;">
                  <div class="card-title" style="display: flex; align-items: center;">
                    <span class="card-id" style="margin-right: 8px;">Issue #${issue.id}</span>
                    ${getAssigneeBadgeHTML(issue, 'margin-right: 8px;')}
                    <span>${escapeHtml(issue.title)}</span>
                  </div>
                </div>
                <div class="card-description">${escapeHtml(stripMarkdown(issue.description || ''))}</div>
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

