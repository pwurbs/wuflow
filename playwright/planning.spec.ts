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
    // Planning panel is now always visible on board view
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

    // Ensure target is visible (scrolls if needed)
    await tomorrowContainer.scrollIntoViewIfNeeded();

    // Perform Drag and Drop
    await itemToMove.dragTo(tomorrowContainer);

    // Verify it moved
    await expect(todayContainer.locator('.planning-item', { hasText: 'Move Me' })).toBeHidden();
    await expect(tomorrowContainer.locator('.planning-item', { hasText: 'Move Me' })).toBeVisible();
  });


  test('issue with deadline shows deadline badge', async ({ page }) => {
    const today = new Date();
    const dateStr = formatDate(today);

    // Create issue with both planned date and deadline
    await createIssue(page, {
      title: 'Deadline Issue',
      status: 'Todo',
      plannedDate: dateStr,
      deadline: dateStr
    });

    const dayContainer = page.locator(`#day-${dateStr}`);
    const planningItem = dayContainer.locator('.planning-item', { hasText: 'Deadline Issue' });
    await expect(planningItem).toBeVisible();

    // Check for deadline badge
    await expect(planningItem.locator('.planning-item-deadline')).toBeVisible();
  });

  test('unscheduled section shows issues with deadline but no planned date', async ({ page }) => {
    const today = new Date();
    const dateStr = formatDate(today);

    // Create issue with deadline but no planned date
    await createIssue(page, {
      title: 'Unscheduled Deadline Issue',
      status: 'Todo',
      deadline: dateStr
      // No plannedDate
    });

    // Verify it appears in unscheduled section
    const unscheduledSection = page.locator('#unscheduled-section');
    await expect(unscheduledSection).toBeVisible();
    await expect(unscheduledSection.locator('.planning-item', { hasText: 'Unscheduled Deadline Issue' })).toBeVisible();
  });

  test('drag unscheduled issue to day slot assigns planned date', async ({ page }) => {
    const today = new Date();
    const dateStr = formatDate(today);

    // Create unscheduled issue with deadline
    await createIssue(page, {
      title: 'Schedule Me',
      status: 'Todo',
      deadline: dateStr
    });

    const unscheduledSection = page.locator('#unscheduled-section');
    const todayContainer = page.locator(`#day-${dateStr}`);
    const unscheduledItem = unscheduledSection.locator('.planning-item', { hasText: 'Schedule Me' });

    await expect(unscheduledItem).toBeVisible();

    // Ensure target is visible (scrolls if needed)
    await todayContainer.scrollIntoViewIfNeeded();

    // Drag to today container (same pattern as working drag test)
    await unscheduledItem.dragTo(todayContainer);

    // Give time for the API call and re-render
    await page.waitForTimeout(500);

    // Verify the issue now appears in the day container (it should have planned_date set)
    await expect(todayContainer.locator('.planning-item', { hasText: 'Schedule Me' })).toBeVisible();
  });

  test('click planning item opens edit modal', async ({ page }) => {
    const today = new Date();
    const dateStr = formatDate(today);

    await createIssue(page, {
      title: 'Click Me',
      status: 'Todo',
      plannedDate: dateStr
    });

    const dayContainer = page.locator(`#day-${dateStr}`);
    const itemToClick = dayContainer.locator('.planning-item', { hasText: 'Click Me' });

    await expect(itemToClick).toBeVisible();
    await itemToClick.click();

    // Verify modal opens
    await expect(page.locator('#issue-modal')).toBeVisible();
    await expect(page.locator('#title')).toHaveValue('Click Me');
  });

  test('past planning section is hidden when empty', async ({ page }) => {
    // Check if #day-past is visible (might be due to previous tests)
    const pastSection = page.locator('#day-past');

    // Wait a bit for initial render
    await page.waitForTimeout(500);

    if (await pastSection.isVisible()) {
      // Clear all items in past section
      // We click the first remove button repeatedly until no items remain
      while (await pastSection.locator('.planning-item-remove').count() > 0) {
        await pastSection.locator('.planning-item-remove').first().click();
        await page.waitForTimeout(300); // Wait for update
      }
    }

    // Verify it is hidden
    await expect(pastSection).toBeHidden();
  });

  test('unscheduled section is hidden when empty', async ({ page }) => {
    const unscheduledSection = page.locator('#unscheduled-section');
    await page.waitForTimeout(500);

    if (await unscheduledSection.isVisible()) {
      const targetDay = page.locator(`#day-${formatDate(new Date())}`);
      await targetDay.scrollIntoViewIfNeeded();

      while (await unscheduledSection.locator('.planning-item').count() > 0) {
        const item = unscheduledSection.locator('.planning-item').first();
        await item.dragTo(targetDay);
        await page.waitForTimeout(300);
      }
    }

    await expect(unscheduledSection).toBeHidden();
  });

  test('future planned dates appear in Future section', async ({ page }) => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 15);

    // Manual format to avoid timezone issues or helper dependency if outside scope
    // Helper `formatDate` is available in scope.
    const year = futureDate.getFullYear();
    const month = String(futureDate.getMonth() + 1).padStart(2, '0');
    const day = String(futureDate.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    await createIssue(page, {
      title: 'Future Issue',
      status: 'Todo',
      plannedDate: dateStr
    });

    const futureSection = page.locator('#day-future');
    await expect(futureSection).toBeVisible();
    await expect(futureSection.locator('.planning-item', { hasText: 'Future Issue' })).toBeVisible();
  });

  test('unscheduled section includes issues with subtask deadlines', async ({ page }) => {
    const title = 'Parent Issue ' + Date.now();
    await createIssue(page, { title: title, status: 'Todo' });

    // Open modal
    await page.locator('.card', { hasText: title }).first().click();
    await expect(page.locator('#issue-modal')).toBeVisible();

    // Add task
    // Add task with deadline (Simplified)
    await page.fill('#new-task-title', 'Subtask with Deadline');

    // Set deadline for task (Tomorrow)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const year = tomorrow.getFullYear();
    const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const day = String(tomorrow.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    await page.fill('#new-task-deadline', dateStr);
    await page.click('#add-task-btn');

    // Wait for task to appear (Ensures creation)
    // Task title is in an input value, so look for that
    // const taskInput = page.locator('.task-title-input', { hasText: 'Subtask with Deadline' }); // Unused
    const taskItem = page.locator('.task-item').filter({ has: page.locator('input[value="Subtask with Deadline"]') });
    await expect(taskItem).toBeVisible();

    // Close modal
    await page.locator('#done-btn').click();
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Verify unscheduled section
    const unscheduledSection = page.locator('#unscheduled-section');
    await expect(unscheduledSection).toBeVisible();
    const item = unscheduledSection.locator('.planning-item', { hasText: title });
    await expect(item).toBeVisible();

    // Verify badge date
    const badge = item.locator('.planning-item-deadline');
    await expect(badge).toHaveAttribute('title', 'Task Deadline');
  });

  test('warning shown when planned date is later than deadline', async ({ page }) => {
    const title = 'Late Planned Issue ' + Date.now();
    await createIssue(page, { title: title, status: 'Todo' });

    // Open modal
    await page.locator('.card', { hasText: title }).first().click();
    await expect(page.locator('#issue-modal')).toBeVisible();

    // Set deadline to Tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr1 = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    await page.fill('#deadline', dateStr1);

    // Set planned date to Day After Tomorrow
    const dayAfter = new Date();
    dayAfter.setDate(dayAfter.getDate() + 2);
    const dateStr2 = `${dayAfter.getFullYear()}-${String(dayAfter.getMonth() + 1).padStart(2, '0')}-${String(dayAfter.getDate()).padStart(2, '0')}`;
    await page.fill('#planned-date', dateStr2);

    // Close modal
    await page.locator('#done-btn').click();
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Find item in planning panel
    // It should be planned for dayAfter.
    // We can just find it by text in planning-list
    const item = page.locator('.planning-item', { hasText: title });
    await expect(item).toBeVisible();

    const badge = item.locator('.planning-item-deadline');
    await expect(badge).toBeVisible();
    // Should have warning icon (checks for emoji or class)
    await expect(badge).toHaveClass(/overdue/);
    await expect(badge).toHaveAttribute('title', 'Planned late!');
  });

  test('planned issue shows task deadline badge', async ({ page }) => {
    const title = 'Planned Subtask Deadline ' + Date.now();
    await createIssue(page, { title: title, status: 'Todo' });

    // Open modal
    await page.locator('.card', { hasText: title }).first().click();
    await expect(page.locator('#issue-modal')).toBeVisible();

    // Set planned date to Tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    await page.fill('#planned-date', dateStr);

    // Add task with deadline (Day after tomorrow to avoid warning)
    await page.fill('#new-task-title', 'Subtask for Badge');

    const dayAfter = new Date();
    dayAfter.setDate(dayAfter.getDate() + 2);
    const dateStr2 = `${dayAfter.getFullYear()}-${String(dayAfter.getMonth() + 1).padStart(2, '0')}-${String(dayAfter.getDate()).padStart(2, '0')}`;

    await page.fill('#new-task-deadline', dateStr2);
    await page.click('#add-task-btn');

    // Wait for task
    await expect(page.locator('.task-item').filter({ has: page.locator('input[value="Subtask for Badge"]') })).toBeVisible();

    // Close modal
    await page.locator('#done-btn').click();
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Find item (should be in Tomorrow's column)
    // Actually, we can just find by text generally in planning list, 
    // but confirming it has the badge is the key.
    const item = page.locator('.planning-item', { hasText: title });
    await expect(item).toBeVisible();

    const badge = item.locator('.planning-item-deadline');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute('title', 'Task Deadline');
  });
});
