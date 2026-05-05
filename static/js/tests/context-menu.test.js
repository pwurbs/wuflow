import { describe, it, expect, vi, beforeEach } from 'vitest';

let showCardContextMenu, hideCardContextMenu;

beforeEach(async () => {
  document.body.innerHTML = '';
  vi.resetModules();
  ({ showCardContextMenu, hideCardContextMenu } = await import('../context-menu.js'));
});

describe('context-menu', () => {
  it('creates menu element on first show', () => {
    showCardContextMenu(100, 100, [{ label: 'Test', action: vi.fn() }]);
    expect(document.querySelector('.card-context-menu')).not.toBeNull();
  });

  it('renders item buttons', () => {
    showCardContextMenu(0, 0, [
      { label: 'Move to top',    action: vi.fn() },
      { label: 'Move to bottom', action: vi.fn() }
    ]);
    const items = document.querySelectorAll('.card-context-menu-item');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toBe('Move to top');
    expect(items[1].textContent).toBe('Move to bottom');
  });

  it('calls action and hides menu when item clicked', () => {
    const action = vi.fn();
    showCardContextMenu(0, 0, [{ label: 'Move to top', action }]);
    document.querySelector('.card-context-menu-item').click();
    expect(action).toHaveBeenCalled();
    expect(document.querySelector('.card-context-menu').classList.contains('hidden')).toBe(true);
  });

  it('does not call action for disabled item', () => {
    const action = vi.fn();
    showCardContextMenu(0, 0, [{ label: 'Disabled', disabled: true, action }]);
    const item = document.querySelector('.card-context-menu-item');
    expect(item.disabled).toBe(true);
    item.click();
    expect(action).not.toHaveBeenCalled();
  });

  it('hides on Escape key', () => {
    showCardContextMenu(0, 0, [{ label: 'X', action: vi.fn() }]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.card-context-menu').classList.contains('hidden')).toBe(true);
  });

  it('hides on click outside', () => {
    showCardContextMenu(0, 0, [{ label: 'X', action: vi.fn() }]);
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.card-context-menu').classList.contains('hidden')).toBe(true);
  });

  it('hideCardContextMenu is safe when no menu exists', () => {
    expect(() => hideCardContextMenu()).not.toThrow();
  });
});
