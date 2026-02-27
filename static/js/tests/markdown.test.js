import { describe, it, expect, vi } from 'vitest';

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

describe('renderMarkdown', () => {
  it('returns empty string for null', () => {
    expect(renderMarkdown(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(renderMarkdown(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(renderMarkdown('')).toBe('');
  });

  it('renders non-empty Markdown to HTML', () => {
    const result = renderMarkdown('hello');
    expect(result).toBeTruthy();
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
    // marked.parse mocked to return <p>hello</p>; textContent → 'hello'
    const result = stripMarkdown('hello');
    expect(result).toBe('hello');
  });
});
