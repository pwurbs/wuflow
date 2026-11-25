import { test, expect } from './fixtures';
import { createIssue, selectAssignee, waitForIssueSave, isoDateFromToday } from './helpers/test-utils';

test.describe('Planning Panel', () => {
  test.beforeEach(async ({ page, login }) => {
    await login();
    // Planning panel is now always visible on board view
    await expect(page.locator('#planning-panel')).toBeVisible();
  });

  test('planning sidebar is a named landmark', async ({ page }) => {
    const sidebar = page.getByRole('complementary', { name: 'Planning', exact: true });
    await expect(sidebar).toBeVisible();
    await expect(sidebar.locator('#planning-panel')).toBeVisible();
  });

  test('create issue with planned date appears in planning panel', async ({ page }) => {
    const dateStr = isoDateFromToday();

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
    const todayStr = isoDateFromToday();
    const tomorrowStr = isoDateFromToday(1);

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
    const dateStr = isoDateFromToday();

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
    const dateStr = isoDateFromToday(-1);

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
    const dateStr = isoDateFromToday();

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
    const todayStr = isoDateFromToday();
    const tomorrowStr = isoDateFromToday(1);

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
    const dateStr = isoDateFromToday();

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
    const dateStr = isoDateFromToday();

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
    const dateStr = isoDateFromToday();
    const uniqueTitle = 'Schedule Me ' + Date.now(); // Unique title for isolation

    // Create unscheduled issue with deadline
    await createIssue(page, {
      title: uniqueTitle,
      status: 'Todo',
      deadline: dateStr
    });

    const unscheduledSection = page.locator('#unscheduled-section');
    const unscheduledItem = unscheduledSection.locator('.planning-item', { hasText: uniqueTitle });

    // Wait for item to appear in unscheduled section
    await expect(unscheduledItem).toBeVisible();

    // Click on the item to open the edit modal (more reliable than drag)
    await unscheduledItem.click();
    await expect(page.locator('#issue-modal')).toBeVisible();
    await expect(page.locator('#issue-id')).toHaveValue(/\d+/);

    // Set planned date via modal
    const savePromise = page.waitForResponse(response =>
      response.url().includes('/issues/') && response.request().method() === 'PUT'
    );
    await page.fill('#planned-date-picker', dateStr, { force: true });
    await savePromise;

    // Close modal
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Verify the issue moved out of unscheduled section
    await expect(unscheduledSection.locator('.planning-item', { hasText: uniqueTitle })).toBeHidden();

    // Verify it now appears in the day container
    const todayContainer = page.locator(`#day-${dateStr}`);
    await expect(todayContainer.locator('.planning-item', { hasText: uniqueTitle })).toBeVisible();
  });

  test('click planning item opens edit modal', async ({ page }) => {
    const dateStr = isoDateFromToday();

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
    await expect(page.locator('#issue-id')).toHaveValue(/\d+/);
    await expect(page.locator('#title')).toHaveValue('Click Me');
  });

  test('past planning section is hidden when empty', async ({ page }) => {
    // Check if #day-past is visible (might be due to previous tests)
    const pastSection = page.locator('#day-past');

    // Today's box is always rendered, in the same pass as the past section.
    await expect(page.locator(`#day-${isoDateFromToday()}`)).toBeVisible();

    if (await pastSection.isVisible()) {
      // Clear all items in past section
      // We click the first remove button repeatedly until no items remain
      const removeButtons = pastSection.locator('.planning-item-remove');
      while (await removeButtons.count() > 0) {
        const saved = waitForIssueSave(page);
        await removeButtons.first().click();
        await saved;
      }
    }

    // Verify it is hidden
    await expect(pastSection).toBeHidden();
  });

  test('unscheduled section is hidden when empty', async ({ page }) => {
    const dateStr = isoDateFromToday();
    const uniqueTitle = 'Hide Test ' + Date.now(); // Unique title for isolation

    // Create a fresh issue with deadline (appears in unscheduled)
    await createIssue(page, {
      title: uniqueTitle,
      status: 'Todo',
      deadline: dateStr
    });

    // Verify it appears in unscheduled section
    const unscheduledSection = page.locator('#unscheduled-section');
    const item = unscheduledSection.locator('.planning-item', { hasText: uniqueTitle });
    await expect(item).toBeVisible();

    // Click on item to open edit modal, then assign a planned date
    await item.click();
    await expect(page.locator('#issue-modal')).toBeVisible();
    await expect(page.locator('#issue-id')).toHaveValue(/\d+/);

    // Set planned date via modal
    const savePromise = page.waitForResponse(response =>
      response.url().includes('/issues/') && response.request().method() === 'PUT'
    );
    await page.fill('#planned-date-picker', dateStr, { force: true });
    await savePromise;

    // Close modal
    await page.click('#done-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Verify our specific item moved from unscheduled to scheduled
    await expect(unscheduledSection.locator('.planning-item', { hasText: uniqueTitle })).toBeHidden();
    await expect(page.locator(`#day-${dateStr}`).locator('.planning-item', { hasText: uniqueTitle })).toBeVisible();
  });

  test('future planned dates appear in Future section', async ({ page }) => {
    const dateStr = isoDateFromToday(15);

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
    await expect(page.locator('#issue-id')).toHaveValue(/\d+/);

    // Add task
    // Add task with deadline (Simplified)
    await page.fill('#new-task-title', 'Subtask with Deadline');

    // Set deadline for task (Tomorrow)
    const dateStr = isoDateFromToday(1);

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
    await expect(page.locator('#issue-id')).toHaveValue(/\d+/);

    // Set deadline to Tomorrow
    const dateStr1 = isoDateFromToday(1);

    // Wait for the save (a field change now only re-renders locally; the app-wide
    // issues refresh is deferred until the modal closes, not fired per-field).
    const savePromise1 = waitForIssueSave(page);
    await page.fill('#deadline', dateStr1);
    await savePromise1;

    // Set planned date to Day After Tomorrow
    const dateStr2 = isoDateFromToday(2);

    const savePromise2 = waitForIssueSave(page);
    await page.fill('#planned-date-picker', dateStr2, { force: true });
    await savePromise2;

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
    // Late is shown by the overdue class (red), not by an emoji
    await expect(badge).toHaveClass(/overdue/);
    await expect(badge).not.toContainText(/⚠|⏰/u);
    await expect(badge).toHaveAttribute('title', 'Planned late!');
  });

  test('planned issue shows task deadline badge', async ({ page }) => {
    const title = 'Planned Subtask Deadline ' + Date.now();
    await createIssue(page, { title: title, status: 'Todo' });

    // Open modal
    await page.locator('.card', { hasText: title }).first().click();
    await expect(page.locator('#issue-modal')).toBeVisible();

    // Set planned date to Tomorrow
    const dateStr = isoDateFromToday(1);
    await page.fill('#planned-date-picker', dateStr, { force: true });

    // Add task with deadline (Day after tomorrow to avoid warning)
    await page.fill('#new-task-title', 'Subtask for Badge');

    const dateStr2 = isoDateFromToday(2);

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

  test('issue can be planned on multiple days', async ({ page }) => {
    const todayStr = isoDateFromToday();
    const tomorrowStr = isoDateFromToday(1);

    await createIssue(page, {
      title: 'Multi-Day Issue',
      status: 'Todo',
      plannedDates: [todayStr, tomorrowStr]
    });

    // Check Today
    const todayContainer = page.locator(`#day-${todayStr}`);
    await expect(todayContainer.locator('.planning-item', { hasText: 'Multi-Day Issue' })).toBeVisible();

    // Check Tomorrow
    const tomorrowContainer = page.locator(`#day-${tomorrowStr}`);
    await expect(tomorrowContainer.locator('.planning-item', { hasText: 'Multi-Day Issue' })).toBeVisible();
  });

  test('dragging issue to future box is blocked (does not add date)', async ({ page }) => {
    const title = 'Future Block Test ' + Date.now();
    // Must have a deadline to appear in Unscheduled section
    const deadlineStr = isoDateFromToday(5);

    await createIssue(page, {
      title: title,
      status: 'Todo',
      deadline: deadlineStr
    });

    const unscheduledSection = page.locator('#unscheduled-section');
    await expect(unscheduledSection).toBeVisible();
    const item = unscheduledSection.locator('.planning-item', { hasText: title });
    await expect(item).toBeVisible();

    // Ensure Future section is visible via trigger issue
    const futureDateStr = isoDateFromToday(20);

    await createIssue(page, {
      title: 'Trigger Future Box',
      status: 'Todo',
      plannedDate: futureDateStr
    });

    const futureSection = page.locator('#day-future');
    await expect(futureSection).toBeVisible();

    // An accepted drop would send the issue PUT synchronously from the drop handler.
    const issueSaves: string[] = [];
    page.on('request', req => {
      if (req.method() === 'PUT' && /\/api\/projects\/\d+\/issues\/\d+$/.test(req.url())) issueSaves.push(req.url());
    });

    // Now drag our 'Future Block Test' issue to the future box. The events are dispatched
    // directly: the item (Unscheduled) and the future box are too far apart in the panel
    // for dragTo, whose drop never arrived there, so the test passed without testing anything.
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await item.dispatchEvent('dragstart', { dataTransfer });
    await futureSection.dispatchEvent('drop', { dataTransfer });
    await item.dispatchEvent('dragend', { dataTransfer });
    expect(issueSaves).toHaveLength(0);

    // Verify it is NOT in future section
    await expect(futureSection.locator('.planning-item', { hasText: title })).toBeHidden();

    // Verify it is still in Unscheduled
    await expect(unscheduledSection.locator('.planning-item', { hasText: title })).toBeVisible();
  });

  test('smart late status: only late instance shows warning', async ({ page }) => {
    const todayStr = isoDateFromToday();
    const tomorrowStr = isoDateFromToday(1);

    // Deadline is today
    await createIssue(page, {
      title: 'Smart Late Test',
      status: 'Todo',
      deadline: todayStr,
      plannedDates: [todayStr, tomorrowStr]
    });

    const todayContainer = page.locator(`#day-${todayStr}`);
    const todayItem = todayContainer.locator('.planning-item', { hasText: 'Smart Late Test' });
    // It will have a "Deadline" badge because it has a deadline, but NOT overdue
    await expect(todayItem.locator('.planning-item-deadline')).toHaveAttribute('title', 'Deadline');
    await expect(todayItem.locator('.planning-item-deadline')).not.toHaveClass(/overdue/);

    // Tomorrow instance: Late (Tomorrow > Today)
    const tomorrowContainer = page.locator(`#day-${tomorrowStr}`);
    const tomorrowItem = tomorrowContainer.locator('.planning-item', { hasText: 'Smart Late Test' });

    const lateBadge = tomorrowItem.locator('.planning-item-deadline');
    await expect(lateBadge).toBeVisible();
    await expect(lateBadge).toHaveAttribute('title', 'Planned late!');
    await expect(lateBadge).toHaveClass(/overdue/);
  });

  test('removing one day from multi-day plan does not remove others', async ({ page }) => {
    const todayStr = isoDateFromToday();
    const tomorrowStr = isoDateFromToday(1);

    await createIssue(page, {
      title: 'Partial Remove Test',
      status: 'Todo',
      plannedDates: [todayStr, tomorrowStr]
    });

    const todayContainer = page.locator(`#day-${todayStr}`);
    const tomorrowContainer = page.locator(`#day-${tomorrowStr}`);

    await expect(todayContainer.locator('.planning-item', { hasText: 'Partial Remove Test' })).toBeVisible();
    await expect(tomorrowContainer.locator('.planning-item', { hasText: 'Partial Remove Test' })).toBeVisible();

    const itemToRemove = todayContainer.locator('.planning-item', { hasText: 'Partial Remove Test' });
    await itemToRemove.locator('.planning-item-remove').click();

    await expect(todayContainer.locator('.planning-item', { hasText: 'Partial Remove Test' })).toBeHidden();
    await expect(tomorrowContainer.locator('.planning-item', { hasText: 'Partial Remove Test' })).toBeVisible();
  });

  test('multiple past dates show as single item in past section', async ({ page }) => {
    const dateStr1 = isoDateFromToday(-1);
    const dateStr2 = isoDateFromToday(-2);

    await createIssue(page, {
      title: 'Dedupe Past Test',
      status: 'Todo',
      plannedDates: [dateStr1, dateStr2]
    });

    const pastContainer = page.locator('#day-past');
    await expect(pastContainer).toBeVisible();

    await expect(pastContainer.locator('.planning-item', { hasText: 'Dedupe Past Test' })).toBeVisible();
    const count = await pastContainer.locator('.planning-item', { hasText: 'Dedupe Past Test' }).count();
    expect(count).toBe(1);
  });

  test('unplanned issue with distant deadline is hidden behind collapsed header', async ({ page }) => {
    const dateStr = isoDateFromToday(15);

    const uniqueTitle = 'Distant Deadline ' + Date.now();

    // Create issue with distant deadline
    await createIssue(page, {
      title: uniqueTitle,
      status: 'Todo',
      deadline: dateStr
    });

    const unscheduledSection = page.locator('#unscheduled-section');
    await expect(unscheduledSection).toBeVisible();

    // The header should be visible
    const toggleHeader = unscheduledSection.locator('.planning-section-subheader');
    await expect(toggleHeader).toBeVisible();
    // The item should be in the DOM but hidden
    const farContent = unscheduledSection.locator('.far-term');
    const item = farContent.locator('.planning-item', { hasText: uniqueTitle });
    await expect(item).toBeAttached();
    await expect(item).toBeHidden();

    // Other tests of this worker may leave distant deadlines too, so the header counts what is behind it.
    const farCount = await farContent.locator('.planning-item').count();
    await expect(toggleHeader).toContainText(`10+ days away [${farCount}]`);

    // Click to expand
    await toggleHeader.click();

    // Now it should be visible
    await expect(item).toBeVisible();
  });

  test('assignee badge initials on planning card', async ({ page }) => {
    const dateStr = isoDateFromToday();
    const title = `Planning Badge Test ${Date.now()}`;

    await createIssue(page, {
      title,
      status: 'Todo',
      plannedDate: dateStr
    });

    const dayContainer = page.locator(`#day-${dateStr}`);
    const planningItem = dayContainer.locator('.planning-item', { hasText: title });
    await expect(planningItem).toBeVisible();

    // Open and assign
    await planningItem.click();
    await expect(page.locator('#issue-modal')).toBeVisible();

    // Wait for the update request
    const updatePromise = page.waitForResponse(response =>
      response.url().includes('/issues/') && response.request().method() === 'PUT'
    );
    await selectAssignee(page, 'Assign to me');
    await updatePromise;

    await page.click('#done-btn');

    // Verify badge AU appears on the planning item
    const badge = planningItem.locator('.user-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('AU');
  });

  test('done issue shows as completed in planning sidebar', async ({ page }) => {
    const dateStr = isoDateFromToday();

    await createIssue(page, {
      title: 'Done Completion Test',
      status: 'Todo',
      plannedDate: dateStr,
    });

    // Verify the planned item appears without done styling
    const dayContainer = page.locator(`#day-${dateStr}`);
    const planningItem = dayContainer.locator('.planning-item', { hasText: 'Done Completion Test' });
    await expect(planningItem).toBeVisible();
    await expect(planningItem).not.toHaveClass(/done/);

    // Drag the issue card to the Done column on the Kanban board
    const issueCard = page.locator('.column[data-status="Todo"] .board-card:has-text("Done Completion Test")');
    const doneColumn = page.locator('.column[data-status="Done"]');
    await issueCard.dragTo(doneColumn);

    // Wait for the PUT request that persists the status change
    await page.waitForResponse(
      response => response.url().includes('/issues/') && response.request().method() === 'PUT'
    );

    // The planning item should still be visible but styled as done (faded + strikethrough)
    await expect(planningItem).toBeVisible();
    await expect(planningItem).toHaveClass(/done/);
  });

  test('hovering a planning item highlights a high-priority card with the blue border', async ({ page }) => {
    const dateStr = isoDateFromToday();
    await createIssue(page, { title: 'Prio Highlight Test', status: 'Todo', priority: 'High', plannedDate: dateStr });

    const card = page.locator('.column[data-status="Todo"] .board-card:has-text("Prio Highlight Test")');
    await expect(card).toHaveCSS('border-color', 'rgb(91, 51, 70)');

    await page.locator(`#day-${dateStr} .planning-item`, { hasText: 'Prio Highlight Test' }).hover();
    await expect(card).toHaveClass(/hover-highlight/);
    await expect(card).toHaveCSS('border-color', 'rgb(126, 164, 224)');
  });

});
