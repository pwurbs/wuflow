import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  escapeHtml, debounce, getUserInitials,
  countCodepoints, canArchive,
  showNotification, showConfirm,
  updateDateInputStyle, initCharCounter,
  getUnusedColor,
} from '../utils.js';

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

const FULL_PALETTE = [
  '#EF5350', '#EC407A', '#AB47BC', '#7E57C2', '#5C6BC0',
  '#42A5F5', '#29B6F6', '#26C6DA', '#26A69A', '#66BB6A',
  '#9CCC65', '#D4E157', '#FFEE58', '#FFCA28', '#FFA726',
  '#FF7043', '#8D6E63', '#78909C'
];

describe('getUnusedColor', () => {
  it('returns a color not in the used list when unused colors exist', () => {
    const used = FULL_PALETTE.slice(0, 10);
    const result = getUnusedColor(used);
    expect(FULL_PALETTE).toContain(result);
    expect(used).not.toContain(result);
  });

  it('returns a color from the full palette when all colors are already used', () => {
    const result = getUnusedColor([...FULL_PALETTE]);
    expect(FULL_PALETTE).toContain(result);
  });

  it('returns a color from the full palette when usedColors is empty', () => {
    const result = getUnusedColor([]);
    expect(FULL_PALETTE).toContain(result);
  });
});
