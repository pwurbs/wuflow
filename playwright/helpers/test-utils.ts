import { Page, expect } from '@playwright/test';

/**
 * Helper functions for wuFlow Playwright tests
 */

export interface IssueData {
  title: string;
  description?: string;
  status?: 'Open' | 'Todo' | 'Pending' | 'Working' | 'Stage1' | 'Stage2' | 'Stage3' | 'Stage4' | 'Done' | 'Archive';
  priority?: 'Normal' | 'High';
  deadline?: string; // YYYY-MM-DD format
  plannedDate?: string; // YYYY-MM-DD format
  plannedDates?: string[]; // Array of YYYY-MM-DD
  label?: string;
}

/**
 * Opens the New Issue modal
 */
export async function openIssueModal(page: Page): Promise<void> {
  await page.click('#add-issue-btn');
  await expect(page.locator('#issue-modal')).toBeVisible();
}

/**
 * Closes the issue modal by clicking Cancel
 */
export async function closeModal(page: Page): Promise<void> {
  await page.click('#cancel-btn');
  await expect(page.locator('#issue-modal')).toBeHidden();
}

/**
 * Selects a status from the custom dropdown
 * Options are: Open, To-do, Pending, Working, Done
 */
export async function selectStatus(page: Page, status: string): Promise<void> {
  await page.click('#status-trigger');
  await page.click(`#status-options .custom-option:has-text("${status}")`);
}

/**
 * Selects a priority from the custom dropdown
 * Options are: Normal, High
 */
export async function selectPriority(page: Page, priority: string): Promise<void> {
  await page.click('#priority-trigger');
  await page.click(`#priority-options .custom-option:has-text("${priority}")`);
}

/**
 * Selects a label from the custom dropdown by name
 */
export async function selectLabel(page: Page, labelName: string): Promise<void> {
  await page.click('#label-trigger');
  await page.click(`#label-options .custom-option:has-text("${labelName}")`);
}
/**
 * Selects an assignee from the custom dropdown by name
 */
export async function selectAssignee(page: Page, userName: string): Promise<void> {
  await page.click('#assignee-trigger');
  await page.click(`#assignee-options .custom-option:has-text("${userName}")`);
}

/**
 * Creates a new issue with the given data
 * Note: Default status is 'Open', not 'To-do'
 */
export async function createIssue(page: Page, data: IssueData): Promise<void> {
  await openIssueModal(page);

  // Fill title
  await page.fill('#title', data.title);

  // Fill description if provided
  if (data.description) {
    await page.locator('#description-editor').click();
    await page.locator('#description-editor').fill(data.description);
  }

  // Select status if provided (defaults to Open)
  if (data.status) {
    await selectStatus(page, data.status);
  }

  // Select priority if provided
  if (data.priority) {
    await selectPriority(page, data.priority);
  }

  // Set deadline if provided
  if (data.deadline) {
    await page.fill('#deadline', data.deadline);
  }

  // Set planned date(s)
  const datesToAdd = data.plannedDates || (data.plannedDate ? [data.plannedDate] : []);
  for (const dateStr of datesToAdd) {
    await page.fill('#planned-date-picker', dateStr, { force: true });
  }

  // Select label if provided
  if (data.label) {
    await selectLabel(page, data.label);
  }

  // Save the issue
  await page.click('#save-issue-btn');

  // Wait for modal to close
  await expect(page.locator('#issue-modal')).toBeHidden();
}

/**
 * Waits for and verifies the notification toast
 */
export async function waitForToast(page: Page, expectedText?: string): Promise<void> {
  const toast = page.locator('#notification-toast');
  await expect(toast).toBeVisible();
  if (expectedText) {
    await expect(toast).toContainText(expectedText);
  }
}

/**
 * Gets the count of cards in a specific column
 * Card class is 'card' or 'board-card', not 'issue-card'
 */
export async function getColumnCount(page: Page, column: 'todo' | 'pending' | 'working' | 'done'): Promise<number> {
  const statusKey = { todo: 'Todo', pending: 'Stage1', working: 'Stage2', done: 'Done' }[column];
  const cards = page.locator(`.column[data-status="${statusKey}"] .card`);
  return await cards.count();
}

/**
 * Opens an issue by clicking on its card
 */
export async function openIssueByTitle(page: Page, title: string): Promise<void> {
  await page.click(`.card:has-text("${title}")`);
  await expect(page.locator('#issue-modal')).toBeVisible();
}

/**
 * Navigates to a specific view
 */
// ...

export async function navigateTo(page: Page, view: 'board' | 'backlog' | 'system-settings' | 'archive' | 'project-settings' | 'releases'): Promise<void> {
  await page.click(`#nav-${view}`);
}

export interface ReleaseData {
  name: string;
  description?: string;
  startDate?: string;   // YYYY-MM-DD
  releaseDate?: string; // YYYY-MM-DD
  ownerText?: string;   // e.g. "Assign to me"
}

export async function createRelease(page: Page, data: ReleaseData): Promise<void> {
  await page.click('.release-add-btn');
  await expect(page.locator('#release-modal-overlay')).toBeVisible();
  await page.fill('#release-modal-name', data.name);
  if (data.description) {
    await page.fill('#release-modal-desc', data.description);
  }
  if (data.startDate) {
    await page.fill('#release-modal-start', data.startDate);
  }
  if (data.releaseDate) {
    await page.fill('#release-modal-date', data.releaseDate);
  }
  if (data.ownerText) {
    await page.click('#release-owner-trigger');
    await page.click(`#release-owner-options .custom-option:has-text("${data.ownerText}")`);
  }
  await page.click('#release-modal-save');
  await expect(page.locator('#release-modal-overlay')).toBeHidden();
}

export async function triggerRelease(page: Page, releaseName: string, archiveDone = false): Promise<void> {
  await page.locator(`.release-row:has-text("${releaseName}") .release-trigger-btn`).click();
  const checkbox = page.locator('#release-archive-done');
  const isChecked = await checkbox.isChecked();
  if (archiveDone && !isChecked) await checkbox.check();
  if (!archiveDone && isChecked) await checkbox.uncheck();
  await page.click('#release-dialog-confirm');
}

