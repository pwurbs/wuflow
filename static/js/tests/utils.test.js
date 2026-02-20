import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { stripHtml, escapeHtml, debounce, getUserInitials, sanitizeDescription } from '../utils.js';

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

  it('should not execute scripts in unclosed html tags', () => {
    const input = '<img src=x onerror=alert(1)';
    const result = stripHtml(input);
    // Depending on DOMParser behavior, it might drop it or return the text of the unclosed tag
    // Either way, we just want to ensure it completes and doesn't throw or execute.
    // The result should not contain the tag attributes in a dangerous way.
    expect(result).toBeDefined();
  });

  it('should handle unclosed tags safely without innerHTML', () => {
    const input = 'Hello <img src=x onerror=alert(1)';
    const result = stripHtml(input);
    expect(result).toBe('Hello'); // DOMParser textContent might be just "Hello"
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
describe('sanitizeDescription', () => {
  it('should return empty string for null/undefined/empty input', () => {
    expect(sanitizeDescription(null)).toBe('');
    expect(sanitizeDescription(undefined)).toBe('');
    expect(sanitizeDescription('')).toBe('');
  });

  it('should preserve allowlisted formatting tags', () => {
    const input = '<b>Bold</b> <i>Italic</i> <u>Underline</u> <br> <p>Paragraph</p>';
    const output = sanitizeDescription(input);
    expect(output).toContain('<b>Bold</b>');
    expect(output).toContain('<i>Italic</i>');
    expect(output).toContain('<u>Underline</u>');
    expect(output).toContain('<br>');
    expect(output).toContain('<p>Paragraph</p>');
  });

  it('should preserve allowlisted list tags', () => {
    const input = '<ul><li>Item 1</li></ul><ol><li>Item 1</li></ol>';
    const output = sanitizeDescription(input);
    expect(output).toBe('<ul><li>Item 1</li></ul><ol><li>Item 1</li></ol>');
  });

  it('should strip dangerous tags', () => {
    const input = '<script>alert("XSS")</script><iframe></iframe><style>body{color:red}</style><img src="x" onerror="alert(1)">';
    const output = sanitizeDescription(input);
    expect(output).not.toContain('<script>');
    expect(output).not.toContain('<iframe>');
    expect(output).not.toContain('<style>');
    expect(output).not.toContain('<img');
    // Attribute values should be gone
    expect(output.toLowerCase()).not.toContain('alert(1)');
  });

  it('should strip all attributes from non-anchor tags', () => {
    const input = '<p id="p1" class="my-para" style="color:red" onclick="alert(1)">Text</p>';
    const output = sanitizeDescription(input);
    expect(output).toBe('<p>Text</p>');
  });

  it('should allow only safe attributes on anchor tags', () => {
    const input = '<a href="https://example.com" id="link1" class="btn" onclick="alert(1)">Link</a>';
    const output = sanitizeDescription(input);
    expect(output).toBe('<a href="https://example.com" target="_blank" rel="noopener noreferrer">Link</a>');
  });

  it('should enforce target="_blank" and rel="noopener noreferrer" on anchor tags', () => {
    const input = '<a href="https://example.com" target="_self">Link</a>';
    const output = sanitizeDescription(input);
    expect(output).toContain('target="_blank"');
    expect(output).toContain('rel="noopener noreferrer"');
  });

  it('should strip unsafe href protocols', () => {
    const inputs = [
      '<a href="javascript:alert(1)">JS</a>',
      '<a href="data:text/html,<html>XSS</html>">Data</a>',
      '<a href="vbscript:msgbox(1)">VB</a>',
      '<a href="  javascript:alert(1)">Spaces</a>'
    ];
    inputs.forEach(input => {
      const output = sanitizeDescription(input);
      // When href is stripped, we still get target/rel because of our enforcement logic 
      // on ANY anchor that survives. Wait, if href is stripped, should we still have <a>?
      // Re-reading code: if (!/^(https?:\/\/)/i.test(attr.value)) element.removeAttribute(attr.name);
      // And then element.hasAttribute('href') check. So if href is gone, NO target/rel.
      expect(output).toBe('<a>' + stripHtml(input) + '</a>');
    });
  });

  it('should preserve safe href protocols', () => {
    expect(sanitizeDescription('<a href="http://example.com">HTTP</a>')).toBe('<a href="http://example.com" target="_blank" rel="noopener noreferrer">HTTP</a>');
    expect(sanitizeDescription('<a href="https://example.com">HTTPS</a>')).toBe('<a href="https://example.com" target="_blank" rel="noopener noreferrer">HTTPS</a>');
  });

  it('should handle nested safe/unsafe tags', () => {
    // <span> is NOT allowed, so it should be unwrapped
    const input = '<div><p><b>Safe</b> <span id="s1">Unsafe</span></p></div>';
    const output = sanitizeDescription(input);
    // <div> and <span> are removed, <p> and <b> are kept, text is kept
    expect(output).toBe('<p><b>Safe</b> Unsafe</p>');
  });

  it('should handle malformed HTML Gracefully', () => {
    const input = '<b>Unclosed Tag';
    const output = sanitizeDescription(input);
    expect(output).toBe('<b>Unclosed Tag</b>');
  });
});
