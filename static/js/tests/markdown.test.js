import { describe, it, expect, vi, beforeEach } from 'vitest';
import { marked } from '../vendor/marked.esm.js';
import DOMPurify from '../vendor/dompurify.esm.js';

// Mock the vendor ESM modules so tests don't depend on the actual libraries
vi.mock('../vendor/marked.esm.js', () => ({
  marked: {
    use: vi.fn(),
    parse: vi.fn((md) => `<p>${md}</p>`),
  },
}));

vi.mock('../vendor/dompurify.esm.js', () => ({
  default: {
    sanitize: vi.fn((html, _config) => html),
    addHook: vi.fn(),
    removeHook: vi.fn(),
    removeAllHooks: vi.fn()
  },
}));

const { renderMarkdown, stripMarkdown } = await import('../markdown.js');

// Helpers: configure addHook to capture the callback, then make sanitize
// invoke it with controlled data — mirrors how real DOMPurify calls hooks.
function withElementHookTrigger(tagName, allowedTags) {
  let hook;
  DOMPurify.addHook.mockImplementation((event, fn) => {
    if (event === 'uponSanitizeElement') hook = fn;
  });
  DOMPurify.sanitize.mockImplementation((html) => {
    hook?.(null, { tagName, allowedTags });
    return html;
  });
}

function withAttrHookTrigger(attrName, allowedAttributes, attrValue = '') {
  let hook;
  DOMPurify.addHook.mockImplementation((event, fn) => {
    if (event === 'uponSanitizeAttribute') hook = fn;
  });
  DOMPurify.sanitize.mockImplementation((html) => {
    hook?.(null, { attrName, allowedAttributes, attrValue });
    return html;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  marked.parse.mockImplementation((md) => `<p>${md}</p>`);
  DOMPurify.sanitize.mockImplementation((html) => html);
  DOMPurify.addHook.mockImplementation(() => {});
});

describe('renderMarkdown', () => {
  describe('falsy input', () => {
    it('returns empty string for null', () => {
      expect(renderMarkdown(null)).toBe('');
    });

    it('returns empty string for undefined', () => {
      expect(renderMarkdown(undefined)).toBe('');
    });

    it('returns empty string for empty string', () => {
      expect(renderMarkdown('')).toBe('');
    });

    it('returns { html: "", strippedHTML: false } for falsy input with returnObject', () => {
      expect(renderMarkdown(null, true)).toEqual({ html: '', strippedHTML: false });
      expect(renderMarkdown('', true)).toEqual({ html: '', strippedHTML: false });
    });
  });

  describe('returnObject mode', () => {
    it('returns a plain string by default', () => {
      expect(renderMarkdown('hello')).toBe('<p>hello</p>');
    });

    it('returns { html, strippedHTML: false } when no dangerous content', () => {
      const result = renderMarkdown('hello', true);
      expect(result).toEqual({ html: '<p>hello</p>', strippedHTML: false });
    });
  });

  describe('strippedHTML detection', () => {
    it('stays false when only allowed elements are processed', () => {
      withElementHookTrigger('p', { p: true });
      expect(renderMarkdown('hello', true).strippedHTML).toBe(false);
    });

    it('ignores body, #text, and #comment in element hook', () => {
      let hook;
      DOMPurify.addHook.mockImplementation((event, fn) => {
        if (event === 'uponSanitizeElement') hook = fn;
      });
      DOMPurify.sanitize.mockImplementation((html) => {
        hook?.(null, { tagName: 'body', allowedTags: {} });
        hook?.(null, { tagName: '#text', allowedTags: {} });
        hook?.(null, { tagName: '#comment', allowedTags: {} });
        return html;
      });
      expect(renderMarkdown('hello', true).strippedHTML).toBe(false);
    });

    it('sets strippedHTML: true when a disallowed tag is stripped', () => {
      withElementHookTrigger('script', { p: true });
      expect(renderMarkdown('<script>evil()</script>', true).strippedHTML).toBe(true);
    });

    it('sets strippedHTML: true when a disallowed attribute is stripped', () => {
      withAttrHookTrigger('onclick', { href: true });
      expect(renderMarkdown('<a onclick="evil()">x</a>', true).strippedHTML).toBe(true);
    });

    it('sets strippedHTML: true for a javascript: href', () => {
      withAttrHookTrigger('href', { href: true }, 'javascript:alert(1)');
      expect(renderMarkdown('[x](javascript:alert(1))', true).strippedHTML).toBe(true);
    });

    it('detects javascript: href with leading whitespace', () => {
      withAttrHookTrigger('href', { href: true }, '  javascript:alert(1)');
      expect(renderMarkdown('[x](  javascript:alert(1))', true).strippedHTML).toBe(true);
    });

    it('stays false for the start attribute on ol (regression: "1. - 2. April" nested list)', () => {
      // marked renders "1. - 2. April" as <ol><li><ul><li><ol start="2">...</ol></li></ul></li></ol>.
      // The start="2" attribute must not trigger the strippedHTML warning.
      withAttrHookTrigger('start', { start: true });
      expect(renderMarkdown('1. - 2. April', true).strippedHTML).toBe(false);
    });
  });
});

describe('stripMarkdown', () => {
  it('returns empty string for null', () => {
    expect(stripMarkdown(null)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(stripMarkdown('')).toBe('');
  });

  it('returns plain text from rendered Markdown', () => {
    // marked.parse mock returns <p>hello</p>; textContent → 'hello'
    expect(stripMarkdown('hello')).toBe('hello');
  });

  it('collapses multiple whitespace into a single space', () => {
    // marked.parse wraps in <p>...</p>; multiple spaces in textContent get collapsed
    expect(stripMarkdown('foo   bar')).toBe('foo bar');
  });
});
