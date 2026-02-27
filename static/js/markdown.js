import { marked } from './vendor/marked.esm.js';
import DOMPurify from './vendor/dompurify.esm.js';

// gfm: GitHub Flavored Markdown (~~strikethrough~~, autolinks, etc.)
// breaks: single newline → <br>, matching textarea UX
marked.use({ gfm: true, breaks: true });

// DOMPurify allowlist — only tags and attributes that safe Markdown can produce.
// javascript: and data: URIs are stripped by DOMPurify by default.
const PURIFY_CONFIG = {
  ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'b', 'strong', 'i', 'em', 'u', 's', 'del', 'ul', 'ol', 'li', 'p', 'br', 'a', 'code', 'pre'],
  ALLOWED_ATTR: ['href', 'title', 'target', 'rel'],
  FORCE_BODY: true,
};

/**
 * Render a Markdown string to safe HTML.
 * marked converts Markdown → HTML (raw HTML in source passes through unchanged).
 * DOMPurify is the security boundary — it strips any disallowed tags/attributes
 * and dangerous hrefs (javascript:, data:) from the rendered output.
 * @param {string} md
 * @returns {{ html: string, strippedHTML: boolean } | string} Returns an object containing the safe HTML and a flag indicating if dangerous tags were removed. Returns string for backward compatibility where needed.
 */
export function renderMarkdown(md, returnObject = false) {
  if (!md) return returnObject ? { html: '', strippedHTML: false } : '';
  const raw = marked.parse(md);

  let strippedHTML = false;
  DOMPurify.addHook('uponSanitizeElement', (node, data) => {
    // Ignore safe root/text nodes that DOMPurify processes by default
    if (data.tagName === 'body' || data.tagName === '#text' || data.tagName === '#comment') return;

    // Check if DOMPurify is about to remove a tag that isn't allowed
    if (!data.allowedTags[data.tagName]) {
      strippedHTML = true;
    }
  });

  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    // Check if an attribute is being stripped because it's not in the allowlist
    if (!data.allowedAttributes[data.attrName]) {
      strippedHTML = true;
    }
    // Detect javascript: URLs (which DOMPurify strips by default for security)
    if (data.attrValue && /^\s*javascript:/i.test(data.attrValue)) {
      strippedHTML = true;
    }
  });

  const html = DOMPurify.sanitize(raw, PURIFY_CONFIG);
  DOMPurify.removeHook('uponSanitizeElement');
  DOMPurify.removeHook('uponSanitizeAttribute');

  return returnObject ? { html, strippedHTML } : html;
}

/**
 * Strip Markdown syntax to produce a plain-text snippet (used for card previews).
 * @param {string} md
 * @returns {string}
 */
export function stripMarkdown(md) {
  if (!md) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = renderMarkdown(md);
  return (tmp.textContent || '').replaceAll(/\s+/g, ' ').trim();
}
