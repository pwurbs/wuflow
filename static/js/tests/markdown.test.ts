import { describe, it, expect, vi, beforeEach } from 'vitest';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Mock the marked and DOMPurify packages so tests don't depend on the actual libraries
vi.mock('marked', () => ({
  marked: {
    use: vi.fn(),
    parse: vi.fn((md) => `<p>${md}</p>`),
  },
}));

vi.mock('dompurify', () => ({
  default: {
    sanitize: vi.fn((html, _config) => html),
    addHook: vi.fn(),
    removeHook: vi.fn(),
    removeAllHooks: vi.fn()
  },
}));

const { renderMarkdown, renderMarkdownWithReport } = await import('../markdown.ts');

// A captured DOMPurify hook as the tests call it: with only the event fields markdown.ts reads.
type TestHook = (node: Element, data: object) => void;

// Helpers: configure addHook to capture the callback, then make sanitize
// invoke it with controlled data — mirrors how real DOMPurify calls hooks.
function withElementHookTrigger(tagName: string, allowedTags: Record<string, boolean>) {
  let hook: TestHook | undefined;
  vi.mocked(DOMPurify.addHook).mockImplementation((event: string, fn) => {
    // vi.mocked types fn by the last addHook overload, whatever the event.
    if (event === 'uponSanitizeElement') hook = fn as TestHook;
  });
  vi.mocked(DOMPurify.sanitize).mockImplementation((html) => {
    hook?.(document.body,{ tagName, allowedTags });
    return String(html);
  });
}

function withAttrHookTrigger(attrName: string, allowedAttributes: Record<string, boolean>, attrValue = '') {
  let hook: TestHook | undefined;
  vi.mocked(DOMPurify.addHook).mockImplementation((event: string, fn) => {
    // vi.mocked types fn by the last addHook overload, whatever the event.
    if (event === 'uponSanitizeAttribute') hook = fn as TestHook;
  });
  vi.mocked(DOMPurify.sanitize).mockImplementation((html) => {
    hook?.(document.body,{ attrName, allowedAttributes, attrValue });
    return String(html);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(marked.parse).mockImplementation((md) => `<p>${md}</p>`);
  vi.mocked(DOMPurify.sanitize).mockImplementation((html) => String(html));
  vi.mocked(DOMPurify.addHook).mockImplementation(() => {});
});

describe('renderMarkdown', () => {
  describe('falsy input', () => {
    it('returns empty string for empty string', () => {
      expect(renderMarkdown('')).toBe('');
    });

    it('returns { html: "", strippedHTML: false } for falsy input with a report', () => {
      expect(renderMarkdownWithReport('')).toEqual({ html: '', strippedHTML: false });
    });
  });

  describe('return shape', () => {
    it('renderMarkdown returns a plain string', () => {
      expect(renderMarkdown('hello')).toBe('<p>hello</p>');
    });

    it('renderMarkdownWithReport returns { html, strippedHTML: false } when no dangerous content', () => {
      const result = renderMarkdownWithReport('hello');
      expect(result).toEqual({ html: '<p>hello</p>', strippedHTML: false });
    });

    it('parses synchronously, so the result is never a Promise', () => {
      renderMarkdown('hello');
      expect(marked.parse).toHaveBeenCalledWith('hello', { async: false });
    });
  });

  describe('strippedHTML detection', () => {
    it('stays false when only allowed elements are processed', () => {
      withElementHookTrigger('p', { p: true });
      expect(renderMarkdownWithReport('hello').strippedHTML).toBe(false);
    });

    it('ignores body, #text, and #comment in element hook', () => {
      let hook: TestHook | undefined;
      vi.mocked(DOMPurify.addHook).mockImplementation((event: string, fn) => {
        // vi.mocked types fn by the last addHook overload, whatever the event.
        if (event === 'uponSanitizeElement') hook = fn as TestHook;
      });
      vi.mocked(DOMPurify.sanitize).mockImplementation((html) => {
        hook?.(document.body,{ tagName: 'body', allowedTags: {} });
        hook?.(document.body,{ tagName: '#text', allowedTags: {} });
        hook?.(document.body,{ tagName: '#comment', allowedTags: {} });
        return String(html);
      });
      expect(renderMarkdownWithReport('hello').strippedHTML).toBe(false);
    });

    it('sets strippedHTML: true when a disallowed tag is stripped', () => {
      withElementHookTrigger('script', { p: true });
      expect(renderMarkdownWithReport('<script>evil()</script>').strippedHTML).toBe(true);
    });

    it('sets strippedHTML: true when a disallowed attribute is stripped', () => {
      withAttrHookTrigger('onclick', { href: true });
      expect(renderMarkdownWithReport('<a onclick="evil()">x</a>').strippedHTML).toBe(true);
    });

    it('sets strippedHTML: true for a javascript: href', () => {
      withAttrHookTrigger('href', { href: true }, 'javascript:alert(1)');
      expect(renderMarkdownWithReport('[x](javascript:alert(1))').strippedHTML).toBe(true);
    });

    it('detects javascript: href with leading whitespace', () => {
      withAttrHookTrigger('href', { href: true }, '  javascript:alert(1)');
      expect(renderMarkdownWithReport('[x](  javascript:alert(1))').strippedHTML).toBe(true);
    });

    it('stays false for the start attribute on ol (regression: "1. - 2. April" nested list)', () => {
      // marked renders "1. - 2. April" as <ol><li><ul><li><ol start="2">...</ol></li></ul></li></ol>.
      // The start="2" attribute must not trigger the strippedHTML warning.
      withAttrHookTrigger('start', { start: true });
      expect(renderMarkdownWithReport('1. - 2. April').strippedHTML).toBe(false);
    });
  });
});

