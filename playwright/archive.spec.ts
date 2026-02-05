import { test, expect } from '@playwright/test';
import { createIssue, navigateTo, selectStatus } from './helpers/test-utils';

test.describe('Archive View', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('navigate to Archive view', async ({ page }) => {
    await navigateTo(page, 'archive');

    // Archive view container should be visible
    await expect(page.locator('#archive-view')).toBeVisible();

    // Check sections
    await expect(page.locator('#archive-done-section')).toBeVisible();
    await expect(page.locator('#archive-archive-section')).toBeVisible();

    // Check headers
    await expect(page.locator('#archive-done-section h2')).toContainText('Move from Board (Done)');
    await expect(page.locator('#archive-archive-section h2')).toContainText('Archive');
  });

  test('move Done issue to Archive using drag and drop', async ({ page }) => {
    // 1. Create a Done issue
    // Ensure we have a Done issue. If createIssue doesn't support 'Done' directly, we might need to move it.
    // Assuming createIssue supports status based on backend model.
    // If not, we can create as Open, go to board, move to Done.
    // Let's try direct creation if possible, or use modal.
    await createIssue(page, { title: 'Issue to Archive' });

    // Move to Done via modal (First go to Backlog as default issue is Open)
    await navigateTo(page, 'backlog');
    // Move to Done via modal to be safe and realistic
    await page.click('.card:has-text("Issue to Archive")');
    await selectStatus(page, 'Done');
    await page.click('#done-btn');

    // 2. Navigate to Archive
    await navigateTo(page, 'archive');

    // 3. Verify it is in Done section
    const doneSection = page.locator('#archive-done-list');
    const archiveSection = page.locator('#archive-list');
    const card = doneSection.locator('.card', { hasText: 'Issue to Archive' });
    await expect(card).toBeVisible();

    // 4. Drag to Archive section
    await card.dragTo(archiveSection.locator('..')); // Drag to the list's container or list itself

    // 5. Verify it is now in Archive section
    await expect(archiveSection.locator('.card', { hasText: 'Issue to Archive' })).toBeVisible();
    await expect(doneSection.locator('.card', { hasText: 'Issue to Archive' })).toBeHidden();
  });

  test('move Archive issue back to Done using drag and drop', async ({ page }) => {
    await createIssue(page, { title: 'Archived Issue' });

    // Set to Archive via modal
    await navigateTo(page, 'backlog');
    await page.click('.card:has-text("Archived Issue")');
    await selectStatus(page, 'Archive');
    await page.click('#done-btn');

    await navigateTo(page, 'archive');

    const doneSection = page.locator('#archive-done-list');
    const archiveSection = page.locator('#archive-list');
    const card = archiveSection.locator('.card', { hasText: 'Archived Issue' });

    await expect(card).toBeVisible();

    // Drag back to Done
    await card.dragTo(doneSection.locator('..'));

    await expect(doneSection.locator('.card', { hasText: 'Archived Issue' })).toBeVisible();
    await expect(archiveSection.locator('.card', { hasText: 'Archived Issue' })).toBeHidden();
  });

  test('archive issue via modal', async ({ page }) => {
    await createIssue(page, { title: 'Modal Archive Issue' });

    await navigateTo(page, 'backlog');

    await navigateTo(page, 'backlog');
    // Open Modal
    await page.click('.card:has-text("Modal Archive Issue")');

    // Select Archive
    await selectStatus(page, 'Archive');
    await page.click('#done-btn');

    // Go to Archive view
    await navigateTo(page, 'archive');

    // Verify
    await expect(page.locator('#archive-list .card', { hasText: 'Modal Archive Issue' })).toBeVisible();

    // Verify it's NOT in Done section
    await expect(page.locator('#archive-done-list .card', { hasText: 'Modal Archive Issue' })).toBeHidden();
  });

  test('archived issue should not be visible on board', async ({ page }) => {
    await createIssue(page, { title: 'Hidden on Board' });

    // Archive it
    await navigateTo(page, 'backlog');
    await page.click('.card:has-text("Hidden on Board")');
    await selectStatus(page, 'Archive');
    await page.click('#done-btn');

    // Go to Board
    await navigateTo(page, 'board');

    // Verify hidden
    await expect(page.locator('.card', { hasText: 'Hidden on Board' })).toBeHidden();
  });

  test('reorder issues in archive list', async ({ page }) => {
    // Create 2 archive issues
    await createIssue(page, { title: 'Archive A' });
    await createIssue(page, { title: 'Archive B' });

    await navigateTo(page, 'backlog');

    // Move both to Archive
    // (Doing via modal for speed)
    const archiveViaModal = async (title: string) => {
      await page.locator(`.card:has-text("${title}")`).first().click();
      await selectStatus(page, 'Archive');
      await page.click('#done-btn');
    };

    await navigateTo(page, 'backlog');
    await archiveViaModal('Archive A');
    await archiveViaModal('Archive B');

    await navigateTo(page, 'archive');

    await navigateTo(page, 'archive');

    const list = page.locator('#archive-list');

    // Check that both are present
    const cardA = list.locator('.card', { hasText: 'Archive A' });
    const cardB = list.locator('.card', { hasText: 'Archive B' });
    await expect(cardA).toBeVisible();
    await expect(cardB).toBeVisible();

    // Verify initial relative order: A should be before B (assuming creation order)
    // We can check indices
    const allText = await list.locator('.card').allTextContents();
    const indexA = allText.findIndex(t => t.includes('Archive A'));
    const indexB = allText.findIndex(t => t.includes('Archive B'));
    expect(indexA).toBeLessThan(indexB);

    // Move B up (it should be below A)
    // We need to hover B to see controls
    await cardB.hover();
    await cardB.locator('.move-up').click();

    // Verify properties after move
    // Allow a moment for update if needed, but 'expect' retries
    await expect.poll(async () => {
      const texts = await list.locator('.card').allTextContents();
      const newIndexA = texts.findIndex(t => t.includes('Archive A'));
      const newIndexB = texts.findIndex(t => t.includes('Archive B'));
      return newIndexB < newIndexA; // B should now be before A
    }).toBe(true);
  });
});
