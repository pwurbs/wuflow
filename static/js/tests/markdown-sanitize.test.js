import { describe, it, expect } from 'vitest';

// Unlike markdown.test.js, this file runs the real marked + DOMPurify (in jsdom),
// so it asserts what actually reaches the DOM.
const { renderMarkdown } = await import('../markdown.js');

function render(md) {
  const { html, strippedHTML } = renderMarkdown(md, true);
  const root = document.createElement('div');
  root.innerHTML = html;
  return { root, strippedHTML };
}

describe('renderMarkdown class attribute (real marked + DOMPurify)', () => {
  it('keeps the language-… class on a fenced code block', () => {
    const { root, strippedHTML } = render('```js\nconst x = 1;\n```');
    expect(root.querySelector('pre > code').className).toBe('language-js');
    expect(strippedHTML).toBe(false);
  });

  it('keeps language classes with non-word characters (c++, c#)', () => {
    expect(render('```c++\nx\n```').root.querySelector('code').className).toBe('language-c++');
    expect(render('```c#\nx\n```').root.querySelector('code').className).toBe('language-c#');
  });

  it('leaves code blocks without a language and inline code unflagged', () => {
    const plain = render('```\nx\n```');
    expect(plain.root.querySelector('code').hasAttribute('class')).toBe(false);
    expect(plain.strippedHTML).toBe(false);
    expect(render('`inline`').strippedHTML).toBe(false);
  });

  it('strips an app CSS class on other elements and flags it', () => {
    const { root, strippedHTML } = render('<p class="modal-overlay">fake dialog</p>');
    const p = root.querySelector('p');
    expect(p.textContent).toBe('fake dialog');
    expect(p.hasAttribute('class')).toBe(false);
    expect(strippedHTML).toBe(true);
  });

  it('strips a language class on an element other than code', () => {
    const { root, strippedHTML } = render('<pre class="language-js">x</pre>');
    expect(root.querySelector('pre').hasAttribute('class')).toBe(false);
    expect(strippedHTML).toBe(true);
  });

  it('strips a code class that adds a second class or lacks the language- prefix', () => {
    for (const cls of ['language-js modal-overlay', 'modal-overlay', 'LANGUAGE-js']) {
      const { root, strippedHTML } = render(`<code class="${cls}">x</code>`);
      expect(root.querySelector('code').hasAttribute('class')).toBe(false);
      expect(strippedHTML).toBe(true);
    }
  });
});
