import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { byId } from '../utils.ts';
import { makeUser } from './fixtures.ts';

vi.mock('../api.ts', () => ({
  setSessionExpiredHandler: vi.fn(),
  setConnectionListener: vi.fn(),
  fetchCurrentUser: vi.fn(),
  hasValidSession: vi.fn(),
  reauthenticate: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('../state.ts', () => ({
  state: { currentUser: { email: 'me@example.com' } }
}));

const flush = () => new Promise(process.nextTick);

describe('Session', () => {
  let session: typeof import('../session.ts');
  let api: typeof import('../api.ts');
  let abort: AbortController;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-08T12:00:00Z'));
    document.body.innerHTML = `
      <div id="reauth-modal" class="hidden">
        <form id="reauth-form">
          <input id="reauth-email" readonly>
          <input id="reauth-password" type="password">
          <div id="reauth-error" class="hidden"></div>
          <button type="button" id="reauth-logout-btn"></button>
          <button type="submit" id="reauth-submit-btn"></button>
        </form>
      </div>
      <output id="connection-banner" class="hidden"></output>
    `;
    vi.stubGlobal('location', { href: '' });

    // Fresh module per test: session.ts keeps module-level state and adds global listeners.
    // Listeners are routed through an AbortController so they don't leak between tests.
    abort = new AbortController();
    const addDoc = document.addEventListener.bind(document);
    const addWin = globalThis.addEventListener.bind(globalThis);
    vi.spyOn(document, 'addEventListener').mockImplementation((t, l, o) => addDoc(t, l, { ...(typeof o === 'object' ? o : {}), signal: abort.signal }));
    vi.spyOn(globalThis, 'addEventListener').mockImplementation((t, l, o) => addWin(t, l, { ...(typeof o === 'object' ? o : {}), signal: abort.signal }));

    vi.resetModules();
    api = await import('../api.ts');
    vi.clearAllMocks();
    vi.mocked(api.fetchCurrentUser).mockResolvedValue(makeUser({ id: 1 }));
    session = await import('../session.ts');
    session.setupSession();
  });

  afterEach(() => {
    abort.abort();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('registers the re-login handler and connection listener with the API layer', () => {
    expect(api.setSessionExpiredHandler).toHaveBeenCalledWith(session.showReauthDialog);
    expect(api.setConnectionListener).toHaveBeenCalledWith(session.setConnectionState);
  });

  describe('re-login dialog', () => {
    it('opens with the current email pre-filled and read-only', () => {
      void session.showReauthDialog();

      expect(byId('reauth-modal').classList.contains('hidden')).toBe(false);
      expect(byId('reauth-email', HTMLInputElement).value).toBe('me@example.com');
      expect(byId('reauth-email', HTMLInputElement).readOnly).toBe(true);
    });

    it('resolves after a successful login and closes', async () => {
      vi.mocked(api.reauthenticate).mockResolvedValue(null);
      const done = vi.fn();
      void session.showReauthDialog().then(done);

      byId('reauth-password', HTMLInputElement).value = 'secret';
      byId('reauth-form').dispatchEvent(new Event('submit', { cancelable: true }));
      await flush();

      expect(api.reauthenticate).toHaveBeenCalledWith('me@example.com', 'secret');
      expect(done).toHaveBeenCalled();
      expect(byId('reauth-modal').classList.contains('hidden')).toBe(true);
      expect(byId('reauth-password', HTMLInputElement).value).toBe('');
    });

    it('shows the error inline and stays open on failed login', async () => {
      vi.mocked(api.reauthenticate).mockResolvedValue('Invalid credentials');
      const done = vi.fn();
      void session.showReauthDialog().then(done);

      byId('reauth-form').dispatchEvent(new Event('submit', { cancelable: true }));
      await flush();

      expect(done).not.toHaveBeenCalled();
      expect(byId('reauth-modal').classList.contains('hidden')).toBe(false);
      const error = byId('reauth-error');
      expect(error.textContent).toBe('Invalid credentials');
      expect(error.classList.contains('hidden')).toBe(false);
    });

    it('shares one dialog between concurrent callers', () => {
      const p1 = session.showReauthDialog();
      const p2 = session.showReauthDialog();
      expect(p1).toBe(p2);
    });

    it('logs out like the user menu on "Log Out"', () => {
      void session.showReauthDialog();
      byId('reauth-logout-btn').click();
      expect(api.logout).toHaveBeenCalled();
    });

    it('shows "Signing in…" while the login request runs', async () => {
      const { promise: pendingLogin, resolve: resolveLogin } = Promise.withResolvers<string | null>();
      vi.mocked(api.reauthenticate).mockReturnValue(pendingLogin);
      void session.showReauthDialog();
      const btn = byId('reauth-submit-btn', HTMLButtonElement);

      byId('reauth-form').dispatchEvent(new Event('submit', { cancelable: true }));
      expect(btn.textContent).toBe('Signing in…');
      expect(btn.disabled).toBe(true);

      resolveLogin(null);
      await flush();
      expect(btn.textContent).toBe('Sign In');
      expect(btn.disabled).toBe(false);
    });

    it('closes by itself when the user logged in again in another tab', async () => {
      vi.mocked(api.hasValidSession).mockResolvedValue(true);
      const done = vi.fn();
      void session.showReauthDialog().then(done);

      globalThis.dispatchEvent(new Event('focus'));
      await flush();

      expect(api.hasValidSession).toHaveBeenCalled();
      expect(done).toHaveBeenCalled();
      expect(byId('reauth-modal').classList.contains('hidden')).toBe(true);
    });

    it('stays open on focus while the session is still invalid', async () => {
      vi.mocked(api.hasValidSession).mockResolvedValue(false);
      void session.showReauthDialog();

      globalThis.dispatchEvent(new Event('focus'));
      await flush();

      expect(byId('reauth-modal').classList.contains('hidden')).toBe(false);
      expect(api.fetchCurrentUser).not.toHaveBeenCalled();
    });
  });

  describe('proactive session check', () => {
    it('checks the session when the window gets focus, throttled to once per minute', async () => {
      globalThis.dispatchEvent(new Event('focus'));
      globalThis.dispatchEvent(new Event('focus'));
      await flush();
      expect(api.fetchCurrentUser).toHaveBeenCalledTimes(1);

      vi.setSystemTime(new Date('2026-10-08T12:01:01Z'));
      globalThis.dispatchEvent(new Event('focus'));
      await flush();
      expect(api.fetchCurrentUser).toHaveBeenCalledTimes(2);
    });

    it('checks the session when the tab becomes visible', async () => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      await flush();
      expect(api.fetchCurrentUser).toHaveBeenCalledTimes(1);
    });

    it('checks the session on the first interaction after a long idle period only', async () => {
      document.dispatchEvent(new Event('keydown'));
      await flush();
      expect(api.fetchCurrentUser).not.toHaveBeenCalled();

      vi.setSystemTime(new Date('2026-10-08T12:10:00Z'));
      document.dispatchEvent(new Event('pointerdown'));
      await flush();
      expect(api.fetchCurrentUser).toHaveBeenCalledTimes(1);
    });

    it('checks the session when the browser comes back online, ignoring the throttle', async () => {
      globalThis.dispatchEvent(new Event('focus'));
      globalThis.dispatchEvent(new Event('online'));
      await flush();
      expect(api.fetchCurrentUser).toHaveBeenCalledTimes(2);
    });
  });

  describe('connection banner', () => {
    it('shows the banner when offline and hides it when the connection is back', () => {
      const banner = byId('connection-banner');

      globalThis.dispatchEvent(new Event('offline'));
      expect(banner.classList.contains('hidden')).toBe(false);

      session.setConnectionState(true);
      expect(banner.classList.contains('hidden')).toBe(true);
    });
  });
});
