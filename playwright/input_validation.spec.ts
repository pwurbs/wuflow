import { test, expect, Page } from '@playwright/test';
import { login, createIssue, openIssueByTitle, navigateTo, selectStatus } from './helpers/test-utils';

/**
 * Sad-path tests for all validation limits.
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
 *   - #notification-toast        (issue / task errors)
 *   - #modal-notification-toast  (label errors)
 *   - #user-modal-error          (user form errors)
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Wait for the main toast (#notification-toast) to show an error message. */
async function expectMainError(page: Page, substring: string) {
  const toast = page.locator('#notification-toast');
  await expect(toast).toBeVisible({ timeout: 5000 });
  await expect(toast).toContainText(substring);
}

/** Wait for the modal toast (#modal-notification-toast) to show an error message. */
async function expectModalError(page: Page, substring: string) {
  const toast = page.locator('#modal-notification-toast');
  await toast.waitFor({ state: 'visible', timeout: 5000 });
  await expect(toast).toContainText(substring);
}

/** Wait for the user-form inline error to show a message. */
async function expectUserError(page: Page, substring: string) {
  const err = page.locator('#user-modal-error');
  await expect(err).toBeVisible({ timeout: 5000 });
  await expect(err).toContainText(substring);
}

// ─── Issue validation ────────────────────────────────────────────────────────

test.describe('Validation limits – Issue', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
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

    // contenteditable – set via evaluate
    await page.evaluate((text) => {
      const el = document.getElementById('description-editor');
      if (el) el.innerText = text;
    }, 'a'.repeat(5_001));

    await page.click('#save-issue-btn');

    await expectMainError(page, 'Description HTML must not exceed 5000 characters.');
    await expect(page.locator('#issue-modal')).toBeVisible();
  });
});

// ─── Task validation ─────────────────────────────────────────────────────────

test.describe('Validation limits – Task', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
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

// ─── Label validation ─────────────────────────────────────────────────────────

test.describe('Validation limits – Label', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await navigateTo(page, 'setup');
  });

  test('label name exceeding 15 characters is rejected', async ({ page }) => {
    // Set value directly (bypasses input-event truncation) to test JS validation backstop
    await page.evaluate(() => {
      (document.getElementById('new-label-input') as HTMLInputElement).value = 'a'.repeat(16);
    });

    await page.click('#add-label-btn');

    await expectMainError(page, 'Label name must not exceed 15 characters');
  });
});

// ─── User validation ──────────────────────────────────────────────────────────

test.describe('Validation limits – User', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await navigateTo(page, 'setup');
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

// ─── XSS Roundtrip Validation ────────────────────────────────────────────────

test.describe('XSS Roundtrip Validation', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('issue description is sanitized after reload', async ({ page }) => {
    const title = `XSS-D-${Date.now().toString().slice(-6)}`;
    // Payload: safe <b> (preserved), dangerous <script> (stripped), dangerous <img onerror> (stripped)
    const xssPayload = '<b>Safe Bold</b><script>alert(1)</script><img src=x onerror="alert(2)">Trailing';

    await page.click('#add-issue-btn');
    await expect(page.locator('#issue-modal')).toBeVisible();

    await page.fill('#title', title);
    await selectStatus(page, 'Todo');

    await page.evaluate((payload) => {
      const el = document.getElementById('description-editor');
      if (el) el.innerHTML = payload;
    }, xssPayload);

    await page.click('#save-issue-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Reload page to ensure full store→reload cycle
    await page.reload({ waitUntil: 'networkidle' });
    await openIssueByTitle(page, title);

    const descriptionEditor = page.locator('#description-editor');
    // Wait for the modal to finish loading (heading changes from "New Issue" to "Edit Issue #N")
    await expect(page.locator('#modal-title')).toContainText('Edit Issue', { timeout: 10000 });
    await expect(descriptionEditor).toBeVisible();

    const innerHTML = await descriptionEditor.innerHTML();
    const textContent = await descriptionEditor.textContent();

    // Dangerous elements/attributes must be gone
    expect(innerHTML).not.toContain('<script');
    expect(innerHTML).not.toContain('onerror');

    // Safe text content should survive
    expect(textContent).toContain('Bold');
    expect(textContent).toContain('Trailing');
  });

  test('safe links preserve target="_blank" and rel="noopener noreferrer"', async ({ page }) => {
    const title = `Link-Attr-${Date.now().toString().slice(-6)}`;
    const linkPayload = '<a href="https://example.com">Preserved Link</a>';

    await page.click('#add-issue-btn');
    await expect(page.locator('#issue-modal')).toBeVisible();

    await page.fill('#title', title);
    await selectStatus(page, 'Todo');

    await page.evaluate((payload) => {
      const el = document.getElementById('description-editor');
      if (el) el.innerHTML = payload;
    }, linkPayload);

    await page.click('#save-issue-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Re-open and verify
    await openIssueByTitle(page, title);
    await expect(page.locator('#modal-title')).toContainText('Edit Issue', { timeout: 10000 });

    const anchor = page.locator('#description-editor a');
    await expect(anchor).toBeVisible();
    await expect(anchor).toHaveAttribute('href', 'https://example.com');
    await expect(anchor).toHaveAttribute('target', '_blank');
    await expect(anchor).toHaveAttribute('rel', 'noopener noreferrer');
  });

  test('issue title tags are stripped for security', async ({ page }) => {
    const dangerousTitle = `<b>Bold Title</b> ${Date.now()}`;

    await createIssue(page, {
      title: dangerousTitle,
      status: 'Todo'
    });

    // Locate the card - it should match the text without tags
    const card = page.locator('.board-card', { hasText: 'Bold Title' });
    await expect(card).toBeVisible();

    const boardTitle = card.locator('.board-card-title');
    const textContent = await boardTitle.textContent();

    // Backend strips tags using anyTagRegex in validateIssue
    expect(textContent).not.toContain('<b>');
    expect(textContent).not.toContain('</b>');
    expect(textContent).toContain('Bold Title');
  });
});
