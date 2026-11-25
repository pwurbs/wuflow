import { describe, it, expect, beforeEach } from 'vitest';
import { mountPage } from './page-markup.ts';
import { byId } from '../utils.ts';

describe('mountPage', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="earlier-content"></div>';
  });

  it('replaces the body with the selected elements of index.html, in the given order', () => {
    mountPage('#user-modal-overlay', '.left-menu');
    expect([...document.body.children].map(el => el.id || el.className)).toEqual(['user-modal-overlay', 'left-menu']);
    expect(byId('user-email', HTMLInputElement).required).toBe(true);
  });

  it('throws with the selector when nothing matches', () => {
    expect(() => mountPage('#user-modal-overlay', '#no-such-element')).toThrow('0 elements match #no-such-element');
  });

  it('throws with the selector when several elements match', () => {
    expect(() => mountPage('.settings-modal')).toThrow(/elements match \.settings-modal, expected 1/);
  });

  it('gives every call fresh markup', () => {
    mountPage('#user-modal-overlay');
    const first = byId('user-modal-overlay');
    first.classList.remove('hidden');
    byId('user-email').remove();

    mountPage('#user-modal-overlay');
    expect(byId('user-modal-overlay')).not.toBe(first);
    expect(byId('user-modal-overlay').classList.contains('hidden')).toBe(true);
    expect(byId('user-email', HTMLInputElement).isConnected).toBe(true);
  });
});
