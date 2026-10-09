// Session & connection resilience:
// - Re-login dialog: when the session can no longer be refreshed, the user logs in again
//   in place and the failed request is replayed, so unsaved input is not lost.
// - Proactive check: when the user returns to the tab (or after a longer idle period),
//   the session is verified before they start typing.
// - Connection banner: shown while the server cannot be reached.

import { setSessionExpiredHandler, setConnectionListener, fetchCurrentUser, hasValidSession, reauthenticate, logout } from './api.js';
import { state } from './state.js';
import { singleFlight } from './utils.js';

const PROBE_THROTTLE_MS = 60 * 1000;
const IDLE_THRESHOLD_MS = 10 * 60 * 1000;

let lastProbeAt = 0;
let lastInteractionAt = Date.now();
let pendingReauth = null; // { promise, resolve } while the re-login dialog is open

export function setupSession() {
  setSessionExpiredHandler(showReauthDialog);
  setConnectionListener(setConnectionState);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') onReturn();
  });
  globalThis.addEventListener('focus', onReturn);
  globalThis.addEventListener('online', () => onReturn({ force: true }));
  globalThis.addEventListener('offline', () => setConnectionState(false));
  document.addEventListener('pointerdown', onInteraction, { capture: true, passive: true });
  document.addEventListener('keydown', onInteraction, { capture: true, passive: true });

  const form = document.getElementById('reauth-form');
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    void submitReauth();
  });
  document.getElementById('reauth-logout-btn')?.addEventListener('click', () => {
    // Same as the user menu's Logout. The beforeunload guard still warns about unsaved
    // edits; if the user stays, the dialog remains open.
    void logout();
  });
}

function onInteraction() {
  const now = Date.now();
  const wasIdle = now - lastInteractionAt >= IDLE_THRESHOLD_MS;
  lastInteractionAt = now;
  if (wasIdle) void probeSession({ force: true });
}

function onReturn({ force = false } = {}) {
  if (pendingReauth) {
    // Logged in again in another tab? Then the dialog is no longer needed.
    void closeDialogIfSessionValid();
    return;
  }
  void probeSession({ force });
}

/**
 * Verifies the session. An expired session opens the re-login dialog via authFetch,
 * a successful request hides the connection banner.
 */
export async function probeSession({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastProbeAt < PROBE_THROTTLE_MS) return;
  lastProbeAt = now;
  await fetchCurrentUser();
}

// Returning to the tab fires both visibilitychange and focus; they share one check.
const closeDialogIfSessionValid = singleFlight(async () => {
  if (pendingReauth && await hasValidSession()) finishReauth();
});

/**
 * Opens the re-login dialog and resolves once the user has logged in again.
 * Concurrent callers share the same dialog.
 */
export function showReauthDialog() {
  if (pendingReauth) return pendingReauth.promise;

  let resolve;
  const promise = new Promise(res => { resolve = res; });
  pendingReauth = { promise, resolve };

  const modal = document.getElementById('reauth-modal');
  const emailInput = document.getElementById('reauth-email');
  const passwordInput = document.getElementById('reauth-password');
  emailInput.value = state.currentUser?.email ?? '';
  passwordInput.value = '';
  setReauthError('');
  modal.classList.remove('hidden');
  passwordInput.focus();

  return promise;
}

async function submitReauth() {
  const emailInput = document.getElementById('reauth-email');
  const passwordInput = document.getElementById('reauth-password');
  const submitBtn = document.getElementById('reauth-submit-btn');

  setReauthError('');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Signing in…';
  try {
    const error = await reauthenticate(emailInput.value, passwordInput.value);
    if (error) {
      setReauthError(error);
      passwordInput.select();
      return;
    }
    finishReauth();
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign In';
  }
}

function finishReauth() {
  if (!pendingReauth) return;
  document.getElementById('reauth-password').value = '';
  document.getElementById('reauth-modal').classList.add('hidden');
  const { resolve } = pendingReauth;
  pendingReauth = null;
  lastProbeAt = Date.now();
  resolve();
}

function setReauthError(message) {
  const errorEl = document.getElementById('reauth-error');
  errorEl.textContent = message;
  errorEl.classList.toggle('hidden', !message);
}

/** Shows the connection banner while the server is unreachable. */
export function setConnectionState(ok) {
  document.getElementById('connection-banner')?.classList.toggle('hidden', ok);
}
