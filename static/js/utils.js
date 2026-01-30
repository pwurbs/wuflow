// Utility Functions

export function stripHtml(html) {
  if (!html) return '';

  // Add spaces around block-level tags to prevent text merging
  const processed = html.replaceAll(
    /<\/?(div|p|li|ul|ol|h[1-6]|blockquote|pre|br)\b[^>]*>/gi,
    ' $& '
  );

  const tmp = document.createElement("DIV");
  tmp.innerHTML = processed;
  const text = tmp.textContent || tmp.innerText || "";

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

export function showNotification(message) {
  const notificationToast = document.getElementById('notification-toast');
  if (notificationToast) {
    notificationToast.textContent = message;
    notificationToast.classList.remove('hidden');
    setTimeout(() => {
      notificationToast.classList.add('hidden');
    }, 5000);
  }
}

export function showModalNotification(message) {
  const toast = document.getElementById('modal-notification-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => {
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
    confirmCancelBtn.textContent = cancelText;

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
      confirmModal.removeEventListener('click', handleModalClick);
    };

    const handleModalClick = (e) => {
      if (e.target === confirmModal) {
        handleCancel();
      }
    };

    confirmOkBtn.addEventListener('click', handleOk);
    confirmCancelBtn.addEventListener('click', handleCancel);
    confirmModal.addEventListener('click', handleModalClick);
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

