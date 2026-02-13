import { Page, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Helper functions for wuFlow Playwright tests
 */

export interface IssueData {
  title: string;
  description?: string;
  status?: 'Open' | 'Todo' | 'Pending' | 'Working' | 'Done' | 'Archive';
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
  const cards = page.locator(`#col-${column} .card`);
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

export async function navigateTo(page: Page, view: 'board' | 'backlog' | 'setup' | 'archive'): Promise<void> {
  await page.click(`#nav-${view}`);
}

/**
 * Logs in as the initial admin user.
 * Reads password from test-data/admin.json
 */
export async function login(page: Page): Promise<void> {
  const configPath = path.join(__dirname, '..', 'test-data', 'admin.json');
  let adminPassword = '';

  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    adminPassword = config.password;
  } else {
    throw new Error(`Admin config not found at ${configPath}. Run global-setup first.`);
  }

  await page.goto('/login');
  await page.fill('#login-email', 'admin@local');
  await page.fill('#login-password', adminPassword);
  await page.click('#login-btn');
  // Wait for board or nav to confirm login
  await expect(page.locator('#nav-board')).toBeVisible();
}
