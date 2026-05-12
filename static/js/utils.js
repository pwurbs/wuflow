// Utility Functions

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
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

