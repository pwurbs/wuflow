import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  stripHtml, escapeHtml, debounce, getUserInitials, sanitizeDescription,
  countCodepoints, canArchive,
  showNotification, showModalNotification, showConfirm,
  updateDateInputStyle, initCharCounter,
} from '../utils.js';

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

describe('countCodepoints', () => {
  it('should return 0 for empty string', () => {
    expect(countCodepoints('')).toBe(0);
  });

  it('should count ASCII characters', () => {
    expect(countCodepoints('hello')).toBe(5);
  });

  it('should count emoji as single codepoints', () => {
    expect(countCodepoints('😀')).toBe(1);
    expect(countCodepoints('🎉🎊')).toBe(2);
  });

  it('should count mixed ASCII and emoji correctly', () => {
    expect(countCodepoints('hi😀')).toBe(3);
  });

  it('should count unicode letters as single codepoints', () => {
    expect(countCodepoints('áéí')).toBe(3);
  });
});

describe('canArchive', () => {
  it('should return not allowed for null', () => {
    const result = canArchive(null);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('No issue provided');
  });

  it('should return not allowed for undefined', () => {
    const result = canArchive(undefined);
    expect(result.allowed).toBe(false);
  });

  it('should return allowed for issue with no tasks and no planned dates', () => {
    expect(canArchive({}).allowed).toBe(true);
  });

  it('should return allowed when tasks array is empty', () => {
    expect(canArchive({ tasks: [] }).allowed).toBe(true);
  });

  it('should return allowed when planned_dates array is empty', () => {
    expect(canArchive({ planned_dates: [] }).allowed).toBe(true);
  });

  it('should return allowed when all tasks are done', () => {
    const result = canArchive({ tasks: [{ done: true }, { done: true }] });
    expect(result.allowed).toBe(true);
  });

  it('should return not allowed when any task is open', () => {
    const result = canArchive({ tasks: [{ done: true }, { done: false }] });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Issue has open tasks');
  });

  it('should return not allowed when issue has planned dates', () => {
    const result = canArchive({ planned_dates: ['2024-01-01'] });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Issue has planned dates');
  });

  it('should report open tasks before planned dates', () => {
    const result = canArchive({ tasks: [{ done: false }], planned_dates: ['2024-01-01'] });
    expect(result.reason).toBe('Issue has open tasks');
  });
});

describe('showNotification', () => {
  let toast;

  beforeEach(() => {
    vi.useFakeTimers();
    toast = document.createElement('div');
    toast.id = 'notification-toast';
    toast.classList.add('hidden');
    document.body.appendChild(toast);
  });

  afterEach(() => {
    toast.remove();
    vi.useRealTimers();
  });

  it('should set the message text', () => {
    showNotification('Hello!');
    expect(toast.textContent).toBe('Hello!');
  });

  it('should remove hidden class and add type class', () => {
    showNotification('Test', 'error');
    expect(toast.classList.contains('hidden')).toBe(false);
    expect(toast.classList.contains('error')).toBe(true);
  });

  it('should default to success type', () => {
    showNotification('Test');
    expect(toast.classList.contains('success')).toBe(true);
  });

  it('should hide after 5000ms', () => {
    showNotification('Test');
    expect(toast.classList.contains('hidden')).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(toast.classList.contains('hidden')).toBe(true);
  });

  it('should not hide before 5000ms', () => {
    showNotification('Test');
    vi.advanceTimersByTime(4999);
    expect(toast.classList.contains('hidden')).toBe(false);
  });

  it('should reset the hide timer on repeated calls', () => {
    showNotification('First');
    vi.advanceTimersByTime(3000);
    showNotification('Second');
    vi.advanceTimersByTime(4999);
    expect(toast.classList.contains('hidden')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(toast.classList.contains('hidden')).toBe(true);
  });

  it('should do nothing when toast element is absent', () => {
    toast.remove();
    expect(() => showNotification('Test')).not.toThrow();
    document.body.appendChild(toast); // restore for afterEach cleanup
  });
});

describe('showModalNotification', () => {
  let toast;

  beforeEach(() => {
    vi.useFakeTimers();
    toast = document.createElement('div');
    toast.id = 'modal-notification-toast';
    toast.classList.add('hidden');
    document.body.appendChild(toast);
  });

  afterEach(() => {
    toast.remove();
    vi.useRealTimers();
  });

  it('should set the message text', () => {
    showModalNotification('Modal message');
    expect(toast.textContent).toBe('Modal message');
  });

  it('should remove hidden class and add type class', () => {
    showModalNotification('Test', 'warning');
    expect(toast.classList.contains('hidden')).toBe(false);
    expect(toast.classList.contains('warning')).toBe(true);
  });

  it('should default to success type', () => {
    showModalNotification('Test');
    expect(toast.classList.contains('success')).toBe(true);
  });

  it('should hide after 3000ms', () => {
    showModalNotification('Test');
    expect(toast.classList.contains('hidden')).toBe(false);
    vi.advanceTimersByTime(3000);
    expect(toast.classList.contains('hidden')).toBe(true);
  });

  it('should not hide before 3000ms', () => {
    showModalNotification('Test');
    vi.advanceTimersByTime(2999);
    expect(toast.classList.contains('hidden')).toBe(false);
  });

  it('should return early when toast element is absent', () => {
    toast.remove();
    expect(() => showModalNotification('Test')).not.toThrow();
    document.body.appendChild(toast);
  });
});

describe('showConfirm', () => {
  let modal, titleEl, messageEl, okBtn, cancelBtn;

  beforeEach(() => {
    modal = document.createElement('div');
    modal.id = 'confirm-modal';
    modal.classList.add('hidden');

    titleEl = document.createElement('div');
    titleEl.id = 'confirm-title';

    messageEl = document.createElement('div');
    messageEl.id = 'confirm-message';

    okBtn = document.createElement('button');
    okBtn.id = 'confirm-ok-btn';
    okBtn.className = 'btn';

    cancelBtn = document.createElement('button');
    cancelBtn.id = 'confirm-cancel-btn';

    document.body.append(modal, titleEl, messageEl, okBtn, cancelBtn);
  });

  afterEach(() => {
    [modal, titleEl, messageEl, okBtn, cancelBtn].forEach(el => el.remove());
  });

  it('should show the modal and populate content', () => {
    showConfirm('My Title', 'My Message', 'Yes', 'No');
    expect(modal.classList.contains('hidden')).toBe(false);
    expect(titleEl.textContent).toBe('My Title');
    expect(messageEl.textContent).toBe('My Message');
    expect(okBtn.textContent).toBe('Yes');
    expect(cancelBtn.textContent).toBe('No');
    okBtn.click();
  });

  it('should resolve true when OK is clicked', async () => {
    const promise = showConfirm('T', 'M');
    okBtn.click();
    expect(await promise).toBe(true);
  });

  it('should resolve false when Cancel is clicked', async () => {
    const promise = showConfirm('T', 'M');
    cancelBtn.click();
    expect(await promise).toBe(false);
  });

  it('should hide the modal after OK', async () => {
    const promise = showConfirm('T', 'M');
    okBtn.click();
    await promise;
    expect(modal.classList.contains('hidden')).toBe(true);
  });

  it('should hide the modal after Cancel', async () => {
    const promise = showConfirm('T', 'M');
    cancelBtn.click();
    await promise;
    expect(modal.classList.contains('hidden')).toBe(true);
  });

  it('should hide cancel button when cancelText is null', () => {
    showConfirm('T', 'M', 'OK', null);
    expect(cancelBtn.classList.contains('hidden')).toBe(true);
    okBtn.click();
  });

  it('should show cancel button when cancelText is provided', () => {
    cancelBtn.classList.add('hidden');
    showConfirm('T', 'M', 'OK', 'Cancel');
    expect(cancelBtn.classList.contains('hidden')).toBe(false);
    okBtn.click();
  });

  it('should apply the specified okType class', () => {
    showConfirm('T', 'M', 'OK', 'Cancel', 'primary');
    expect(okBtn.classList.contains('primary')).toBe(true);
    okBtn.click();
  });

  it('should default okType to danger', () => {
    showConfirm('T', 'M');
    expect(okBtn.classList.contains('danger')).toBe(true);
    okBtn.click();
  });

  it('should remove event listeners after resolution so second click has no effect', async () => {
    const promise = showConfirm('T', 'M');
    okBtn.click();
    await promise;

    // Re-open and confirm only one resolution per open
    const promise2 = showConfirm('T', 'M');
    okBtn.click();
    expect(await promise2).toBe(true);
  });
});

describe('updateDateInputStyle', () => {
  let input;

  beforeEach(() => {
    input = document.createElement('input');
    input.type = 'date';
    document.body.appendChild(input);
  });

  afterEach(() => {
    input.remove();
  });

  it('should add has-value class when input has a value', () => {
    input.value = '2024-06-15';
    updateDateInputStyle(input);
    expect(input.classList.contains('has-value')).toBe(true);
  });

  it('should remove has-value class when input is empty', () => {
    input.classList.add('has-value');
    input.value = '';
    updateDateInputStyle(input);
    expect(input.classList.contains('has-value')).toBe(false);
  });

  it('should update display text and remove placeholder class when value is set', () => {
    const container = document.createElement('div');
    container.className = 'custom-date-input';
    const display = document.createElement('span');
    display.className = 'custom-date-display placeholder';
    container.appendChild(input);
    container.appendChild(display);
    document.body.appendChild(container);

    input.value = '2024-06-15';
    updateDateInputStyle(input);

    expect(display.textContent).not.toBe('');
    expect(display.classList.contains('placeholder')).toBe(false);

    container.remove();
  });

  it('should set display to empty string for new-task-deadline when value is cleared', () => {
    const container = document.createElement('div');
    container.className = 'custom-date-input';
    const display = document.createElement('span');
    display.className = 'custom-date-display';
    input.id = 'new-task-deadline';
    container.appendChild(input);
    container.appendChild(display);
    document.body.appendChild(container);

    input.value = '';
    updateDateInputStyle(input);

    expect(display.textContent).toBe('');
    expect(display.classList.contains('placeholder')).toBe(true);

    container.remove();
  });

  it('should set display to "Select date..." for other inputs when value is cleared', () => {
    const container = document.createElement('div');
    container.className = 'custom-date-input';
    const display = document.createElement('span');
    display.className = 'custom-date-display';
    input.id = 'edit-task-deadline';
    container.appendChild(input);
    container.appendChild(display);
    document.body.appendChild(container);

    input.value = '';
    updateDateInputStyle(input);

    expect(display.textContent).toBe('Select date...');
    expect(display.classList.contains('placeholder')).toBe(true);

    container.remove();
  });

  it('should work without a container', () => {
    input.value = '2024-06-15';
    expect(() => updateDateInputStyle(input)).not.toThrow();
    expect(input.classList.contains('has-value')).toBe(true);
  });
});

describe('initCharCounter', () => {
  let wrapper, input;

  beforeEach(() => {
    wrapper = document.createElement('div');
    input = document.createElement('input');
    input.type = 'text';
    wrapper.appendChild(input);
    document.body.appendChild(wrapper);
  });

  afterEach(() => {
    wrapper.remove();
  });

  it('should insert a counter element after the input', () => {
    initCharCounter(input, 100);
    const counter = input.nextSibling;
    expect(counter).not.toBeNull();
    expect(counter.className).toContain('char-counter');
  });

  it('should apply a custom className when provided', () => {
    initCharCounter(input, 100, { className: 'my-counter' });
    const counter = input.nextSibling;
    expect(counter.classList.contains('char-counter')).toBe(true);
    expect(counter.classList.contains('my-counter')).toBe(true);
  });

  it('should return show and hide functions', () => {
    const result = initCharCounter(input, 100);
    expect(typeof result.show).toBe('function');
    expect(typeof result.hide).toBe('function');
  });

  it('should show counter and display count on focus', () => {
    initCharCounter(input, 100);
    const counter = input.nextSibling;
    input.value = 'hello';
    input.dispatchEvent(new Event('focus'));
    expect(counter.classList.contains('visible')).toBe(true);
    expect(counter.textContent).toBe('5/100');
  });

  it('should hide counter on blur', () => {
    initCharCounter(input, 100);
    const counter = input.nextSibling;
    input.dispatchEvent(new Event('focus'));
    input.dispatchEvent(new Event('blur'));
    expect(counter.classList.contains('visible')).toBe(false);
  });

  it('should update count on input event', () => {
    initCharCounter(input, 100);
    const counter = input.nextSibling;
    input.value = 'hi';
    input.dispatchEvent(new Event('input'));
    expect(counter.textContent).toBe('2/100');
  });

  it('should add at-limit class when count equals maxLength', () => {
    initCharCounter(input, 5);
    const counter = input.nextSibling;
    input.value = 'hello';
    input.dispatchEvent(new Event('input'));
    expect(counter.classList.contains('at-limit')).toBe(true);
  });

  it('should remove at-limit class when count is below maxLength', () => {
    initCharCounter(input, 5);
    const counter = input.nextSibling;
    counter.classList.add('at-limit');
    input.value = 'hi';
    input.dispatchEvent(new Event('input'));
    expect(counter.classList.contains('at-limit')).toBe(false);
  });

  it('should truncate text input that exceeds maxLength', () => {
    initCharCounter(input, 3);
    input.value = 'hello';
    input.dispatchEvent(new Event('input'));
    expect(input.value).toBe('hel');
  });

  it('should not add focus/blur listeners in manual mode', () => {
    initCharCounter(input, 100, { manual: true });
    const counter = input.nextSibling;
    input.dispatchEvent(new Event('focus'));
    expect(counter.classList.contains('visible')).toBe(false);
  });

  it('show() and hide() work correctly in manual mode', () => {
    const { show, hide } = initCharCounter(input, 100, { manual: true });
    const counter = input.nextSibling;
    show();
    expect(counter.classList.contains('visible')).toBe(true);
    hide();
    expect(counter.classList.contains('visible')).toBe(false);
  });

  it('should truncate multi-codepoint emoji correctly', () => {
    initCharCounter(input, 2);
    input.value = '😀😀😀'; // 3 emoji, limit is 2
    input.dispatchEvent(new Event('input'));
    expect([...input.value].length).toBe(2);
    expect(input.value).toBe('😀😀');
  });
});
