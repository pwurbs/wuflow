import { test, expect } from '@playwright/test';
import { createIssue } from './helpers/test-utils';

test.describe('Planning Panel', () => {
  // Helper to format date as YYYY-MM-DD for input and ID matching
  const formatDate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Open planning panel
    await page.click('#btn-planning');
    await expect(page.locator('#planning-panel')).toBeVisible();
  });

  test('create issue with planned date appears in planning panel', async ({ page }) => {
    const today = new Date();
    const dateStr = formatDate(today);

    await createIssue(page, {
      title: 'Planned Issue 1',
      status: 'Todo',
      plannedDate: dateStr
    });

    // Check if it appears in the specific date container
    const dayContainer = page.locator(`#day-${dateStr}`);
    await expect(dayContainer).toBeVisible();
    await expect(dayContainer.locator('.planning-item', { hasText: 'Planned Issue 1' })).toBeVisible();

    // Check global planning count
    // Uses regex because count might be > 1 if db is dirty
    await expect(page.locator('#planning-count')).not.toHaveText('0');
  });

  test('issues are grouped by date', async ({ page }) => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const todayStr = formatDate(today);
    const tomorrowStr = formatDate(tomorrow);

    // Create issue for today
    await createIssue(page, {
      title: 'Today Issue',
      status: 'Todo',
      plannedDate: todayStr
    });

    // Create issue for tomorrow
    await createIssue(page, {
      title: 'Tomorrow Issue',
      status: 'Todo',
      plannedDate: tomorrowStr
    });

    // Verify Today's issue
    const todayContainer = page.locator(`#day-${todayStr}`);
    await expect(todayContainer.locator('.planning-item', { hasText: 'Today Issue' })).toBeVisible();
    // Ensure Tomorrow's issue is NOT in Today's container
    await expect(todayContainer.locator('.planning-item', { hasText: 'Tomorrow Issue' })).toBeHidden();

    // Verify Tomorrow's issue
    const tomorrowContainer = page.locator(`#day-${tomorrowStr}`);
    await expect(tomorrowContainer.locator('.planning-item', { hasText: 'Tomorrow Issue' })).toBeVisible();
    // Ensure Today's issue is NOT in Tomorrow's container
    await expect(tomorrowContainer.locator('.planning-item', { hasText: 'Today Issue' })).toBeHidden();

    // Verify count
    await expect(page.locator('#planning-count')).not.toHaveText('0');
  });

  test('multiple issues on same date are grouped together', async ({ page }) => {
    const today = new Date();
    const dateStr = formatDate(today);

    // Create first issue
    await createIssue(page, {
      title: 'Same Day 1',
      status: 'Todo',
      plannedDate: dateStr
    });

    // Create second issue
    await createIssue(page, {
      title: 'Same Day 2',
      status: 'Todo',
      plannedDate: dateStr
    });

    const dayContainer = page.locator(`#day-${dateStr}`);
    await expect(dayContainer.locator('.planning-item', { hasText: 'Same Day 1' })).toBeVisible();
    await expect(dayContainer.locator('.planning-item', { hasText: 'Same Day 2' })).toBeVisible();
  });

  test('past planned dates appear in Past section', async ({ page }) => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = formatDate(yesterday);

    await createIssue(page, {
      title: 'Past Issue',
      status: 'Todo',
      plannedDate: dateStr
    });

    const pastContainer = page.locator('#day-past');
    await expect(pastContainer).toBeVisible();
    await expect(pastContainer.locator('.planning-item', { hasText: 'Past Issue' })).toBeVisible();
  });

  test('planning panel toggle persistence', async ({ page }) => {
    // Initial state: Planning is visible (from beforeEach)
    await expect(page.locator('#planning-panel')).toBeVisible();

    // Switch to Deadlines
    await page.click('#btn-deadlines');
    await expect(page.locator('#planning-panel')).toBeHidden();
    await expect(page.locator('#deadlines-panel')).toBeVisible();

    // Switch back to Planning
    await page.click('#btn-planning');
    await expect(page.locator('#planning-panel')).toBeVisible();
    await expect(page.locator('#deadlines-panel')).toBeHidden();
  });

  test('remove from plan via button', async ({ page }) => {
    const today = new Date();
    const dateStr = formatDate(today);

    await createIssue(page, {
      title: 'To Be Removed',
      status: 'Todo',
      plannedDate: dateStr
    });

    const dayContainer = page.locator(`#day-${dateStr}`);
    const itemToRemove = dayContainer.locator('.planning-item', { hasText: 'To Be Removed' });
    await expect(itemToRemove).toBeVisible();

    // Click remove button (x) inside the SPECIFIC planning item
    // Note: The click might be intercepted if the button is small or hidden, but it seems visible in DOM
    await itemToRemove.locator('.planning-item-remove').click();

    // Verify it disappears from planning panel
    await expect(itemToRemove).toBeHidden();

    // Verify issue still exists on board (it's just removed from plan)
    await expect(page.locator('.board-card:has-text("To Be Removed")')).toBeVisible();
  });

  test('drag planning item to another day', async ({ page }) => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const todayStr = formatDate(today);
    const tomorrowStr = formatDate(tomorrow);

    await createIssue(page, {
      title: 'Move Me',
      status: 'Todo',
      plannedDate: todayStr
    });

    const todayContainer = page.locator(`#day-${todayStr}`);
    const tomorrowContainer = page.locator(`#day-${tomorrowStr}`);
    const itemToMove = todayContainer.locator('.planning-item', { hasText: 'Move Me' });

    await expect(itemToMove).toBeVisible();
    await expect(tomorrowContainer.locator('.planning-item', { hasText: 'Move Me' })).toBeHidden();

    // Perform Drag and Drop
    await itemToMove.dragTo(tomorrowContainer);

    // Verify it moved
    await expect(todayContainer.locator('.planning-item', { hasText: 'Move Me' })).toBeHidden();
    await expect(tomorrowContainer.locator('.planning-item', { hasText: 'Move Me' })).toBeVisible();
  });
});
