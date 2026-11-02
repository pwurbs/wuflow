import { describe, it, expect } from 'vitest';
import { bySelector } from '../utils.ts';

// Unlike markdown.test.ts, this file runs the real marked + DOMPurify (in jsdom),
// so it asserts what actually reaches the DOM.
const { renderMarkdownWithReport } = await import('../markdown.ts');

function render(md: string) {
  const { html, strippedHTML } = renderMarkdownWithReport(md);
  const root = document.createElement('div');
  root.innerHTML = html;
  return { root, strippedHTML };
}

describe('renderMarkdownWithReport class attribute (real marked + DOMPurify)', () => {
  it('keeps the language-… class on a fenced code block', () => {
    const { root, strippedHTML } = render('```js\nconst x = 1;\n```');
    expect(bySelector(root, 'pre > code').className).toBe('language-js');
    expect(strippedHTML).toBe(false);
  });

  it('keeps language classes with non-word characters (c++, c#)', () => {
    expect(bySelector(render('```c++\nx\n```').root, 'code').className).toBe('language-c++');
    expect(bySelector(render('```c#\nx\n```').root, 'code').className).toBe('language-c#');
  });

  it('leaves code blocks without a language and inline code unflagged', () => {
    const plain = render('```\nx\n```');
    expect(bySelector(plain.root, 'code').hasAttribute('class')).toBe(false);
    expect(plain.strippedHTML).toBe(false);
    expect(render('`inline`').strippedHTML).toBe(false);
  });

  it('strips an app CSS class on other elements and flags it', () => {
    const { root, strippedHTML } = render('<p class="modal-overlay">fake dialog</p>');
    const p = bySelector(root, 'p');
    expect(p.textContent).toBe('fake dialog');
    expect(p.hasAttribute('class')).toBe(false);
    expect(strippedHTML).toBe(true);
  });

  it('strips a language class on an element other than code', () => {
    const { root, strippedHTML } = render('<pre class="language-js">x</pre>');
    expect(bySelector(root, 'pre').hasAttribute('class')).toBe(false);
    expect(strippedHTML).toBe(true);
  });

  it('strips a code class that adds a second class or lacks the language- prefix', () => {
    for (const cls of ['language-js modal-overlay', 'modal-overlay', 'LANGUAGE-js']) {
      const { root, strippedHTML } = render(`<code class="${cls}">x</code>`);
      expect(bySelector(root, 'code').hasAttribute('class')).toBe(false);
      expect(strippedHTML).toBe(true);
    }
  });
});
