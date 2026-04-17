import { test, expect, Page } from './fixtures';
import { createIssue, openIssueByTitle, navigateTo, selectStatus } from './helpers/test-utils';

/**
 * Tests for:
 *  1. Validation limits (lengths) for issue, task, label and user fields.
 *  2. Markdown description rendering (basic formatting, allowed tags).
 *  3. XSS & sanitization for description (preview + roundtrip) and title.
 *
 * Limits (from backend/validation.go):
 *   Issue Title      : 100 characters (rune count)
 *   Issue Description: 5 000 characters (rune count)
 *   Task Title       : 100 characters (rune count)
 *   Label Name       : 15 characters (rune count)
 *   User First/Last  : 50 characters each (rune count)
 *   User Password    : max 128 characters (rune count)
 *   User Email       : max 254 bytes (RFC 5321)
 *
 * The client-side guards mirror these limits; errors surface via
 *   - #notification-toast   (issue / task / label errors)
 *   - #user-modal-error     (user form errors)
 *
 * Security model:
 *   - Titles: sanitized server-side (HTML tags stripped).
 *   - Descriptions: stored as raw Markdown; sanitized client-side by DOMPurify
 *     on every render. Allowed tags: h1-h6, b, strong, i, em, u, s, del, ul,
 *     ol, li, p, br, a, code, pre. Allowed attrs: href, title, target, rel.
 *     javascript: and data: URIs are always stripped by DOMPurify.
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Wait for the main toast (#notification-toast) to show an error message. */
async function expectMainError(page: Page, substring: string) {
  const toast = page.locator('#notification-toast');
  await expect(toast).toBeVisible({ timeout: 5000 });
  await expect(toast).toContainText(substring);
}

/** Wait for the user-form inline error to show a message. */
async function expectUserError(page: Page, substring: string) {
  const err = page.locator('#user-modal-error');
  await expect(err).toBeVisible({ timeout: 5000 });
  await expect(err).toContainText(substring);
}

/**
 * Opens a new-issue modal, fills in a description, clicks the preview toggle
 * and returns the innerHTML of the preview pane. Leaves the modal open.
 */
async function fillDescriptionAndPreview(page: Page, title: string, description: string): Promise<string> {
  await page.click('#add-issue-btn');
  await expect(page.locator('#issue-modal')).toBeVisible();
  await page.fill('#title', title);
  await page.fill('#description-editor', description);
  await page.click('#md-preview-toggle');
  await expect(page.locator('#description-preview')).toBeVisible();
  return page.locator('#description-preview').innerHTML();
}

// ─── Validation limits — Issue ───────────────────────────────────────────────

test.describe('Validation limits – Issue', () => {
  test.beforeEach(async ({ page, login }) => {
    await login();
  });

  test('title exceeding 100 characters is rejected', async ({ page }) => {
    await page.click('#add-issue-btn');
    await expect(page.locator('#issue-modal')).toBeVisible();

    // Set value directly (bypasses input-event truncation) to test JS validation backstop
    await page.evaluate(() => {
      (document.getElementById('title') as HTMLInputElement).value = 'a'.repeat(101);
    });

    await page.click('#save-issue-btn');

    await expectMainError(page, 'Title must not exceed 100 characters');
    // Modal stays open – user can correct the input
    await expect(page.locator('#issue-modal')).toBeVisible();
  });

  test('description exceeding 5000 characters is rejected', async ({ page }) => {
    await page.click('#add-issue-btn');
    await expect(page.locator('#issue-modal')).toBeVisible();

    await page.fill('#title', 'Desc Limit Test');

    // Set value directly (bypasses input-event truncation) to test JS validation backstop
    await page.evaluate((text) => {
      (document.getElementById('description-editor') as HTMLTextAreaElement).value = text;
    }, 'a'.repeat(5_001));

    await page.click('#save-issue-btn');

    await expectMainError(page, 'Description must not exceed 5000 characters.');
    await expect(page.locator('#issue-modal')).toBeVisible();
  });
});

// ─── Validation limits — Task ────────────────────────────────────────────────

test.describe('Validation limits – Task', () => {
  test.beforeEach(async ({ page, login }) => {
    await login();
  });

  test('task title exceeding 100 characters is rejected', async ({ page }) => {
    // Tasks are only available on an existing issue
    const parentTitle = `Task Limit Parent ${Date.now()}`;
    await createIssue(page, { title: parentTitle, status: 'Todo' });
    await openIssueByTitle(page, parentTitle);

    await expect(page.locator('#tasks-section')).toBeVisible();

    // Set value directly (bypasses input-event truncation) to test JS validation backstop
    await page.evaluate(() => {
      (document.getElementById('new-task-title') as HTMLInputElement).value = 'a'.repeat(101);
    });
    await page.click('#add-task-btn');

    await expectMainError(page, 'Task title must not exceed 100 characters');
    // Task was not created – task list should be empty
    await expect(page.locator('#task-list li')).toHaveCount(0);
  });
});

// ─── Validation limits — Label ────────────────────────────────────────────────

test.describe('Validation limits – Label', () => {
  test.beforeEach(async ({ page, login }) => {
    await login();
    await navigateTo(page, 'project-settings');
  });

  test('label name exceeding 15 characters is rejected', async ({ page }) => {
    // Set value directly (bypasses input-event truncation) to test JS validation backstop
    await page.evaluate(() => {
      (document.getElementById('ps-new-label-input') as HTMLInputElement).value = 'a'.repeat(16);
    });

    await page.click('#ps-add-label-btn');

    await expectMainError(page, 'Label name must not exceed 15 characters');
  });
});

// ─── Validation limits — User ─────────────────────────────────────────────────

test.describe('Validation limits – User', () => {
  test.beforeEach(async ({ page, login }) => {
    await login();
    await navigateTo(page, 'system-settings');
    await page.click('#add-user-btn');
    await expect(page.locator('#user-modal-overlay')).toBeVisible();
  });

  test('first name exceeding 50 characters is rejected', async ({ page }) => {
    await page.fill('#user-email', 'limit-test@example.com');
    // Set value directly (bypasses input-event truncation) to test JS validation backstop
    await page.evaluate(() => {
      (document.getElementById('user-first-name') as HTMLInputElement).value = 'a'.repeat(51);
    });
    await page.fill('#user-last-name', 'Valid');
    await page.fill('#user-password', 'ValidPassword!1');
    await page.click('#user-modal-save');

    await expectUserError(page, 'must not exceed 50 characters');
  });

  test('last name exceeding 50 characters is rejected', async ({ page }) => {
    await page.fill('#user-email', 'limit-test2@example.com');
    await page.fill('#user-first-name', 'Valid');
    // Set value directly (bypasses input-event truncation) to test JS validation backstop
    await page.evaluate(() => {
      (document.getElementById('user-last-name') as HTMLInputElement).value = 'a'.repeat(51);
    });
    await page.fill('#user-password', 'ValidPassword!1');
    await page.click('#user-modal-save');

    await expectUserError(page, 'must not exceed 50 characters');
  });

  test('password exceeding 128 characters is rejected', async ({ page }) => {
    await page.fill('#user-email', 'limit-test3@example.com');
    await page.fill('#user-first-name', 'Valid');
    await page.fill('#user-last-name', 'User');
    await page.evaluate(() => {
      document.getElementById('user-password')?.removeAttribute('maxlength');
    });
    await page.fill('#user-password', 'Aa1!' + 'a'.repeat(125)); // 129 chars
    await page.click('#user-modal-save');

    await expectUserError(page, 'Password must not exceed 128 characters');
  });

  test('email exceeding 254 characters is rejected', async ({ page }) => {
    // 255-byte email: local part padded to make total > 254
    const longEmail = 'a'.repeat(244) + '@example.com'; // 256 chars total
    await page.evaluate(() => {
      document.getElementById('user-email')?.removeAttribute('maxlength');
    });
    await page.fill('#user-email', longEmail);
    await page.fill('#user-first-name', 'Valid');
    await page.fill('#user-last-name', 'User');
    await page.fill('#user-password', 'ValidPassword!1');
    await page.click('#user-modal-save');

    // Email > 254 bytes is validated backend-side and surfaced via the inline error
    await expectUserError(page, 'exceed');
  });
});

// ─── Markdown Description Rendering ──────────────────────────────────────────

test.describe('Markdown description rendering', () => {
  test.beforeEach(async ({ page, login }) => {
    await login();
  });

  test('GFM formatting renders correctly in preview and after save', async ({ page }) => {
    const title = `MD-Test-${Date.now()}`;
    const markdown = '# Heading\n**Bold** *Italic* ~~Strike~~';

    await page.click('#add-issue-btn');
    await page.fill('#title', title);
    await page.fill('#description-editor', markdown);

    // Check live preview
    await page.click('#md-preview-toggle');
    const preview = page.locator('#description-preview');
    await expect(preview).toBeVisible();
    await expect(preview.locator('h1')).toHaveText('Heading');
    await expect(preview.locator('strong')).toHaveText('Bold');
    await expect(preview.locator('em')).toHaveText('Italic');
    await expect(preview.locator('del')).toHaveText('Strike');

    // Save, re-open, verify persistence
    await selectStatus(page, 'Todo');
    await page.click('#save-issue-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    await openIssueByTitle(page, title);
    const savedPreview = page.locator('#description-preview');
    await expect(savedPreview).toBeVisible();
    await expect(savedPreview.locator('h1')).toHaveText('Heading');
    await expect(savedPreview.locator('strong')).toHaveText('Bold');
  });

  test('inline allowed HTML tags are preserved in preview', async ({ page }) => {
    const title = `HTML-MD-${Date.now()}`;
    // These tags are explicitly in the DOMPurify allowlist
    const payload = 'Markdown **bold** and <u>HTML underline</u> and <b>HTML bold</b>';

    await page.click('#add-issue-btn');
    await page.fill('#title', title);
    await page.fill('#description-editor', payload);

    await page.click('#md-preview-toggle');
    const preview = page.locator('#description-preview');
    await expect(preview.locator('strong')).toHaveText('bold');
    await expect(preview.locator('u')).toHaveText('HTML underline');
    await expect(preview.locator('b')).toHaveText('HTML bold');

    // Persist and re-verify
    await selectStatus(page, 'Todo');
    await page.click('#save-issue-btn');
    await openIssueByTitle(page, title);
    await expect(page.locator('#description-preview').locator('u')).toHaveText('HTML underline');
  });

  test('safe links preserve href, target="_blank" and rel="noopener noreferrer"', async ({ page }) => {
    const title = `Link-Attr-${Date.now().toString().slice(-6)}`;
    // Inline HTML with all safe link attributes
    const linkPayload = '<a href="https://example.com" target="_blank" rel="noopener noreferrer">Preserved Link</a>';

    await page.click('#add-issue-btn');
    await expect(page.locator('#issue-modal')).toBeVisible();
    await page.fill('#title', title);
    await selectStatus(page, 'Todo');
    await page.fill('#description-editor', linkPayload);
    await page.click('#save-issue-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    await openIssueByTitle(page, title);
    await expect(page.locator('#modal-title')).toContainText('Edit Issue', { timeout: 10000 });

    const anchor = page.locator('#description-preview a');
    await expect(anchor).toBeVisible();
    await expect(anchor).toHaveAttribute('href', 'https://example.com');
    await expect(anchor).toHaveAttribute('target', '_blank');
    await expect(anchor).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

// ─── XSS & Sanitization ──────────────────────────────────────────────────────

test.describe('XSS and Sanitization', () => {
  test.beforeEach(async ({ page, login }) => {
    await login();
  });

  // ── Description ────────────────────────────────────────────────────────────

  test('desc: script tags and onerror attributes are stripped (preview + roundtrip)', async ({ page }) => {
    const title = `XSS-D-${Date.now().toString().slice(-6)}`;
    // Mix of safe content + dangerous tags — safe text must survive, dangerous must be gone
    const payload = '<b>Safe Bold</b><script>alert(1)</script><img src=x onerror="alert(2)">Trailing';

    await page.click('#add-issue-btn');
    await page.fill('#title', title);
    await selectStatus(page, 'Todo');
    await page.fill('#description-editor', payload);

    // Preview check — warning toast expected, no dangerous elements
    await page.click('#md-preview-toggle');
    await expect(page.locator('#notification-toast')).toContainText('Unsupported HTML tags are not rendered for security.');
    const preview = page.locator('#description-preview');
    expect(await preview.innerHTML()).not.toContain('<script');
    expect(await preview.innerHTML()).not.toContain('onerror');
    await expect(preview.locator('script')).toHaveCount(0);
    await expect(preview.locator('img[onerror]')).toHaveCount(0);
    // Safe content preserved
    expect(await preview.textContent()).toContain('Safe Bold');
    expect(await preview.textContent()).toContain('Trailing');

    // Roundtrip — save, reload, re-open
    await page.click('#save-issue-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();
    await page.reload({ waitUntil: 'networkidle' });
    await openIssueByTitle(page, title);
    await expect(page.locator('#modal-title')).toContainText('Edit Issue', { timeout: 10000 });
    const savedPreview = page.locator('#description-preview');
    expect(await savedPreview.innerHTML()).not.toContain('<script');
    expect(await savedPreview.innerHTML()).not.toContain('onerror');
    expect(await savedPreview.textContent()).toContain('Safe Bold');
  });

  test('desc: javascript: URI in markdown link is neutralised', async ({ page }) => {
    const title = `XSS-JS-URI-${Date.now().toString().slice(-6)}`;
    // DOMPurify neutralises javascript: hrefs
    const payload = 'Click [here](javascript:alert(1)) for a surprise.';

    const previewHTML = await fillDescriptionAndPreview(page, title, payload);

    // The rendered link must not contain a javascript: href
    expect(previewHTML).not.toContain('javascript:'); //NOSONAR
    // The link text itself should still be visible
    await expect(page.locator('#description-preview')).toContainText('here');
  });

  test('desc: data: URI in <img> src is stripped', async ({ page }) => {
    const title = `XSS-DATA-${Date.now().toString().slice(-6)}`;
    // data: URIs can be used to load malicious content
    const payload = '<img src="data:text/html,<script>alert(1)</script>" alt="x">';

    const previewHTML = await fillDescriptionAndPreview(page, title, payload);

    // img tag itself is not allowed; it must not appear at all in the output
    expect(previewHTML).not.toContain('<img');
    expect(previewHTML).not.toContain('data:');
  });

  test('desc: SVG with onload handler is stripped', async ({ page }) => {
    const title = `XSS-SVG-${Date.now().toString().slice(-6)}`;
    const payload = '<svg/onload=alert(1)><circle r="10"/></svg>';

    await fillDescriptionAndPreview(page, title, payload);

    // marked entity-encodes the raw SVG tag (treats it as plain text), so the
    // browser never parses it as markup. The DOM must contain no live <svg> element.
    await expect(page.locator('#description-preview svg')).toHaveCount(0);
    // No live onload attribute either
    await expect(page.locator('#description-preview [onload]')).toHaveCount(0);
  });

  test('desc: CSS expression / style injection is stripped', async ({ page }) => {
    const title = `XSS-STYLE-${Date.now().toString().slice(-6)}`;
    // style attribute with expression() is a historical IE XSS vector
    const payload = '<p style="color:red; background-image:url(javascript:alert(1))">Styled</p>';

    const previewHTML = await fillDescriptionAndPreview(page, title, payload);

    // style attribute is not in the allowlist
    expect(previewHTML).not.toContain('style=');
    expect(previewHTML).not.toContain('javascript:'); //NOSONAR
    // Text content should survive (p tag is allowed)
    await expect(page.locator('#description-preview')).toContainText('Styled');
  });

  test('desc: iframe and object tags are stripped', async ({ page }) => {
    const title = `XSS-IFRM-${Date.now().toString().slice(-6)}`;
    const payload = '<iframe src="https://evil.com"></iframe><object data="malware.swf"></object>Visible';

    const previewHTML = await fillDescriptionAndPreview(page, title, payload);

    expect(previewHTML).not.toContain('<iframe');
    expect(previewHTML).not.toContain('<object');
    await expect(page.locator('#description-preview')).toContainText('Visible');
  });

  test('desc: HTML entity-encoded script tag is not executed', async ({ page }) => {
    const title = `XSS-ENT-${Date.now().toString().slice(-6)}`;
    // Entity-encoded attempts to sneak past naive regex filters
    const payload = '&lt;script&gt;alert(1)&lt;/script&gt; Plain text';

    const previewHTML = await fillDescriptionAndPreview(page, title, payload);

    // Should appear as literal text, not as an executed script
    expect(previewHTML).not.toContain('<script');
    // The text representation of the entities should be visible
    await expect(page.locator('#description-preview')).toContainText('Plain text');
  });

  test('desc: mutation XSS — nested tags that reconstruct after parsing are stripped', async ({ page }) => {
    // A classic mXSS pattern: the browser may reconstruct dangerous markup from
    // seemingly-harmless fragments after innerHTML serialisation rounds. DOMPurify
    // is specifically hardened against this.
    const title = `XSS-MXSS-${Date.now().toString().slice(-6)}`;
    const payload = '<p><img src=x onerror=alert(1)<!-- --></p>';

    const previewHTML = await fillDescriptionAndPreview(page, title, payload);

    expect(previewHTML).not.toContain('onerror');
    expect(previewHTML).not.toContain('<img');
  });

  test('desc: template literal / Angular-style injection has no effect', async ({ page }) => {
    const title = `XSS-TMPL-${Date.now().toString().slice(-6)}`;
    // Not applicable in plain JS, but good to verify literal output
    const payload = '{{7*7}} ${7*7} #{7*7} Literal';

    await fillDescriptionAndPreview(page, title, payload);

    // The critical invariant: nothing is evaluated. Regardless of how GFM
    // processes the input (e.g. italic markers may alter spacing), none of these
    // expressions produce a numeric result.
    const text = await page.locator('#description-preview').textContent() ?? '';
    expect(text).toContain('Literal'); // plain text survives
    expect(text).not.toContain('49');  // 7*7 is never evaluated
  });

  // ── Title ──────────────────────────────────────────────────────────────────

  test('title: HTML tags are stripped server-side and card shows plain text', async ({ page }) => {
    const dangerousTitle = `<b>Bold Title</b><script>alert(1)</script> ${Date.now()}`;

    await createIssue(page, { title: dangerousTitle, status: 'Todo' });

    // Card must show plain text, no raw tags
    const card = page.locator('.board-card', { hasText: 'Bold Title' });
    await expect(card).toBeVisible();

    const boardTitle = card.locator('.board-card-title');
    const textContent = await boardTitle.textContent();
    expect(textContent).not.toContain('<b>');
    expect(textContent).not.toContain('<script');
    expect(textContent).toContain('Bold Title');
  });

  test('title: inline edit strips tags and shows warning toast', async ({ page }) => {
    // Create a clean issue first
    const base = `Title-XSS-${Date.now().toString().slice(-6)}`;
    await createIssue(page, { title: base, status: 'Todo' });

    const card = page.locator('.board-card', { hasText: base });
    await card.click();

    const titleInput = page.locator('#title');
    await titleInput.click(); // enter inline-edit mode
    await titleInput.fill('Updated <i>Italic</i><img src=x onerror=alert(1)>');
    await titleInput.blur(); // triggers save

    // Warning toast expected
    const toast = page.locator('#notification-toast');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('Unsupported HTML tags are not rendered for security.');

    // Input value is sanitized by backend (tags stripped, text content kept)
    const finalValue = await titleInput.inputValue();
    expect(finalValue).toBe('Updated Italic');
  });
});
