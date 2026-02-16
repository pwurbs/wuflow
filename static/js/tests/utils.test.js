import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { stripHtml, escapeHtml, debounce, getUserInitials } from '../utils.js';

describe('stripHtml', () => {
  it('should return empty string for null input', () => {
    expect(stripHtml(null)).toBe('');
  });

  it('should return empty string for undefined input', () => {
    expect(stripHtml(undefined)).toBe('');
  });

  it('should return empty string for empty input', () => {
    expect(stripHtml('')).toBe('');
  });

  it('should strip simple HTML tags', () => {
    expect(stripHtml('<p>Hello</p>')).toBe('Hello');
  });

  it('should strip nested HTML tags', () => {
    expect(stripHtml('<div><span>Hello</span></div>')).toBe('Hello');
  });

  it('should add space around block elements', () => {
    expect(stripHtml('<p>First</p><p>Second</p>')).toBe('First Second');
  });

  it('should handle br tags', () => {
    expect(stripHtml('Line 1<br>Line 2')).toBe('Line 1 Line 2');
  });

  it('should handle list elements', () => {
    expect(stripHtml('<ul><li>Item 1</li><li>Item 2</li></ul>')).toBe('Item 1 Item 2');
  });

  it('should collapse multiple spaces', () => {
    expect(stripHtml('<p>Hello</p>   <p>World</p>')).toBe('Hello World');
  });

  it('should trim whitespace', () => {
    expect(stripHtml('  <p>Hello</p>  ')).toBe('Hello');
  });
});

describe('escapeHtml', () => {
  it('should return empty string for null input', () => {
    expect(escapeHtml(null)).toBe('');
  });

  it('should return empty string for undefined input', () => {
    expect(escapeHtml(undefined)).toBe('');
  });

  it('should return empty string for empty input', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('should escape ampersand', () => {
    expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
  });

  it('should escape less than', () => {
    expect(escapeHtml('1 < 2')).toBe('1 &lt; 2');
  });

  it('should escape greater than', () => {
    expect(escapeHtml('2 > 1')).toBe('2 &gt; 1');
  });

  it('should escape double quotes', () => {
    expect(escapeHtml('Say "Hello"')).toBe('Say &quot;Hello&quot;');
  });

  it('should escape single quotes', () => {
    expect(escapeHtml("It's fine")).toBe('It&#039;s fine');
  });

  it('should escape all special characters together', () => {
    expect(escapeHtml('<script>alert("XSS")</script>'))
      .toBe('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
  });

  it('should handle text without special characters', () => {
    expect(escapeHtml('Hello World')).toBe('Hello World');
  });
});

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should delay function execution', () => {
    const func = vi.fn();
    const debounced = debounce(func, 100);

    debounced();
    expect(func).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(func).toHaveBeenCalledTimes(1);
  });

  it('should only call function once for rapid calls', () => {
    const func = vi.fn();
    const debounced = debounce(func, 100);

    debounced();
    debounced();
    debounced();

    vi.advanceTimersByTime(100);
    expect(func).toHaveBeenCalledTimes(1);
  });

  it('should pass arguments to the debounced function', () => {
    const func = vi.fn();
    const debounced = debounce(func, 100);

    debounced('arg1', 'arg2');
    vi.advanceTimersByTime(100);

    expect(func).toHaveBeenCalledWith('arg1', 'arg2');
  });

  it('should reset timer on subsequent calls', () => {
    const func = vi.fn();
    const debounced = debounce(func, 100);

    debounced();
    vi.advanceTimersByTime(50);
    debounced(); // Reset timer
    vi.advanceTimersByTime(50);
    expect(func).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(func).toHaveBeenCalledTimes(1);
  });

  it('should use latest arguments when timer resets', () => {
    const func = vi.fn();
    const debounced = debounce(func, 100);

    debounced('first');
    debounced('second');
    vi.advanceTimersByTime(100);

    expect(func).toHaveBeenCalledWith('second');
  });
});

describe('getUserInitials', () => {
  it('should return initials from first and last name', () => {
    const user = { first_name: 'John', last_name: 'Doe' };
    expect(getUserInitials(user)).toBe('JD');
  });

  it('should return initials from email if name is missing', () => {
    const user = { email: 'john.doe@example.com' };
    expect(getUserInitials(user)).toBe('JO');
  });

  it('should return ?? if user is null or undefined', () => {
    expect(getUserInitials(null)).toBe('??');
    expect(getUserInitials(undefined)).toBe('??');
  });

  it('should return ?? if both name and email are missing', () => {
    expect(getUserInitials({})).toBe('??');
  });

  it('should handle single name part (only first name)', () => {
    // Implementation detail: current logic requires both first and last name for initials, 
    // otherwise falls back to email. If email missing -> ??
    // But wait, let's check implementation behavior:
    // if (user.first_name && user.last_name) ...
    const user = { first_name: 'John' };
    expect(getUserInitials(user)).toBe('??');
  });
});
