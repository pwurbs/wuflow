// Utility Functions

export function stripHtml(html) {
  if (!html) return '';

  // Add spaces around block-level tags to prevent text merging
  const processed = html.replaceAll(
    /<\/?(div|p|li|ul|ol|h[1-6]|blockquote|pre|br)\b[^>]*>/gi,
    ' $& '
  );

  const parser = new DOMParser();
  const doc = parser.parseFromString(processed, 'text/html');
  const text = doc.body.textContent || doc.body.innerText || "";

  // Collapse multiple spaces into one and trim
  return text.replaceAll(/\s+/g, ' ').trim();
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

let modalNotificationTimeout;
export function showModalNotification(message, type = 'success') {
  const toast = document.getElementById('modal-notification-toast');
  if (!toast) return;
  if (modalNotificationTimeout) clearTimeout(modalNotificationTimeout);
  toast.textContent = message;
  // Reset classes and add specific ones (keep modal-toast)
  toast.className = 'notification-toast modal-toast ' + type;
  toast.classList.remove('hidden');
  modalNotificationTimeout = setTimeout(() => {
    toast.classList.add('hidden');
  }, 3000);
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

    if (cancelText === null) {
      confirmCancelBtn.classList.add('hidden');
    } else {
      confirmCancelBtn.classList.remove('hidden');
      confirmCancelBtn.textContent = cancelText;
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
  counter.className = 'char-counter' + (options.className ? ' ' + options.className : '');

  const insertAfterEl = options.insertAfter || el;
  insertAfterEl.parentNode.insertBefore(counter, insertAfterEl.nextSibling);

  const isContentEditable = el.contentEditable === 'true';

  // For contenteditable: capture last valid HTML before each change so we can revert
  let lastValidHtml = '';
  if (isContentEditable) {
    el.addEventListener('beforeinput', () => {
      lastValidHtml = el.innerHTML;
    });
  }

  function getCount() {
    return countCodepoints(isContentEditable ? el.innerHTML : el.value);
  }

  function update() {
    if (!isContentEditable) {
      // Enforce codepoint limit by truncating excess characters
      const codepoints = [...el.value];
      if (codepoints.length > maxLength) {
        const pos = el.selectionStart;
        el.value = codepoints.slice(0, maxLength).join('');
        // Restore cursor position (clamped to new length)
        el.selectionStart = el.selectionEnd = Math.min(pos, el.value.length);
      }
    } else if (countCodepoints(el.innerHTML) > maxLength) {
      // Revert to last valid HTML and restore cursor to end
      el.innerHTML = lastValidHtml;
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = globalThis.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
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

  if (issue.tasks && issue.tasks.some(t => !t.done)) {
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

const allowedTags = new Set(['B', 'I', 'U', 'UL', 'OL', 'LI', 'P', 'BR', 'A']);

/**
 * Removes all attributes from an element except for safe hrefs on anchor tags.
 * @param {HTMLElement} element 
 */
function cleanAttributes(element) {
  const isAnchor = element.tagName === 'A';
  const allowedAnchorAttrs = new Set(['href', 'target', 'rel']);
  const attrs = Array.from(element.attributes);

  for (const attr of attrs) {
    const isAllowed = isAnchor && allowedAnchorAttrs.has(attr.name);
    if (!isAllowed) {
      element.removeAttribute(attr.name);
      continue;
    }

    if (attr.name === 'href' && !/^(https?:\/\/)/i.test(attr.value)) {
      element.removeAttribute(attr.name);
    }
  }

  // Enforce security attributes on all links
  if (isAnchor && element.hasAttribute('href')) {
    element.setAttribute('target', '_blank');
    element.setAttribute('rel', 'noopener noreferrer');
  }
}

/**
 * Sanitizes HTML content for the description field.
 * Allows a safe subset of tags and attributes to prevent XSS.
 * @param {string} html 
 * @returns {string} Sanitized HTML
 */
export function sanitizeDescription(html) {
  if (!html) return '';
  const parser = new DOMParser();
  // 'text/html' creates an inert document where scripts don't execute
  const doc = parser.parseFromString(html, 'text/html');

  function clean(node) {
    // 1. Recurse into children first (bottom-up processing)
    let child = node.firstChild;
    while (child) {
      const next = child.nextSibling;
      clean(child);
      child = next;
    }

    // 2. Handle this node (skip body and document)
    if (node.nodeType === 9 || node === doc.body) return;

    if (node.nodeType === 1) { // ELEMENT_NODE
      if (allowedTags.has(node.tagName)) {
        cleanAttributes(node);
      } else {
        // Unwrap disallowed tag: move children up to parent, then remove node
        while (node.firstChild) {
          node.parentNode.insertBefore(node.firstChild, node);
        }
        node.remove();
      }
    } else if (node.nodeType !== 3) { // Not TEXT_NODE (e.g. Comment)
      node.remove();
    }
  }

  clean(doc.body);
  return doc.body.innerHTML;
}
