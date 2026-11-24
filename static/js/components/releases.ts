import { createRelease, updateRelease, deleteRelease, triggerRelease, reopenRelease, fetchReleases } from '../api.ts';
import { loadIssues, ensureIssueLists, VIEW_ISSUE_LISTS } from '../issue-lists.ts';
import { sortReleasesByDate } from '../list-utils.ts';
import { byId, showNotification, loadFailureMessage, showLoadFailure, showListLoadFailure, showConfirm, escapeHtml, initCharCounter, updateDateInputStyle, getUserInitials, promptAdminPasswordConfirmation, localISODate, formatISODate, todayISO, onGuardedSubmit, bySelector, errorMessage, dateYearAccepted, containsTarget, sortByName, createOption } from '../utils.ts';
import { MAX_RELEASE_NAME_LEN, MAX_RELEASE_DESC_LEN } from '../validation-config.ts';
import { state, setReleases } from '../state.ts';
import type { Issue, Release, User } from '../models.ts';
import { userCan, ACTION_CREATE_RELEASE, ACTION_UPDATE_RELEASE, ACTION_DELETE_RELEASE, ACTION_TRIGGER_RELEASE } from '../permissions.ts';
import { getStatusLabel, STATUS_OPEN, STATUS_TODO, STATUS_STAGE1, STATUS_STAGE2, STATUS_STAGE3, STATUS_STAGE4, STATUS_DONE, STATUS_ARCHIVE, IN_PROGRESS_STATUSES } from '../status-config.ts';
import { RELEASE_STATUS_OPEN, RELEASE_STATUS_CLOSED, DEFAULT_PROJECT_ID } from '../domain-constants.ts';
import { updateReleaseFilterOptions } from './toolbar.ts';

let editingReleaseId: number | null = null;

// Issues assigned to a release can change status/release_id as a side effect of a release
// action on the backend (delete clears release_id, triggering can archive Done issues) —
// unlike the other release actions below, this can't be resolved from already-known data.
async function refreshIssuesAfterReleaseSideEffect(savedMessage: string) {
  await reportSavedAfter(loadIssues(VIEW_ISSUE_LISTS.releases), savedMessage, 'the issues');
}

// Reports a finished save once the data it changed has been reloaded. A failed reload is
// not reported as a failed save.
async function reportSavedAfter(reload: Promise<unknown>, savedMessage: string, reloaded: string) {
  try {
    await reload;
    showNotification(savedMessage, 'success');
  } catch (err) {
    showNotification(loadFailureMessage(`${savedMessage}, but ${reloaded}`, err), 'error');
  }
}

function mergeReleaseIntoState(updated: Release) {
  const idx = state.releases.findIndex(r => r.id === updated.id);
  if (idx !== -1) state.releases[idx] = updated;
}

function removeReleaseFromState(id: number) {
  const idx = state.releases.findIndex(r => r.id === id);
  if (idx !== -1) state.releases.splice(idx, 1);
}

export function setupReleasesView() {
  setupOwnerDropdown();

  initCharCounter(byId('release-modal-name', HTMLInputElement), MAX_RELEASE_NAME_LEN);
  initCharCounter(byId('release-modal-desc', HTMLTextAreaElement), MAX_RELEASE_DESC_LEN);

  ['release-modal-start', 'release-modal-date'].forEach(id => {
    const input = byId(id, HTMLInputElement);
    input.addEventListener('change', () => {
      updateDateInputStyle(input);
    });
  });

  byId('release-modal-cancel').addEventListener('click', closeReleaseModal);
  onGuardedSubmit(byId('release-form', HTMLFormElement), handleReleaseSubmit);

  if (userCan(state.currentUser, ACTION_DELETE_RELEASE)) {
    byId('release-modal-delete').addEventListener('click', async () => {
      const rel = state.releases.find(r => r.id === editingReleaseId);
      if (!rel) return;
      closeReleaseModal();
      await handleDeleteRelease(rel);
    });
  }

  if (userCan(state.currentUser, ACTION_TRIGGER_RELEASE)) {
    byId('release-modal-reopen').addEventListener('click', async () => {
      const rel = state.releases.find(r => r.id === editingReleaseId);
      if (!rel) return;
      const confirmed = await showConfirm(
        'Reopen Release',
        `Reopen release "${rel.name}"? The status will be set back to open. Issues that were archived when this release was closed are not automatically unarchived.`
      );
      if (!confirmed) return;
      closeReleaseModal();
      try {
        const updated = await reopenRelease(rel.project_id, rel.id);
        mergeReleaseIntoState(updated);
        showNotification('Release reopened', 'success');
        updateReleaseFilterOptions(state.releases);
        void renderReleasesView();
      } catch (err) {
        showNotification(errorMessage(err) || 'Failed to reopen release', 'error');
      }
    });
  }
}

function setupOwnerDropdown() {
  const wrapper = byId('release-owner-dropdown');
  const trigger = byId('release-owner-trigger', HTMLButtonElement);
  const options = byId('release-owner-options');

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (trigger.disabled) return;
    options.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!containsTarget(wrapper, e.target)) {
      options.classList.add('hidden');
    }
  });
}

export function renderReleaseOwnerOptions(users: User[]) {
  const container = byId('release-owner-options');
  container.innerHTML = '';

  container.appendChild(createOption('No Owner', () => selectReleaseOwner('', 'No Owner')));

  const me = state.currentUser;
  if (me) {
    container.appendChild(createOption('Assign to me', () => selectReleaseOwner(
      String(me.id),
      `${me.first_name} ${me.last_name}`
    )));
  }

  sortByName(users.filter(u => u.active && u.id !== state.currentUser?.id), u => `${u.first_name} ${u.last_name}`).forEach(user => {
    const name = `${user.first_name} ${user.last_name}`;
    container.appendChild(createOption(name, () => selectReleaseOwner(String(user.id), name)));
  });
}

function selectReleaseOwner(value: string, text: string) {
  byId('release-owner-input', HTMLInputElement).value = value;
  byId('release-owner-text').textContent = text;
  byId('release-owner-options').classList.add('hidden');
}

export async function renderReleasesView() {
  const container = byId('releases-view');

  try {
    await ensureIssueLists(VIEW_ISSUE_LISTS.releases);
  } catch (err) {
    showListLoadFailure(container, 'Releases', err); // their progress counts every issue
    return;
  }

  const ownerFilter = state.filter.releaseOwnerFilter;
  const searchTerm = state.filter.releaseSearch?.trim().toLowerCase();
  const releases = state.releases.filter(rel => {
    if (ownerFilter === 'me' && rel.owner_id !== state.currentUser?.id) return false;
    if (ownerFilter === 'unassigned' && rel.owner_id) return false;
    if (typeof ownerFilter === 'number' && rel.owner_id !== ownerFilter) return false;
    if (searchTerm) {
      const nameMatch = rel.name.toLowerCase().includes(searchTerm);
      const descMatch = rel.description?.toLowerCase().includes(searchTerm);
      if (!nameMatch && !descMatch) return false;
    }
    return true;
  });
  const openReleases = sortReleasesByDate(releases.filter(r => r.status === RELEASE_STATUS_OPEN));
  const closedReleases = releases.filter(r => r.status === RELEASE_STATUS_CLOSED)
    .sort((a, b) => new Date(b.closed_at ?? 0).getTime() - new Date(a.closed_at ?? 0).getTime());

  const totalOpen = state.releases.filter(r => r.status === RELEASE_STATUS_OPEN).length;
  const totalClosed = state.releases.filter(r => r.status === RELEASE_STATUS_CLOSED).length;

  container.innerHTML = '';
  container.appendChild(buildReleasesSection('Open Releases', openReleases, true, totalOpen));
  if (closedReleases.length > 0 || totalClosed > 0) {
    const divider = document.createElement('hr');
    divider.className = 'releases-divider';
    divider.setAttribute('aria-hidden', 'true');
    container.appendChild(divider);
    container.appendChild(buildReleasesSection('Closed Releases', closedReleases, false, totalClosed));
  }
}

function groupReleasesByMonth(releases: Release[]) {
  const groups: Record<string, Release[]> = {};
  releases.forEach(rel => {
    const date = new Date(rel.closed_at || rel.updated_at);
    const key = date.toLocaleDateString(navigator.language, { month: 'long', year: 'numeric' });
    if (!groups[key]) groups[key] = [];
    groups[key].push(rel);
  });
  return groups;
}

function appendReleaseRow(rel: Release, isOpenSection: boolean, list: Element) {
  const row = buildReleaseRow(rel, isOpenSection);
  if (userCan(state.currentUser, ACTION_UPDATE_RELEASE)) {
    bySelector(row, '.release-card-left').classList.add('release-card-left--clickable');
    bySelector(row, '.release-card-left').addEventListener('click', () => openReleaseModal(rel));
  }
  row.querySelector('.release-trigger-btn')?.addEventListener('click', () => handleTriggerReleaseDialog(rel));
  list.appendChild(row);
}

function buildReleasesSection(title: string, releases: Release[], isOpenSection: boolean, totalCount?: number) {
  const section = document.createElement('div');
  section.className = 'backlog-section';

  const addBtnHtml = isOpenSection && userCan(state.currentUser, ACTION_CREATE_RELEASE)
    ? `<button class="btn primary release-add-btn">+ Create Release</button>`
    : '';

  const countText = totalCount !== undefined && totalCount !== releases.length
    ? `${releases.length}/${totalCount}`
    : releases.length;

  section.innerHTML = `
    <div class="backlog-header">
      <h2>${title}</h2>
      <span class="count">${countText}</span>
      ${addBtnHtml}
    </div>
    <div class="backlog-list"></div>
  `;

  section.querySelector('.release-add-btn')?.addEventListener('click', () => openReleaseModal(null));

  const list = bySelector(section, '.backlog-list');

  if (releases.length === 0) {
    list.innerHTML = '<p class="releases-empty">No releases.</p>';
  } else if (isOpenSection) {
    releases.forEach(rel => appendReleaseRow(rel, isOpenSection, list));
  } else {
    const groups = groupReleasesByMonth(releases);
    let firstGroup = true;
    for (const [month, rels] of Object.entries(groups)) {
      const header = document.createElement('h3');
      header.className = 'archive-month-header';
      if (firstGroup) { header.style.marginTop = '8px'; firstGroup = false; }
      header.textContent = month;
      list.appendChild(header);
      rels.forEach(rel => appendReleaseRow(rel, isOpenSection, list));
    }
  }

  return section;
}

function applyModalButtons(release: Release | null, isClosed: boolean) {
  byId('release-modal-delete').classList.toggle('hidden', !release || !userCan(state.currentUser, ACTION_DELETE_RELEASE));
  byId('release-modal-reopen').classList.toggle('hidden', !isClosed || !userCan(state.currentUser, ACTION_TRIGGER_RELEASE));
  byId('release-modal-cancel').classList.toggle('hidden', isClosed);
  const saveBtn = byId('release-modal-save');
  saveBtn.classList.remove('hidden');
  saveBtn.textContent = isClosed ? 'Done' : 'Save';
}

function applyModalDateFields(release: Release | null, isClosed: boolean) {
  const startInput = byId('release-modal-start', HTMLInputElement);
  const dateInput = byId('release-modal-date', HTMLInputElement);

  byId('release-modal-closed-at-group').classList.toggle('hidden', !isClosed);
  if (isClosed && release?.closed_at) {
    const closedAtInput = byId('release-modal-closed-at', HTMLInputElement);
    closedAtInput.value = localISODate(new Date(release.closed_at)); // a timestamp, shown as its local day
    updateDateInputStyle(closedAtInput);
  }

  if (release) {
    startInput.value = release.start_date ?? '';
    dateInput.value = release.release_date ?? '';
  }
  updateDateInputStyle(startInput);
  updateDateInputStyle(dateInput);

  if (isClosed) {
    [startInput, dateInput].forEach(input => {
      if (!input.value) {
        const display = input.closest('.custom-date-input')?.querySelector('.custom-date-display');
        if (display) display.textContent = 'No date';
      }
    });
  }
}

function openReleaseModal(release: Release | null) {
  const overlay = byId('release-modal-overlay');
  const errorDisplay = byId('release-modal-error');
  const form = byId('release-form', HTMLFormElement);

  editingReleaseId = release ? release.id : null;
  const isClosed = release?.status === RELEASE_STATUS_CLOSED;

  byId('release-modal-title').textContent = release ? 'Release Details' : 'New Release';

  applyModalButtons(release, isClosed);

  form.reset();
  errorDisplay.classList.add('hidden');
  renderModalStats(release);

  form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input:not([data-permanent-readonly]), textarea')
    .forEach(el => { el.readOnly = isClosed; });

  byId('release-owner-trigger', HTMLButtonElement).disabled = isClosed;

  if (release) {
    byId('release-modal-name', HTMLInputElement).value = release.name;
    byId('release-modal-desc', HTMLTextAreaElement).value = release.description ?? '';
    const ownerText = release.owner
      ? `${release.owner.first_name} ${release.owner.last_name}`
      : 'No Owner';
    selectReleaseOwner(release.owner ? String(release.owner.id) : '', ownerText);
  } else {
    selectReleaseOwner('', 'No Owner');
  }

  applyModalDateFields(release, isClosed);

  overlay.classList.remove('hidden');
  if (!isClosed) byId('release-modal-name', HTMLInputElement).focus();
}

function closeReleaseModal() {
  editingReleaseId = null;
  byId('release-modal-overlay').classList.add('hidden');
}

async function handleReleaseSubmit() {
  const rel = editingReleaseId ? state.releases.find(r => r.id === editingReleaseId) : null;
  if (rel?.status === RELEASE_STATUS_CLOSED) { closeReleaseModal(); return; }

  const name = byId('release-modal-name', HTMLInputElement).value.trim();
  const desc = byId('release-modal-desc', HTMLTextAreaElement).value.trim();
  const startVal = byId('release-modal-start', HTMLInputElement).value;
  const dateVal = byId('release-modal-date', HTMLInputElement).value;
  const errorDisplay = byId('release-modal-error');

  if (!name) { showNotification('Release name is required.', 'error'); return; }
  if (!dateYearAccepted(startVal, 'Start date') || !dateYearAccepted(dateVal, 'Release date')) return;
  if (startVal && dateVal && dateVal < startVal) {
    showNotification('Release date must not be before start date.', 'error');
    return;
  }

  const ownerVal = byId('release-owner-input', HTMLInputElement).value;
  const owner_id = ownerVal ? Number.parseInt(ownerVal) : null;
  const payload = { name, description: desc, start_date: startVal || null, release_date: dateVal || null, owner_id };
  const projectId = state.selectedProjectId ?? DEFAULT_PROJECT_ID;
  const releaseId = editingReleaseId;
  try {
    if (releaseId) {
      const updated = await updateRelease(projectId, releaseId, payload);
      mergeReleaseIntoState(updated);
    } else {
      await createRelease(projectId, payload);
    }
  } catch (err) {
    errorDisplay.textContent = errorMessage(err) || 'Failed to save release.';
    errorDisplay.classList.remove('hidden');
    return;
  }
  closeReleaseModal();
  if (releaseId) {
    showNotification('Release updated', 'success');
  } else {
    // The create response isn't owner-hydrated, so re-fetch the release list instead.
    await reportSavedAfter(fetchReleases(projectId).then(setReleases), 'Release created', 'the releases');
  }
  updateReleaseFilterOptions(state.releases);
  void renderReleasesView();
}

function buildReleaseDateRange(rel: Release) {
  if (rel.status === RELEASE_STATUS_CLOSED && rel.closed_at) {
    return `<span class="release-dates">Released on ${new Date(rel.closed_at).toLocaleDateString(navigator.language)}</span>`;
  }
  const startStr = rel.start_date ? formatISODate(rel.start_date) : '';
  const relStr = rel.release_date ? formatISODate(rel.release_date) : '';
  if (!startStr && !relStr) return '';
  const isOverdue = rel.release_date && rel.release_date < todayISO() && rel.status === RELEASE_STATUS_OPEN;
  let relFormatted = '';
  if (relStr) relFormatted = isOverdue ? `<span class="release-dates--overdue">${relStr}</span>` : relStr;
  return `<span class="release-dates">${startStr} → ${relFormatted}</span>`;
}

function renderModalStats(release: Release | null) {
  const statsEl = byId('release-modal-stats');
  if (!release) {
    statsEl.classList.add('hidden');
    return;
  }
  const issues = state.issues.filter(i => i.release_id === release.id);
  const total = issues.length;
  const issueWord = total === 1 ? 'issue' : 'issues';
  const intro = total === 0 ? 'No issues assigned to this release.' : `${total} ${issueWord} assigned to this release:`;
  statsEl.innerHTML = `<div class="release-dialog-intro">${intro}</div>${buildStatusBreakdown(issues)}`;
  statsEl.classList.remove('hidden');
}

function buildReleaseRow(rel: Release, isOpen: boolean) {
  const issues = state.issues.filter(i => i.release_id === rel.id);
  const total = issues.length;
  const done = issues.filter(i => i.status === STATUS_DONE || i.status === STATUS_ARCHIVE).length;
  const inProgress = issues.filter(i => IN_PROGRESS_STATUSES.includes(i.status)).length;
  const donePct = total > 0 ? Math.round((done / total) * 100) : 0;
  const inProgPct = total > 0 ? Math.round((inProgress / total) * 100) : 0;

  const triggerHtml = isOpen && userCan(state.currentUser, ACTION_TRIGGER_RELEASE)
    ? `<button class="btn primary release-trigger-btn" data-id="${rel.id}">Release</button>`
    : '';
  // Closed releases' issues are mostly archived and won't show on the board, so the
  // board-navigation link would just be confusing there.
  const navIconHtml = isOpen
    ? `<span class="release-stats-nav-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="6" height="18" rx="1"/><circle cx="5" cy="7" r="0.7" fill="currentColor"/><circle cx="5" cy="11" r="0.7" fill="currentColor"/><rect x="9" y="3" width="6" height="18" rx="1"/><circle cx="12" cy="7" r="0.7" fill="currentColor"/><rect x="16" y="3" width="6" height="18" rx="1"/><circle cx="19" cy="7" r="0.7" fill="currentColor"/><circle cx="19" cy="11" r="0.7" fill="currentColor"/><circle cx="19" cy="15" r="0.7" fill="currentColor"/></svg></span>`
    : '';
  const descHtml = `<span class="release-card-desc">${escapeHtml(rel.description)}</span>`;
  const datesHtml = buildReleaseDateRange(rel);

  const ownerFullName = rel.owner ? escapeHtml(`${rel.owner.first_name} ${rel.owner.last_name}`) : '';
  const ownerBadgeHtml = rel.owner
    ? `<span class="user-badge release-owner-badge" title="Owner: ${ownerFullName}">${escapeHtml(getUserInitials(rel.owner))}</span>`
    : `<span class="release-badge-placeholder"></span>`;

  const row = document.createElement('div');
  row.className = 'release-row';
  row.innerHTML = `
    <div class="release-card-left">
      ${ownerBadgeHtml}
      <div class="release-card-content">
        <div class="release-card-title-group">
          <span class="backlog-card-title release-card-name">${escapeHtml(rel.name)}</span>
          ${descHtml}
        </div>
        <div class="backlog-card-right">
          ${datesHtml}
          <div class="release-progress-bar">
            <div class="release-progress-seg seg-done" style="width:${donePct}%"></div>
            <div class="release-progress-seg seg-inprogress" style="width:${inProgPct}%"></div>
          </div>
          <span class="release-count">${done}/${total}</span>
        </div>
      </div>
    </div>
    ${navIconHtml || triggerHtml ? `
    <div class="release-card-actions">
      ${navIconHtml}
      ${triggerHtml}
    </div>` : ''}
  `;
  row.querySelector('.release-stats-nav-icon')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.dispatchEvent(new CustomEvent('nav-to-release', { detail: { releaseId: rel.id } }));
  });
  return row;
}

async function handleDeleteRelease(rel: Release) {
  const confirmed = await promptAdminPasswordConfirmation(
    'Delete Release',
    `Do you really want to delete release "${rel.name}"?\nIssues assigned to this release will keep their data but lose the release assignment. This removal is not recorded in the issue's history log.`,
    async (adminPassword) => {
      await deleteRelease(rel.project_id, rel.id, adminPassword);
    },
    'Delete'
  );
  if (!confirmed) return;
  removeReleaseFromState(rel.id);
  // Deleting cascades release_id = NULL onto its issues server-side.
  await refreshIssuesAfterReleaseSideEffect('Release deleted');
  updateReleaseFilterOptions(state.releases);
  void renderReleasesView();
}

async function handleTriggerReleaseDialog(rel: Release) {
  try {
    await ensureIssueLists(VIEW_ISSUE_LISTS.releases);
  } catch (err) {
    showLoadFailure('The issues of the release', err);
    return false;
  }
  const issues = state.issues.filter(i => i.release_id === rel.id);
  const total = issues.length;
  const done = issues.filter(i => i.status === STATUS_DONE).length;
  const notDone = issues.filter(i => i.status !== STATUS_DONE && i.status !== STATUS_ARCHIVE).length;

  return new Promise<boolean>(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const statusBreakdown = buildStatusBreakdown(issues);
    const warningHtml = notDone > 0
      ? `<div class="release-dialog-warning">⚠ There are unfinished issues. Are you sure to release?</div>`
      : '';

    const issueWord = total === 1 ? 'issue' : 'issues';
    overlay.innerHTML = `
      <div class="release-dialog">
        <div class="release-dialog-header">
          <h2>Release ${escapeHtml(rel.name)}</h2>
        </div>
        <div class="release-dialog-body">
          <div class="release-dialog-section">
            <div class="release-dialog-intro">${total === 0 ? 'No issues are assigned to this release.' : `${total} ${issueWord} belong to this release:`}</div>
            ${statusBreakdown}
            ${warningHtml}
          </div>
          <div class="release-dialog-section">
            <div class="release-dialog-intro">Optionally archive finished issues when releasing:</div>
            <label class="release-archive-label">
              <input type="checkbox" id="release-archive-done" ${done === 0 ? 'disabled' : ''}>
              <span>Archive all Done issues</span>
            </label>
          </div>
          <div class="form-actions">
            <button class="btn secondary" id="release-dialog-cancel">Cancel</button>
            <button class="btn primary" id="release-dialog-confirm">Confirm Release</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    bySelector(overlay, '#release-dialog-cancel').addEventListener('click', () => {
      overlay.remove();
      resolve(false);
    });

    bySelector(overlay, '#release-dialog-confirm').addEventListener('click', async () => {
      const archiveDone = bySelector(overlay, '#release-archive-done', HTMLInputElement).checked;
      overlay.remove();
      try {
        const updated = await triggerRelease(rel.project_id, rel.id, archiveDone);
        mergeReleaseIntoState(updated);
        // Triggering can archive this release's Done issues server-side.
        await refreshIssuesAfterReleaseSideEffect('Release closed');
        updateReleaseFilterOptions(state.releases);
        void renderReleasesView();
      } catch (err) {
        showNotification(errorMessage(err) || 'Failed to release', 'error');
      }
      resolve(true);
    });
  });
}

// string[]: it is searched with the keys of Object.entries.
const STATUS_ORDER: readonly string[] = [STATUS_OPEN, STATUS_TODO, STATUS_STAGE1, STATUS_STAGE2, STATUS_STAGE3, STATUS_STAGE4, STATUS_DONE, STATUS_ARCHIVE];

function buildStatusBreakdown(issues: Issue[]) {
  if (issues.length === 0) return '';
  const counts: Record<string, number> = {};
  issues.forEach(i => { counts[i.status] = (counts[i.status] ?? 0) + 1; });
  return Object.entries(counts)
    .sort(([a], [b]) => {
      const ai = STATUS_ORDER.indexOf(a);
      const bi = STATUS_ORDER.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    })
    .map(([status, count]) => `<div class="release-stat-row"><span class="release-stat-name">${escapeHtml(getStatusLabel(status))}</span><span class="release-stat-count">${count}</span></div>`)
    .join('');
}
