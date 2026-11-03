// Utility Functions

import { state } from './state.ts';
import type { Issue, UserRef } from './models.ts';

function startOfDay(date: Date | string) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Formats a date string as "<locale date> / <locale time>", e.g. for last-login or activity timestamps.
export function formatDateTime(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString(navigator.language) + ' / ' + d.toLocaleTimeString(navigator.language, { hour: '2-digit', minute: '2-digit' });
}

// What a deadline check reads: an issue, or the issue's deadline from the form before it is saved.
type DeadlineSource = { deadline: Date | string | null; release: Issue['release'] };

type DeadlineStatus = { late: false } | { late: true; reason: string };

// For an issue deadline.
export function getDeadlineStatus(issue: DeadlineSource): DeadlineStatus {
  if (!issue.deadline) return { late: false };
  const today = startOfDay(new Date());
  const deadline = startOfDay(issue.deadline);
  if (deadline < today) return { late: true, reason: 'Overdue!' };
  if (issue.release?.release_date) {
    if (deadline > startOfDay(issue.release.release_date)) return { late: true, reason: 'Past release date!' };
  }
  return { late: false };
}

// For a task deadline given its parent issue.
export function getTaskDeadlineStatus(taskDeadline: Date | string | null, issue: DeadlineSource | null): DeadlineStatus {
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

// Returns the element with this id typed as Type (default HTMLElement). A missing element or one
// of another type throws, so a wrong id or a changed page fails loudly at the lookup instead of
// later as a null or undefined property. For elements that may be absent, use
// document.getElementById and handle null.
export function byId(id: string): HTMLElement;
export function byId<T extends HTMLElement>(id: string, Type: new () => T): T;
export function byId(id: string, Type: new () => HTMLElement = HTMLElement): HTMLElement {
  const el: Element | null = document.getElementById(id);
  if (el === null) throw new TypeError(`#${id} is missing`);
  if (el instanceof Type) return el;
  throw new TypeError(`#${id} is a ${el.constructor.name}, expected ${Type.name}`);
}

// Same as byId for the first element in root matching selector.
export function bySelector(root: ParentNode, selector: string): HTMLElement;
export function bySelector<T extends HTMLElement>(root: ParentNode, selector: string, Type: new () => T): T;
export function bySelector(root: ParentNode, selector: string, Type: new () => HTMLElement = HTMLElement): HTMLElement {
  const el = root.querySelector(selector);
  if (el === null) throw new TypeError(`${selector} is missing`);
  if (el instanceof Type) return el;
  throw new TypeError(`${selector} is a ${el.constructor.name}, expected ${Type.name}`);
}

export function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// The message of a caught value: a thrown Error, or anything else turned into a string.
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

let notificationTimeout: ReturnType<typeof setTimeout> | undefined;
export function showNotification(message: string, type = 'success') {
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

// True while an error toast is on screen.
export function isErrorToastShown() {
  const toast = document.getElementById('notification-toast');
  return !!toast && toast.classList.contains('error') && !toast.classList.contains('hidden');
}

// Cancels the confirm dialog that is currently open, if any (see showConfirm).
let cancelPendingConfirm: (() => void) | null = null;

// cancelText null shows no Cancel button.
export function showConfirm(title: string, message: string, okText = 'OK', cancelText: string | null = 'Cancel', okType = 'danger') {
  // All confirms share one dialog. A new one replaces the question of a still-open one,
  // whose caller then gets false (Cancel): otherwise one click would answer both.
  cancelPendingConfirm?.();

  const confirmModal = byId('confirm-modal');
  const confirmTitle = byId('confirm-title');
  const confirmMessage = byId('confirm-message');
  const confirmOkBtn = byId('confirm-ok-btn');
  const confirmCancelBtn = byId('confirm-cancel-btn');

  return new Promise<boolean>((resolve) => {
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
      cancelPendingConfirm = null;
    };

    confirmOkBtn.addEventListener('click', handleOk);
    confirmCancelBtn.addEventListener('click', handleCancel);
    cancelPendingConfirm = () => {
      cleanup();
      resolve(false);
    };
  });
}

// ✕ and Escape of a Markdown editor: resolves true if its text may be thrown away,
// asking first if the user changed it.
export async function confirmDiscard(changed: boolean) {
  return !changed || showConfirm('Unsaved Changes', 'Discard changes?', 'Discard', 'Keep editing');
}

// Shows the merged password re-confirmation dialog (title + consequence message +
// password field) used by every admin-password-protected action (project delete,
// user update, issue/release/label delete, move issue). onConfirm(password) is
// called with the entered password when Confirm is clicked; it should perform the
// actual protected action and throw (with a user-facing message) on failure. On
// failure the dialog stays open and shows the error inline, letting the user retry
// without re-triggering the whole flow. Resolves true once onConfirm succeeds, or
// false if the user cancels.
export function promptAdminPasswordConfirmation(title: string, message: string, onConfirm: (password: string) => unknown, okText = 'Confirm', okType = 'danger') {
  return new Promise<boolean>((resolve) => {
    const modal = byId('admin-confirm-modal');
    const titleEl = byId('admin-confirm-title');
    const messageEl = byId('admin-confirm-message');
    const input = byId('admin-confirm-password', HTMLInputElement);
    const errorDiv = byId('admin-confirm-error');
    const okBtn = byId('admin-confirm-ok-btn');
    const cancelBtn = byId('admin-confirm-cancel-btn');

    titleEl.textContent = title;
    messageEl.textContent = message;
    okBtn.textContent = okText;
    okBtn.className = 'btn';
    okBtn.classList.add(okType);

    input.value = '';
    const usernameField = document.getElementById('admin-confirm-username');
    if (usernameField instanceof HTMLInputElement && state.currentUser) {
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

    // Enter calls onOk directly (not via a form submit), so a repeated Enter would
    // run the protected action twice without the guard.
    const confirm = guardSubmit(async () => {
      if (!input.value) {
        errorDiv.textContent = 'Password is required.';
        errorDiv.classList.remove('hidden');
        return false;
      }
      errorDiv.classList.add('hidden');
      try {
        await onConfirm(input.value);
        return true;
      } catch (err) {
        errorDiv.textContent = errorMessage(err) || 'Action failed.';
        errorDiv.classList.remove('hidden');
        input.focus();
        return false;
      }
    }, { field: document.getElementById('admin-confirm-form') });

    // Resolves only after the guard has re-enabled the dialog, so a caller that
    // opens the next dialog right away gets a usable one.
    async function onOk() {
      if (!(await confirm())) return;
      cleanup();
      resolve(true);
    }

    function onCancel() {
      cleanup();
      resolve(false);
    }

    function onKeydown(e: KeyboardEvent) {
      if (e.key === 'Enter') void onOk();
    }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKeydown);
  });
}

export function updateDateInputStyle(input: HTMLInputElement) {
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
        display.textContent = 'Select date...';
        display.classList.add('placeholder');
      }
    }
  }
}

// Formats a date as the value of an <input type="date"> (YYYY-MM-DD), '' for none.
export function toDateInputValue(date: Date | string | null) {
  return date ? new Date(date).toISOString().slice(0, 10) : '';
}

// Wraps an async function so concurrent calls share the running call's promise
// instead of starting it again. The next call after it settles starts a new run.
export function singleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return () => (inFlight ??= fn().finally(() => { inFlight = null; }));
}

// aria-disabled greys an element out and blocks clicks (base/utilities.css).
export function setAriaDisabled(el: Element, disabled: boolean) {
  if (disabled) el.setAttribute('aria-disabled', 'true'); //NOSONAR - sets or clears like classList.toggle(name, force); callers pass a computed state
  else el.removeAttribute('aria-disabled');
}

// Blocks keyup too: a focused button fires its Space click on keyup.
function blockWhileBusy(e: Event) {
  if ('key' in e && e.key === 'Tab') return;
  e.preventDefault();
  e.stopPropagation();
}

// Number of saves running per busy field
const busySaves = new WeakMap<Element, number>();

// Runs the save fn with the field (the element framing the input and its buttons)
// marked aria-busy, which dims it and blocks clicks (base/utilities.css), and with
// typing and keys ignored, so a slow save doesn't look like a click that went nowhere.
// Overlapping saves on one field keep it busy until the last one settles. Resolves to
// fn's result.
export async function markBusy<T>(field: Element | null, fn: () => T | Promise<T>): Promise<T> {
  if (!field) return fn();
  const running = busySaves.get(field) ?? 0;
  busySaves.set(field, running + 1);
  if (running === 0) {
    field.setAttribute('aria-busy', 'true');
    field.addEventListener('beforeinput', blockWhileBusy, true);
    field.addEventListener('keydown', blockWhileBusy, true);
    field.addEventListener('keyup', blockWhileBusy, true);
  }
  try {
    return await fn();
  } finally {
    const left = (busySaves.get(field) ?? 1) - 1;
    busySaves.set(field, left);
    if (left === 0) {
      field.removeAttribute('aria-busy');
      field.removeEventListener('beforeinput', blockWhileBusy, true);
      field.removeEventListener('keydown', blockWhileBusy, true);
      field.removeEventListener('keyup', blockWhileBusy, true);
    }
  }
}

// Wraps a save triggered by a button and/or keys. A repeated click or key while it
// runs joins the running save instead of sending it again, and the field is busy
// until it settles (markBusy), so nothing typed meanwhile is lost when the input is
// cleared afterwards. Resolves to fn's result.
export function guardSubmit<T>(fn: () => T | Promise<T>, { field = null }: { field?: Element | null } = {}) {
  return singleFlight(() => markBusy(field, fn));
}

// Submits the form through guardSubmit: Save and Enter share the in-flight submit
// instead of saving twice while the first request is still running. The whole form
// is the busy field.
export function onGuardedSubmit(form: HTMLFormElement, fn: () => unknown) {
  const submit = guardSubmit(fn, { field: form });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void submit();
  });
}

// Debounce a function call by a specified wait time, needed for search
export function debounce<A extends unknown[]>(func: (...args: A) => void, wait: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return function executedFunction(...args: A) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}


export function countCodepoints(str: string) {
  return [...str].length;
}

// countUtf8Bytes returns the UTF-8 byte length, as the backend's len() counts it.
export function countUtf8Bytes(str: string) {
  return new TextEncoder().encode(str).length;
}

// continueListOnEnter auto-continues a bullet/numbered markdown list when Enter
// is pressed on a list-item line (or ends the list when the item is empty).
// Shared by the issue-description editor and comment textareas. Returns true
// if it handled the keypress (caller should already have it prevented via e),
// false to let the default Enter behavior happen.
export function continueListOnEnter(textarea: HTMLTextAreaElement, e: Event) {
  const start = textarea.selectionStart;
  const value = textarea.value;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const currentLine = value.substring(lineStart, start);

  const bulletMatch = /^(\s*)([-*+]) (.*)$/.exec(currentLine);
  const numberedMatch = /^(\s*)(\d+)\. (.*)$/.exec(currentLine);
  const match = bulletMatch ?? numberedMatch;
  if (!match) return false;

  e.preventDefault();
  const [, indent, marker, content] = match;
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

export function initCharCounter(el: HTMLInputElement | HTMLTextAreaElement, maxLength: number, options: { className?: string, insertAfter?: Element, manual?: boolean } = {}) {
  const counter = document.createElement('span');
  counter.className = 'char-counter';
  if (options.className) counter.classList.add(options.className);

  const insertAfterEl = options.insertAfter || el;
  insertAfterEl.after(counter);

  function getCount() {
    return countCodepoints(el.value);
  }

  function update() {
    // Enforce codepoint limit by truncating excess characters
    const codepoints = [...el.value];
    if (codepoints.length > maxLength) {
      const pos = el.selectionStart ?? 0;
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

export function canArchive(issue: Issue): { allowed: true; reason?: undefined } | { allowed: false; reason: string } {
  if (issue.tasks?.some(t => !t.done)) {
    return { allowed: false, reason: 'Issue has open tasks' };
  }

  if (issue.planned_dates && issue.planned_dates.length > 0) {
    return { allowed: false, reason: 'Issue has planned dates' };
  }

  return { allowed: true };
}

export function getUserInitials(user: UserRef | null | undefined) {
  if (!user) return '??';

  if (user.first_name && user.last_name) {
    return (user.first_name[0] + user.last_name[0]).toUpperCase();
  }

  if (user.email) {
    return user.email.substring(0, 2).toUpperCase();
  }

  return '??';
}

export function getUnusedColor(usedColors: string[]) {
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

