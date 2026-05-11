import { test, expect } from './fixtures';
import { createRelease, triggerRelease, navigateTo, waitForToast, openIssueByTitle } from './helpers/test-utils';

// ─── Release Lifecycle ────────────────────────────────────────────────────────

test.describe('Release Lifecycle', () => {
  test.beforeEach(async ({ page, login }) => {
    await login();
    await navigateTo(page, 'releases');
  });

  test('create a release', async ({ page }) => {
    const name = `Rel_${Date.now().toString().slice(-6)}`;
    await createRelease(page, { name });
    await waitForToast(page, 'Release created');
    await expect(page.locator(`.release-row:has-text("${name}")`)).toBeVisible();
  });

  test('edit a release', async ({ page }) => {
    const name = `Edit_${Date.now().toString().slice(-6)}`;
    const updated = `Upd_${Date.now().toString().slice(-6)}`;
    await createRelease(page, { name });

    await page.locator(`.release-row:has-text("${name}") .release-card-left`).click();
    await expect(page.locator('#release-modal-overlay')).toBeVisible();
    await page.fill('#release-modal-name', updated);
    await page.click('#release-modal-save');
    await expect(page.locator('#release-modal-overlay')).toBeHidden();
    await waitForToast(page, 'Release updated');
    await expect(page.locator(`.release-row:has-text("${updated}")`)).toBeVisible();
    await expect(page.locator(`.release-row:has-text("${name}")`)).toHaveCount(0);
  });

  test('delete a release', async ({ page }) => {
    const name = `Del_${Date.now().toString().slice(-6)}`;
    await createRelease(page, { name });

    await page.locator(`.release-row:has-text("${name}") .release-card-left`).click();
    await expect(page.locator('#release-modal-overlay')).toBeVisible();
    await page.click('#release-modal-delete');
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await page.click('#confirm-ok-btn');
    await waitForToast(page, 'Release deleted');
    await expect(page.locator('.release-row:has-text("' + name + '")')).toHaveCount(0);
  });

  test('cancel release deletion', async ({ page }) => {
    const name = `Keep_${Date.now().toString().slice(-6)}`;
    await createRelease(page, { name });

    await page.locator(`.release-row:has-text("${name}") .release-card-left`).click();
    await expect(page.locator('#release-modal-overlay')).toBeVisible();
    await page.click('#release-modal-delete');
    // closeReleaseModal() is called before the confirm dialog appears, so the
    // release modal is already gone at this point.
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await page.click('#confirm-cancel-btn');
    await expect(page.locator('#confirm-modal')).toBeHidden();
    await expect(page.locator(`.release-row:has-text("${name}")`)).toBeVisible();
  });

  test('trigger/close a release', async ({ page }) => {
    const name = `Close_${Date.now().toString().slice(-6)}`;
    await createRelease(page, { name });

    await triggerRelease(page, name, false);
    await waitForToast(page, 'Release closed');
    // Closed releases appear in the closed section (no trigger button)
    await expect(page.locator(`.release-row:has-text("${name}") .release-trigger-btn`)).toHaveCount(0);
  });

  test('reopen a closed release', async ({ page }) => {
    const name = `Reopen_${Date.now().toString().slice(-6)}`;
    await createRelease(page, { name });
    await triggerRelease(page, name, false);
    await waitForToast(page, 'Release closed');

    // Open the closed release modal
    await page.locator(`.release-row:has-text("${name}") .release-card-left`).click();
    await expect(page.locator('#release-modal-overlay')).toBeVisible();
    await page.click('#release-modal-reopen');
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await page.click('#confirm-ok-btn');
    await waitForToast(page, 'Release reopened');
    // Release button should be back
    await expect(page.locator(`.release-row:has-text("${name}") .release-trigger-btn`)).toBeVisible();
  });

  test('closed release is read-only', async ({ page }) => {
    const name = `RO_${Date.now().toString().slice(-6)}`;
    await createRelease(page, { name });
    await triggerRelease(page, name, false);
    await waitForToast(page, 'Release closed');

    await page.locator(`.release-row:has-text("${name}") .release-card-left`).click();
    await expect(page.locator('#release-modal-overlay')).toBeVisible();
    await expect(page.locator('#release-modal-name')).toHaveAttribute('readonly', '');
    await expect(page.locator('#release-modal-save')).toHaveText('Done');
    await expect(page.locator('#release-modal-reopen')).toBeVisible();
    await page.click('#release-modal-save'); // closes modal (Done button)
    await expect(page.locator('#release-modal-overlay')).toBeHidden();
  });
});

// ─── Release Trigger Behaviour ────────────────────────────────────────────────

test.describe('Release Trigger Behaviour', () => {
  test.beforeEach(async ({ page, login }) => {
    await login();
    await navigateTo(page, 'releases');
  });

  test('unfinished issues warning shown', async ({ page }) => {
    const name = `Warn_${Date.now().toString().slice(-6)}`;
    await createRelease(page, { name });

    await navigateTo(page, 'board');
    await page.click('#add-issue-btn');
    await expect(page.locator('#issue-modal')).toBeVisible();
    await page.fill('#title', `Issue_${name}`);
    await page.click('#release-trigger');
    await page.click(`#release-options .custom-option:has-text("${name}")`);
    await page.click('#save-issue-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    await navigateTo(page, 'releases');
    await page.locator(`.release-row:has-text("${name}") .release-trigger-btn`).click();
    await expect(page.locator('.release-dialog-warning')).toBeVisible();
    await page.click('#release-dialog-cancel');
  });

  test('auto-archive Done issues on release', async ({ page }) => {
    const name = `Archive_${Date.now().toString().slice(-6)}`;
    await createRelease(page, { name });

    // Create a Done issue and assign it to the release
    await navigateTo(page, 'board');
    await page.click('#add-issue-btn');
    await expect(page.locator('#issue-modal')).toBeVisible();
    const issueTitle = `DoneIssue_${name}`;
    await page.fill('#title', issueTitle);
    await page.click('#status-trigger');
    await page.click('#status-options .custom-option:has-text("Done")');
    await page.click('#release-trigger');
    await page.click(`#release-options .custom-option:has-text("${name}")`);
    await page.click('#save-issue-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Trigger release with archive checked
    await navigateTo(page, 'releases');
    await page.locator(`.release-row:has-text("${name}") .release-trigger-btn`).click();
    await page.locator('#release-archive-done').check();
    await page.click('#release-dialog-confirm');
    await waitForToast(page, 'Release closed');

    // Verify issue is now in archive
    await navigateTo(page, 'archive');
    await expect(page.locator(`.card:has-text("${issueTitle}")`)).toBeVisible();
  });

  test('archive checkbox disabled when no Done issues', async ({ page }) => {
    const name = `NoDone_${Date.now().toString().slice(-6)}`;
    await createRelease(page, { name });

    await page.locator(`.release-row:has-text("${name}") .release-trigger-btn`).click();
    await expect(page.locator('#release-archive-done')).toBeDisabled();
    await page.click('#release-dialog-cancel');
  });

  test('auto-archive skipped when unchecked', async ({ page }) => {
    const name = `NoArc_${Date.now().toString().slice(-6)}`;
    await createRelease(page, { name });

    // Create a Done issue and assign it
    await navigateTo(page, 'board');
    await page.click('#add-issue-btn');
    await expect(page.locator('#issue-modal')).toBeVisible();
    const issueTitle = `KeepDone_${name}`;
    await page.fill('#title', issueTitle);
    await page.click('#status-trigger');
    await page.click('#status-options .custom-option:has-text("Done")');
    await page.click('#release-trigger');
    await page.click(`#release-options .custom-option:has-text("${name}")`);
    await page.click('#save-issue-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Trigger release without archiving
    await navigateTo(page, 'releases');
    await triggerRelease(page, name, false);
    await waitForToast(page, 'Release closed');

    // Issue must still be in Done column, not archived
    await navigateTo(page, 'board');
    await expect(page.locator(`.column[data-status="Done"] .card:has-text("${issueTitle}")`)).toBeVisible();
  });
});

// ─── Release–Issue Association ────────────────────────────────────────────────

test.describe('Release–Issue Association', () => {
  test.beforeEach(async ({ page, login }) => {
    await login();
    await navigateTo(page, 'releases');
  });

  test('assign release to an issue', async ({ page }) => {
    const relName = `Assign_${Date.now().toString().slice(-6)}`;
    await createRelease(page, { name: relName });

    await navigateTo(page, 'board');
    await page.click('#add-issue-btn');
    await expect(page.locator('#issue-modal')).toBeVisible();
    await page.fill('#title', `RelIssue_${relName}`);
    await page.click('#status-trigger');
    await page.click('#status-options .custom-option:has-text("Todo")');
    await page.click('#release-trigger');
    await page.click(`#release-options .custom-option:has-text("${relName}")`);
    await page.click('#save-issue-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Reopen and verify release is shown
    await openIssueByTitle(page, `RelIssue_${relName}`);
    await expect(page.locator('#release-text')).toContainText(relName);
    await page.click('#done-btn');
  });

  test('issue keeps data after release deleted', async ({ page }) => {
    const relName = `Orphan_${Date.now().toString().slice(-6)}`;
    await createRelease(page, { name: relName });

    await navigateTo(page, 'board');
    const issueTitle = `OrphanIssue_${relName}`;
    await page.click('#add-issue-btn');
    await expect(page.locator('#issue-modal')).toBeVisible();
    await page.fill('#title', issueTitle);
    await page.click('#status-trigger');
    await page.click('#status-options .custom-option:has-text("Todo")');
    await page.click('#release-trigger');
    await page.click(`#release-options .custom-option:has-text("${relName}")`);
    await page.click('#save-issue-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Delete the release
    await navigateTo(page, 'releases');
    await page.locator(`.release-row:has-text("${relName}") .release-card-left`).click();
    await page.click('#release-modal-delete');
    await expect(page.locator('#confirm-modal')).toBeVisible();
    await page.click('#confirm-ok-btn');
    await waitForToast(page, 'Release deleted');

    // Issue still exists on board with no release assigned
    await navigateTo(page, 'board');
    await openIssueByTitle(page, issueTitle);
    await expect(page.locator('#release-text')).toContainText('No Release');
    await page.click('#done-btn');
  });

  test('release progress shows issue completion', async ({ page }) => {
    const relName = `Prog_${Date.now().toString().slice(-6)}`;
    await createRelease(page, { name: relName });

    await navigateTo(page, 'board');

    // Create a Done issue assigned to the release
    await page.click('#add-issue-btn');
    await expect(page.locator('#issue-modal')).toBeVisible();
    await page.fill('#title', `DoneIssue_${relName}`);
    await page.click('#status-trigger');
    await page.click('#status-options .custom-option:has-text("Done")');
    await page.click('#release-trigger');
    await page.click(`#release-options .custom-option:has-text("${relName}")`);
    await page.click('#save-issue-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    await page.click('#add-issue-btn');
    await expect(page.locator('#issue-modal')).toBeVisible();
    await page.fill('#title', `TodoIssue_${relName}`);
    await page.click('#release-trigger');
    await page.click(`#release-options .custom-option:has-text("${relName}")`);
    await page.click('#save-issue-btn');
    await expect(page.locator('#issue-modal')).toBeHidden();

    // Verify release card shows 1/2
    await navigateTo(page, 'releases');
    await expect(page.locator(`.release-row:has-text("${relName}") .release-count`)).toContainText('1/2');
  });
});

// ─── Project-scoped Releases ─────────────────────────────────────────────────

test.describe('Project-scoped Releases', () => {
  test.beforeEach(async ({ page, login }) => {
    await login();
  });

  test('release created in project A not visible in project B', async ({ page }) => {
    // Create a second project
    await navigateTo(page, 'system-settings');
    await page.click('#add-project-btn');
    await expect(page.locator('#project-modal-overlay')).toBeVisible();
    const projectName = `scopeB_${Date.now()}`.slice(0, 15);
    await page.fill('#project-name', projectName);
    await page.click('#project-modal-save');
    await expect(page.locator('#project-modal-overlay')).toBeHidden();

    // Create release in default project
    await navigateTo(page, 'releases');
    await page.click('#project-selector-btn');
    await page.click('#project-selector-options .custom-option:has-text("default")');
    const relName = `ScopedRel_${Date.now().toString().slice(-5)}`;
    await createRelease(page, { name: relName });

    // Switch to the new project and wait for the releases API to refresh.
    // The releases endpoint is /api/projects/{id}/releases, not /api/releases.
    const releasesLoad = page.waitForResponse(
      r => /\/projects\/\d+\/releases/.test(r.url()) && r.request().method() === 'GET'
    );
    await page.click('#project-selector-btn');
    await page.click(`#project-selector-options .custom-option:has-text("${projectName}")`);
    await releasesLoad;
    // Project B is brand new — it must have zero releases
    await expect(page.locator('.release-row')).toHaveCount(0);
  });

  test('release dropdown in issue modal is project-scoped', async ({ page }) => {
    // Create a second project
    await navigateTo(page, 'system-settings');
    await page.click('#add-project-btn');
    await expect(page.locator('#project-modal-overlay')).toBeVisible();
    const projectName = `scopeC_${Date.now()}`.slice(0, 15);
    await page.fill('#project-name', projectName);
    await page.click('#project-modal-save');
    await expect(page.locator('#project-modal-overlay')).toBeHidden();

    // Create release in default project
    await navigateTo(page, 'releases');
    await page.click('#project-selector-btn');
    await page.click('#project-selector-options .custom-option:has-text("default")');
    const relName = `ScopedDrop_${Date.now().toString().slice(-4)}`;
    await createRelease(page, { name: relName });

    // Switch to new project and open issue modal
    await page.click('#project-selector-btn');
    await page.click(`#project-selector-options .custom-option:has-text("${projectName}")`);
    await navigateTo(page, 'board');
    await page.click('#add-issue-btn');
    await expect(page.locator('#issue-modal')).toBeVisible();
    await page.click('#release-trigger');
    await expect(page.locator('#release-options')).not.toContainText(relName);
    await page.click('#cancel-btn');
  });
});

// ─── Owner Badge ──────────────────────────────────────────────────────────────

test.describe('Owner Badge', () => {
  test.beforeEach(async ({ page, login }) => {
    await login();
    await navigateTo(page, 'releases');
  });

  test('owner badge shows initials on card', async ({ page }) => {
    const name = `Badge_${Date.now().toString().slice(-6)}`;
    await createRelease(page, { name, ownerText: 'Assign to me' });

    const badge = page.locator(`.release-row:has-text("${name}") .release-owner-badge`);
    await expect(badge).toBeVisible();
    await expect(badge).not.toBeEmpty();
  });

  test('no badge shown when no owner set', async ({ page }) => {
    const name = `NoBadge_${Date.now().toString().slice(-6)}`;
    await createRelease(page, { name });

    await expect(page.locator(`.release-row:has-text("${name}") .release-owner-badge`)).toHaveCount(0);
  });
});

// ─── Visual State ─────────────────────────────────────────────────────────────

test.describe('Visual State', () => {
  test.beforeEach(async ({ page, login }) => {
    await login();
    await navigateTo(page, 'releases');
  });

  test('overdue release shows overdue indicator', async ({ page }) => {
    const name = `Overdue_${Date.now().toString().slice(-6)}`;
    // Past dates → overdue
    await createRelease(page, { name, startDate: '2024-01-01', releaseDate: '2024-01-31' });
    await expect(page.locator(`.release-row:has-text("${name}") .release-dates--overdue`)).toBeVisible();
  });

  test('release dates appear on card', async ({ page }) => {
    const name = `Dates_${Date.now().toString().slice(-6)}`;
    await createRelease(page, { name, startDate: '2027-01-01', releaseDate: '2027-06-30' });
    await expect(page.locator(`.release-row:has-text("${name}") .release-dates`)).toBeVisible();
    const datesText = await page.locator(`.release-row:has-text("${name}") .release-dates`).textContent();
    expect(datesText).toContain('→');
  });
});

// ─── Open Release Sort Order ─────────────────────────────────────────────────

test.describe('Open Release Sort Order', () => {
  test.beforeEach(async ({ page, login }) => {
    await login();
    await navigateTo(page, 'releases');
  });

  test('release with nearer planned date appears above one with a further date', async ({ page }) => {
    const near = `Near_${Date.now().toString().slice(-6)}`;
    const far  = `Far_${Date.now().toString().slice(-6)}`;
    await createRelease(page, { name: far,  releaseDate: '2028-12-01' });
    await createRelease(page, { name: near, releaseDate: '2027-01-01' });

    const names = await page.locator('.release-card-name').allTextContents();
    expect(names.indexOf(near)).toBeLessThan(names.indexOf(far));
  });

  test('release without a planned date appears below one with a date', async ({ page }) => {
    const dated   = `Dated_${Date.now().toString().slice(-6)}`;
    const undated = `Undated_${Date.now().toString().slice(-6)}`;
    await createRelease(page, { name: undated });
    await createRelease(page, { name: dated, releaseDate: '2027-06-01' });

    const names = await page.locator('.release-card-name').allTextContents();
    expect(names.indexOf(dated)).toBeLessThan(names.indexOf(undated));
  });
});

// ─── Role Authorization ───────────────────────────────────────────────────────

test.describe('Role Authorization – Releases', () => {
  test('regular user can view releases but not mutate', async ({ page, login }) => {
    await login();

    // Create a release as admin
    await navigateTo(page, 'releases');
    const relName = `UserView_${Date.now().toString().slice(-6)}`;
    await createRelease(page, { name: relName });

    // Create a regular user
    await navigateTo(page, 'system-settings');
    await page.click('#add-user-btn');
    const userEmail = `user_rel_${Date.now()}@example.com`;
    const userPassword = `RelTest1!${Date.now()}`;
    await page.fill('#user-email', userEmail);
    await page.fill('#user-first-name', 'Rel');
    await page.fill('#user-last-name', 'User');
    await page.fill('#user-password', userPassword);
    await page.click('#user-modal-save');
    await expect(page.locator('#user-modal-overlay')).toBeHidden();

    // Log out and in as the regular user
    await page.click('#user-menu-btn');
    await page.click('#user-menu-logout');
    await expect(page).toHaveURL(/\/login/);
    await page.fill('#login-email', userEmail);
    await page.fill('#login-password', userPassword);
    await page.click('#login-btn');
    await expect(page.locator('#nav-board')).toBeVisible();

    // Navigate to releases — card is visible, no create button, no trigger button
    await navigateTo(page, 'releases');
    await expect(page.locator(`.release-row:has-text("${relName}")`)).toBeVisible();
    await expect(page.locator('.release-add-btn')).toHaveCount(0);
    await expect(page.locator(`.release-row:has-text("${relName}") .release-trigger-btn`)).toHaveCount(0);
    // Card left is not clickable (no release-card-left--clickable class)
    await expect(
      page.locator(`.release-row:has-text("${relName}") .release-card-left`)
    ).not.toHaveClass(/release-card-left--clickable/);
  });
});
