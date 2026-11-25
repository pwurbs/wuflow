// Parts of the real app page (static/index.html) for tests.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = new DOMParser().parseFromString(
  readFileSync(join(import.meta.dirname, '../../index.html'), 'utf8'), 'text/html');

// Replaces the body with fresh copies of the elements matching the selectors.
export function mountPage(...selectors: string[]) {
  document.body.replaceChildren(...selectors.map(selector => {
    const found = page.querySelectorAll(selector);
    if (found.length !== 1) throw new Error(`index.html: ${found.length} elements match ${selector}, expected 1`);
    return document.importNode(found[0], true);
  }));
}
