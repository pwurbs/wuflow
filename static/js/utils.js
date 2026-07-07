// Utility Functions

import { state } from './state.js';

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Formats a date string as "<locale date> / <locale time>", e.g. for last-login or activity timestamps.
export function formatDateTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString(navigator.language) + ' / ' + d.toLocaleTimeString(navigator.language, { hour: '2-digit', minute: '2-digit' });
}

// Returns { late: false } or { late: true, reason: string } for an issue deadline.
export function getDeadlineStatus(issue) {
  if (!issue?.deadline) return { late: false };
  const today = startOfDay(new Date());
  const deadline = startOfDay(issue.deadline);
  if (deadline < today) return { late: true, reason: 'Overdue!' };
  if (issue.release?.release_date) {
    if (deadline > startOfDay(issue.release.release_date)) return { late: true, reason: 'Past release date!' };
  }
  return { late: false };
}

// Returns { late: false } or { late: true, reason: string } for a task deadline given its parent issue.
export function getTaskDeadlineStatus(taskDeadline, issue) {
  if (!taskDeadline) return { late: false };
  const today = startOfDay(new Date());
  const d = startOfDay(taskDeadline);
  if (d < today) return { late: true, reason: 'Overdue!' };
  if (issue?.deadline) {
    if (d > startOfDay(issue.deadline)) return { late: true, reason: 'After issue deadline!' };
  } else if (issue?.release?.release_date) {
    if (d > startOfDay(issue.release.release_date)) return { late: true, reason: 'Past release date!' };
  }
  return { late: false };
}

export function escapeHtml(text) {
  if (!text) return '';
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

let notificationTimeout;
export function showNotification(message, type = 'success') {
  const notificationToast = document.getElementById('notification-toast');
  if (notificationToast) {
    if (notificationTimeout) clearTimeout(notificationTimeout);
    notificationToast.textContent = message;
    // Reset classes and add specific ones
    notificationToast.className = 'notification-toast ' + type;
    notificationToast.classList.remove('hidden');
    notificationTimeout = setTimeout(() => {
      notificationToast.classList.add('hidden');
    }, 5000);
  }
}


export function showConfirm(title, message, okText = 'OK', cancelText = 'Cancel', okType = 'danger') {
  const confirmModal = document.getElementById('confirm-modal');
  const confirmTitle = document.getElementById('confirm-title');
  const confirmMessage = document.getElementById('confirm-message');
  const confirmOkBtn = document.getElementById('confirm-ok-btn');
  const confirmCancelBtn = document.getElementById('confirm-cancel-btn');

  return new Promise((resolve) => {
    confirmTitle.textContent = title;
    confirmMessage.textContent = message;
    confirmOkBtn.textContent = okText;

    if (cancelText) {
      confirmCancelBtn.classList.remove('hidden');
      confirmCancelBtn.textContent = cancelText;
    } else {
      confirmCancelBtn.classList.add('hidden');
    }

    // Reset classes and add specific one
    confirmOkBtn.className = 'btn';
    confirmOkBtn.classList.add(okType);

    confirmModal.classList.remove('hidden');

    const handleOk = () => {
      confirmModal.classList.add('hidden');
      cleanup();
      resolve(true);
    };

    const handleCancel = () => {
      confirmModal.classList.add('hidden');
      cleanup();
      resolve(false);
    };

    const cleanup = () => {
      confirmOkBtn.removeEventListener('click', handleOk);
      confirmCancelBtn.removeEventListener('click', handleCancel);
    };

    confirmOkBtn.addEventListener('click', handleOk);
    confirmCancelBtn.addEventListener('click', handleCancel);
  });
}

// Shows the merged password re-confirmation dialog (title + consequence message +
// password field) used by every admin-password-protected action (project delete,
// user update, issue/release/label delete, move issue). onConfirm(password) is
// called with the entered password when Confirm is clicked; it should perform the
// actual protected action and throw (with a user-facing message) on failure. On
// failure the dialog stays open and shows the error inline, letting the user retry
// without re-triggering the whole flow. Resolves true once onConfirm succeeds, or
// false if the user cancels.
export function promptAdminPasswordConfirmation(title, message, onConfirm, okText = 'Confirm', okType = 'danger') {
  return new Promise((resolve) => {
    const modal = document.getElementById('admin-confirm-modal');
    const titleEl = document.getElementById('admin-confirm-title');
    const messageEl = document.getElementById('admin-confirm-message');
    const input = document.getElementById('admin-confirm-password');
    const errorDiv = document.getElementById('admin-confirm-error');
    const okBtn = document.getElementById('admin-confirm-ok-btn');
    const cancelBtn = document.getElementById('admin-confirm-cancel-btn');

    titleEl.textContent = title;
    messageEl.textContent = message;
    okBtn.textContent = okText;
    okBtn.className = 'btn';
    okBtn.classList.add(okType);

    input.value = '';
    const usernameField = document.getElementById('admin-confirm-username');
    if (usernameField && state.currentUser) {
      usernameField.value = state.currentUser.email || '';
    }
    errorDiv.textContent = '';
    errorDiv.classList.add('hidden');
    modal.classList.remove('hidden');
    input.focus();

    function cleanup() {
      modal.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKeydown);
    }

    async function onOk() {
      if (!input.value) {
        errorDiv.textContent = 'Password is required.';
        errorDiv.classList.remove('hidden');
        return;
      }
      errorDiv.classList.add('hidden');
      okBtn.disabled = true;
      try {
        await onConfirm(input.value);
        okBtn.disabled = false;
        cleanup();
        resolve(true);
      } catch (err) {
        okBtn.disabled = false;
        errorDiv.textContent = err.message || 'Action failed.';
        errorDiv.classList.remove('hidden');
        input.focus();
      }
    }

    function onCancel() {
      cleanup();
      resolve(false);
    }

    function onKeydown(e) {
      if (e.key === 'Enter') onOk();
    }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKeydown);
  });
}

export function updateDateInputStyle(input) {
  if (input.value) {
    input.classList.add('has-value');
  } else {
    input.classList.remove('has-value');
  }

  // Update custom display if present
  const container = input.closest('.custom-date-input');
  if (container) {
    const display = container.querySelector('.custom-date-display');
    if (display) {
      if (input.value) {
        // Parse YYYY-MM-DD to local date to avoid timezone issues
        const [y, m, d] = input.value.split('-').map(Number);
        const date = new Date(y, m - 1, d);
        display.textContent = date.toLocaleDateString(navigator.language, {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        });
        display.classList.remove('placeholder');
      } else {
        if (input.id === 'new-task-deadline') {
          display.textContent = '';
        } else {
          display.textContent = 'Select date...';
        }
        display.classList.add('placeholder');
      }
    }
  }
}

// Debounce a function call by a specified wait time, needed for search
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}


export function countCodepoints(str) {
  return [...str].length;
}

// continueListOnEnter auto-continues a bullet/numbered markdown list when Enter
// is pressed on a list-item line (or ends the list when the item is empty).
// Shared by the issue-description editor and comment textareas. Returns true
// if it handled the keypress (caller should already have it prevented via e),
// false to let the default Enter behavior happen.
export function continueListOnEnter(textarea, e) {
  const start = textarea.selectionStart;
  const value = textarea.value;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const currentLine = value.substring(lineStart, start);

  const bulletMatch = currentLine.match(/^(\s*)([-*+]) (.*)$/);
  const numberedMatch = currentLine.match(/^(\s*)(\d+)\. (.*)$/);
  if (!bulletMatch && !numberedMatch) return false;

  e.preventDefault();
  const [, indent, marker, content] = bulletMatch ?? numberedMatch;
  const isBullet = !!bulletMatch;

  if (content === '') {
    // Empty list item: remove marker, stop list
    textarea.value = value.substring(0, lineStart) + value.substring(start);
    textarea.selectionStart = textarea.selectionEnd = lineStart;
  } else {
    // Continue list
    const nextPrefix = isBullet
      ? `\n${indent}${marker} `
      : `\n${indent}${Number.parseInt(marker, 10) + 1}. `;
    textarea.value = value.substring(0, start) + nextPrefix + value.substring(start);
    textarea.selectionStart = textarea.selectionEnd = start + nextPrefix.length;
  }
  textarea.dispatchEvent(new Event('input'));
  return true;
}

export function initCharCounter(el, maxLength, options = {}) {
  const counter = document.createElement('span');
  counter.className = 'char-counter';
  if (options.className) counter.classList.add(options.className);

  const insertAfterEl = options.insertAfter || el;
  insertAfterEl.parentNode.insertBefore(counter, insertAfterEl.nextSibling);

  function getCount() {
    return countCodepoints(el.value);
  }

  function update() {
    // Enforce codepoint limit by truncating excess characters
    const codepoints = [...el.value];
    if (codepoints.length > maxLength) {
      const pos = el.selectionStart;
      el.value = codepoints.slice(0, maxLength).join('');
      // Restore cursor position (clamped to new length)
      el.selectionStart = el.selectionEnd = Math.min(pos, el.value.length);
    }
    const count = getCount();
    counter.textContent = count + '/' + maxLength;
    if (count >= maxLength) {
      counter.classList.add('at-limit');
    } else {
      counter.classList.remove('at-limit');
    }
  }

  function show() {
    update();
    counter.classList.add('visible');
  }

  function hide() {
    counter.classList.remove('visible');
  }

  el.addEventListener('input', update);

  if (!options.manual) {
    el.addEventListener('focus', show);
    el.addEventListener('blur', hide);
  }

  return { show, hide };
}

export function canArchive(issue) {
  if (!issue) return { allowed: false, reason: 'No issue provided' };

  if (issue.tasks?.some(t => !t.done)) {
    return { allowed: false, reason: 'Issue has open tasks' };
  }

  if (issue.planned_dates && issue.planned_dates.length > 0) {
    return { allowed: false, reason: 'Issue has planned dates' };
  }

  return { allowed: true };
}

export function getUserInitials(user) {
  if (!user) return '??';

  if (user.first_name && user.last_name) {
    return (user.first_name[0] + user.last_name[0]).toUpperCase();
  }

  if (user.email) {
    return user.email.substring(0, 2).toUpperCase();
  }

  return '??';
}

export function getUnusedColor(usedColors) {
  const colors = [
    '#EF5350', '#EC407A', '#AB47BC', '#7E57C2', '#5C6BC0',
    '#42A5F5', '#29B6F6', '#26C6DA', '#26A69A', '#66BB6A',
    '#9CCC65', '#D4E157', '#FFEE58', '#FFCA28', '#FFA726',
    '#FF7043', '#8D6E63', '#78909C'
  ];

  const availableColors = colors.filter(c => !usedColors.includes(c));

  if (availableColors.length > 0) {
    return availableColors[Math.floor(Math.random() * availableColors.length)]; //NOSONAR
  }

  return colors[Math.floor(Math.random() * colors.length)]; //NOSONAR
}

