import { test, expect } from '@playwright/test';
import { createIssue, openIssueByTitle } from './helpers/test-utils';

test.describe('Issue Edit Modal Behavior', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should not show popup when clicking outside modified title', async ({ page }) => {
    await createIssue(page, { title: 'Test Popup Issue', status: 'Todo' });
    await openIssueByTitle(page, 'Test Popup Issue');

    // Click title to edit
    await page.click('#title');
    await expect(page.locator('#title')).toHaveClass(/inline-editing/);

    // Modify title
    await page.fill('#title', 'Modified Title');

    // Click outside (e.g., on the modal background or description)
    await page.click('#modal-title');

    // Verify NO popup
    await expect(page.locator('#confirm-modal')).toBeHidden();

    // Verify still in edit mode or at least value retained
    await expect(page.locator('#title')).toHaveValue('Modified Title');

    // Click Done -> Should show popup
    await page.click('#done-btn');
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await expect(page.locator('#confirm-title')).toContainText('Unsaved Changes');

    // Click Discard
    await page.click('#confirm-cancel-btn'); // Cancel button acts as Discard based on modal.js logic "Cancel logic" is Discard in this context?
    // Wait, in modal.js: showConfirm('Unsaved Changes', 'Save Title?', 'Save', 'Discard', 'primary')
    // cancelButtonText is 'Discard'. So confirm-cancel-btn is Discard.

    // Modal should close (or title reset? Logic says "cancelTitle()" which resets value and exits edit mode)
    // Actually handleDone -> click Discard -> calls titleCancelBtn.dispatchEvent(mousedown) -> cancelTitle()
    // It does NOT close the modal automatically in handleDone if we just reset the field? 
    // Let's check handleDone logic: 
    // if (await showConfirm(...)) { save... } else { cancel... }
    // THEN it calls closeModal() at the very end.

    await expect(page.locator('#issue-modal')).toBeHidden(); // handleDone calls closeModal() at end

    // Reopen and check value is ORIGINAL
    await openIssueByTitle(page, 'Test Popup Issue');
    await expect(page.locator('#title')).toHaveValue('Test Popup Issue');
  });

  test('should save changes when clicking Done and confirming save', async ({ page }) => {
    await createIssue(page, { title: 'Save Test Issue', status: 'Todo' });
    await openIssueByTitle(page, 'Save Test Issue');

    await page.click('#title');
    await page.fill('#title', 'Saved Title');

    await page.click('#done-btn');
    await expect(page.locator('#confirm-modal')).toBeVisible();

    // Click Save (confirm-ok-btn)
    await page.click('#confirm-ok-btn');

    await expect(page.locator('#issue-modal')).toBeHidden();

    // Reopen and check value is NEW
    await openIssueByTitle(page, 'Saved Title');
    await expect(page.locator('#title')).toHaveValue('Saved Title');
  });

  test('should trigger browser navigation warning when unsaved changes exist', async ({ page }) => {
    await createIssue(page, { title: 'Nav Guard Issue', status: 'Todo' });
    await openIssueByTitle(page, 'Nav Guard Issue');

    await page.click('#title');
    await page.fill('#title', 'Unsaved Nav Title');

    // Try to reload page
    // Playwright handles dialogs automatically but for beforeunload we might need to handle it explicitly
    // or verify it prevents navigation if not handled?
    // Actually, modern browsers might just show it. Playwright can check for 'dialog' event.

    let dialogTriggered = false;
    page.on('dialog', async dialog => {
      dialogTriggered = true;
      expect(dialog.type()).toBe('beforeunload');
      await dialog.accept(); // Allow navigation to proceed
    });

    await page.reload();
    expect(dialogTriggered).toBe(true);
  });
});
