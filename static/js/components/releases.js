import { createRelease, updateRelease, deleteRelease, triggerRelease, reopenRelease, fetchArchivedIssuesByProject, fetchOpenIssuesByProject } from '../api.js';
import { showNotification, showConfirm, escapeHtml, initCharCounter, updateDateInputStyle, getUserInitials } from '../utils.js';
import { MAX_RELEASE_NAME_LEN, MAX_RELEASE_DESC_LEN } from '../validation-config.js';
import { state } from '../state.js';
import { userCan, ACTION_CREATE_RELEASE, ACTION_UPDATE_RELEASE, ACTION_DELETE_RELEASE, ACTION_TRIGGER_RELEASE } from '../permissions.js';
import { getStatusLabel } from '../status-config.js';

let refreshCallback = null;
let editingReleaseId = null;
let cachedAllIssues = null;

export function invalidateReleaseIssueCache() {
  cachedAllIssues = null;
}

export async function setupReleasesView(callback) {
  refreshCallback = callback;

  setupOwnerDropdown();

  const cancelBtn = document.getElementById('release-modal-cancel');
  const form = document.getElementById('release-form');
  const nameInput = document.getElementById('release-modal-name');
  const descInput = document.getElementById('release-modal-desc');

  if (nameInput) initCharCounter(nameInput, MAX_RELEASE_NAME_LEN);
  if (descInput) initCharCounter(descInput, MAX_RELEASE_DESC_LEN);

  ['release-modal-start', 'release-modal-date'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', (e) => {
      updateDateInputStyle(e.target);
    });
  });

  cancelBtn?.addEventListener('click', closeReleaseModal);
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleReleaseSubmit();
  });

  const deleteBtn = document.getElementById('release-modal-delete');
  if (deleteBtn && userCan(state.currentUser, ACTION_DELETE_RELEASE)) {
    deleteBtn.addEventListener('click', async () => {
      const rel = state.releases.find(r => r.id === editingReleaseId);
      if (!rel) return;
      closeReleaseModal();
      await handleDeleteRelease(rel);
    });
  }

  const reopenBtn = document.getElementById('release-modal-reopen');
  if (reopenBtn && userCan(state.currentUser, ACTION_TRIGGER_RELEASE)) {
    reopenBtn.addEventListener('click', async () => {
      const rel = state.releases.find(r => r.id === editingReleaseId);
      if (!rel) return;
      const confirmed = await showConfirm(
        'Reopen Release',
        `Reopen release "${rel.name}"? The status will be set back to open. Issues that were archived when this release was closed are not automatically unarchived.`
      );
      if (!confirmed) return;
      closeReleaseModal();
      try {
        await reopenRelease(rel.id);
        showNotification('Release reopened', 'success');
        if (refreshCallback) refreshCallback();
      } catch (err) {
        showNotification(err.message || 'Failed to reopen release', 'error');
      }
    });
  }
}

function setupOwnerDropdown() {
  const wrapper = document.getElementById('release-owner-dropdown');
  const trigger = document.getElementById('release-owner-trigger');
  const options = document.getElementById('release-owner-options');
  if (!trigger || !options) return;

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (trigger.disabled) return;
    options.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (wrapper && !wrapper.contains(e.target)) {
      options.classList.add('hidden');
    }
  });
}

export function renderReleaseOwnerOptions(users) {
  const container = document.getElementById('release-owner-options');
  if (!container) return;
  container.innerHTML = '';

  const noOwnerDiv = document.createElement('div');
  noOwnerDiv.className = 'custom-option';
  noOwnerDiv.textContent = 'No Owner';
  noOwnerDiv.addEventListener('click', () => selectReleaseOwner('', 'No Owner'));
  container.appendChild(noOwnerDiv);

  if (state.currentUser) {
    const meDiv = document.createElement('div');
    meDiv.className = 'custom-option';
    meDiv.textContent = 'Assign to me';
    meDiv.addEventListener('click', () => selectReleaseOwner(
      String(state.currentUser.id),
      `${state.currentUser.first_name} ${state.currentUser.last_name}`
    ));
    container.appendChild(meDiv);
  }

  users.filter(u => u.active && u.id !== state.currentUser?.id).forEach(user => {
    const div = document.createElement('div');
    div.className = 'custom-option';
    div.textContent = `${user.first_name} ${user.last_name}`;
    div.addEventListener('click', () => selectReleaseOwner(String(user.id), `${user.first_name} ${user.last_name}`));
    container.appendChild(div);
  });
}

function selectReleaseOwner(value, text) {
  const input = document.getElementById('release-owner-input');
  const display = document.getElementById('release-owner-text');
  const options = document.getElementById('release-owner-options');
  if (input) input.value = value;
  if (display) display.textContent = text;
  options?.classList.add('hidden');
}

async function refreshIssueCache() {
  const projectId = state.selectedProjectId ?? 1;
  const [archived, open] = await Promise.all([
    fetchArchivedIssuesByProject(projectId),
    fetchOpenIssuesByProject(projectId),
  ]);
  const seen = new Set();
  cachedAllIssues = [...archived, ...open, ...state.issues].filter(i => {
    if (seen.has(i.id)) return false;
    seen.add(i.id);
    return true;
  });
}

export async function renderReleasesView(forceRefresh = false) {
  const container = document.getElementById('releases-view');
  if (!container) return;

  if (!cachedAllIssues || forceRefresh) await refreshIssueCache();
  const allIssues = cachedAllIssues;

  const ownerFilter = state.filter.releaseOwnerFilter;
  const searchTerm = state.filter.releaseSearch?.trim().toLowerCase();
  const releases = state.releases.filter(rel => {
    if (ownerFilter === 'me' && rel.owner_id !== state.currentUser?.id) return false;
    if (ownerFilter === 'unassigned' && rel.owner_id) return false;
    if (ownerFilter && ownerFilter !== 'me' && ownerFilter !== 'unassigned') {
      if (rel.owner_id !== Number.parseInt(ownerFilter)) return false;
    }
    if (searchTerm) {
      const nameMatch = rel.name.toLowerCase().includes(searchTerm);
      const descMatch = rel.description?.toLowerCase().includes(searchTerm);
      if (!nameMatch && !descMatch) return false;
    }
    return true;
  });
  const openReleases = releases.filter(r => r.status === 'open');
  const closedReleases = releases.filter(r => r.status === 'closed')
    .sort((a, b) => new Date(b.closed_at) - new Date(a.closed_at));

  const totalOpen = state.releases.filter(r => r.status === 'open').length;
  const totalClosed = state.releases.filter(r => r.status === 'closed').length;

  container.innerHTML = '';
  container.appendChild(buildReleasesSection('Open Releases', openReleases, true, allIssues, totalOpen));
  if (closedReleases.length > 0 || totalClosed > 0) {
    const divider = document.createElement('hr');
    divider.className = 'releases-divider';
    divider.setAttribute('aria-hidden', 'true');
    container.appendChild(divider);
    container.appendChild(buildReleasesSection('Closed Releases', closedReleases, false, allIssues, totalClosed));
  }
}

function groupReleasesByMonth(releases) {
  const groups = {};
  releases.forEach(rel => {
    const date = new Date(rel.closed_at || rel.updated_at);
    const key = date.toLocaleDateString(navigator.language, { month: 'long', year: 'numeric' });
    if (!groups[key]) groups[key] = [];
    groups[key].push(rel);
  });
  return groups;
}

function appendReleaseRow(rel, isOpenSection, allIssues, list) {
  const row = buildReleaseRow(rel, isOpenSection, allIssues);
  if (userCan(state.currentUser, ACTION_UPDATE_RELEASE)) {
    row.querySelector('.release-card-left').classList.add('release-card-left--clickable');
    row.querySelector('.release-card-left').addEventListener('click', () => openReleaseModal(rel));
  }
  row.querySelector('.release-trigger-btn')?.addEventListener('click', () => handleTriggerReleaseDialog(rel));
  list.appendChild(row);
}

function buildReleasesSection(title, releases, isOpenSection, allIssues, totalCount) {
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

  const list = section.querySelector('.backlog-list');

  if (releases.length === 0) {
    list.innerHTML = '<p class="releases-empty">No releases.</p>';
  } else if (isOpenSection) {
    releases.forEach(rel => appendReleaseRow(rel, isOpenSection, allIssues, list));
  } else {
    const groups = groupReleasesByMonth(releases);
    let firstGroup = true;
    for (const [month, rels] of Object.entries(groups)) {
      const header = document.createElement('h3');
      header.className = 'archive-month-header';
      if (firstGroup) { header.style.marginTop = '8px'; firstGroup = false; }
      header.textContent = month;
      list.appendChild(header);
      rels.forEach(rel => appendReleaseRow(rel, isOpenSection, allIssues, list));
    }
  }

  return section;
}

function applyModalButtons(release, isClosed) {
  document.getElementById('release-modal-delete')
    ?.classList.toggle('hidden', !release || !userCan(state.currentUser, ACTION_DELETE_RELEASE));
  document.getElementById('release-modal-reopen')
    ?.classList.toggle('hidden', !isClosed || !userCan(state.currentUser, ACTION_TRIGGER_RELEASE));
  document.getElementById('release-modal-cancel')
    ?.classList.toggle('hidden', isClosed);
  const saveBtn = document.getElementById('release-modal-save');
  if (saveBtn) { saveBtn.classList.remove('hidden'); saveBtn.textContent = isClosed ? 'Done' : 'Save'; }
}

function applyModalDateFields(release, isClosed) {
  const toDateInput = v => v ? new Date(v).toISOString().slice(0, 10) : '';
  const startInput = document.getElementById('release-modal-start');
  const dateInput = document.getElementById('release-modal-date');

  const closedAtGroup = document.getElementById('release-modal-closed-at-group');
  closedAtGroup?.classList.toggle('hidden', !isClosed);
  if (isClosed && release?.closed_at) {
    const closedAtInput = document.getElementById('release-modal-closed-at');
    closedAtInput.value = new Date(release.closed_at).toISOString().slice(0, 10);
    updateDateInputStyle(closedAtInput);
  }

  if (release) {
    startInput.value = toDateInput(release.start_date);
    dateInput.value = toDateInput(release.release_date);
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

function openReleaseModal(release) {
  const overlay = document.getElementById('release-modal-overlay');
  const errorDisplay = document.getElementById('release-modal-error');
  const form = document.getElementById('release-form');
  if (!overlay) return;

  editingReleaseId = release ? release.id : null;
  const isClosed = release?.status === 'closed';

  const title = document.getElementById('release-modal-title');
  if (title) title.textContent = release ? 'Release Details' : 'New Release';

  applyModalButtons(release, isClosed);

  form?.reset();
  errorDisplay?.classList.add('hidden');
  renderModalStats(release);

  form?.querySelectorAll('input:not([data-permanent-readonly]), textarea')
    .forEach(el => { el.readOnly = isClosed; });

  const ownerTrigger = document.getElementById('release-owner-trigger');
  if (ownerTrigger) ownerTrigger.disabled = isClosed;

  if (release) {
    document.getElementById('release-modal-name').value = release.name;
    document.getElementById('release-modal-desc').value = release.description ?? '';
    const ownerText = release.owner
      ? `${release.owner.first_name} ${release.owner.last_name}`
      : 'No Owner';
    selectReleaseOwner(release.owner ? String(release.owner.id) : '', ownerText);
  } else {
    selectReleaseOwner('', 'No Owner');
  }

  applyModalDateFields(release, isClosed);

  overlay.classList.remove('hidden');
  if (!isClosed) document.getElementById('release-modal-name')?.focus();
}

function closeReleaseModal() {
  editingReleaseId = null;
  document.getElementById('release-modal-overlay')?.classList.add('hidden');
}

async function handleReleaseSubmit() {
  const rel = editingReleaseId ? state.releases.find(r => r.id === editingReleaseId) : null;
  if (rel?.status === 'closed') { closeReleaseModal(); return; }

  const name = document.getElementById('release-modal-name')?.value.trim();
  const desc = document.getElementById('release-modal-desc')?.value.trim() ?? '';
  const startVal = document.getElementById('release-modal-start')?.value;
  const dateVal = document.getElementById('release-modal-date')?.value;
  const errorDisplay = document.getElementById('release-modal-error');

  if (!name) { showNotification('Release name is required.', 'error'); return; }
  if (startVal && dateVal && dateVal < startVal) {
    showNotification('Release date must not be before start date.', 'error');
    return;
  }

  const toISO = v => v ? `${v}T00:00:00Z` : null;
  const ownerVal = document.getElementById('release-owner-input')?.value;
  const owner_id = ownerVal ? Number.parseInt(ownerVal) : null;
  const payload = { name, description: desc, start_date: toISO(startVal), release_date: toISO(dateVal), owner_id };
  try {
    const projectId = state.selectedProjectId ?? 1;
    const isEdit = !!editingReleaseId;
    if (isEdit) {
      await updateRelease(editingReleaseId, payload);
    } else {
      await createRelease(projectId, payload);
    }
    closeReleaseModal();
    showNotification(isEdit ? 'Release updated' : 'Release created', 'success');
    if (refreshCallback) refreshCallback();
  } catch (err) {
    if (errorDisplay) {
      errorDisplay.textContent = err.message || 'Failed to save release.';
      errorDisplay.classList.remove('hidden');
    }
  }
}

function buildReleaseDateRange(rel) {
  if (rel.status === 'closed' && rel.closed_at) {
    return `<span class="release-dates">Released on ${new Date(rel.closed_at).toLocaleDateString(navigator.language)}</span>`;
  }
  const startStr = rel.start_date ? new Date(rel.start_date).toLocaleDateString(navigator.language) : '';
  const releaseDate = rel.release_date ? new Date(rel.release_date) : null;
  const relStr = releaseDate ? releaseDate.toLocaleDateString(navigator.language) : '';
  if (!startStr && !relStr) return '';
  const isOverdue = releaseDate && releaseDate < new Date() && rel.status === 'open';
  let relFormatted = '';
  if (relStr) relFormatted = isOverdue ? `<span class="release-dates--overdue">${relStr}</span>` : relStr;
  return `<span class="release-dates">${startStr} → ${relFormatted}</span>`;
}

function renderModalStats(release) {
  const statsEl = document.getElementById('release-modal-stats');
  if (!statsEl) return;
  if (!release || !cachedAllIssues) {
    statsEl.classList.add('hidden');
    return;
  }
  const issues = cachedAllIssues.filter(i => i.release_id === release.id);
  const total = issues.length;
  const issueWord = total === 1 ? 'issue' : 'issues';
  const intro = total === 0 ? 'No issues assigned to this release.' : `${total} ${issueWord} assigned to this release:`;
  statsEl.innerHTML = `<div class="release-dialog-intro">${intro}</div>${buildStatusBreakdown(issues)}`;
  statsEl.classList.remove('hidden');
}

function buildReleaseRow(rel, isOpen, allIssues) {
  const issues = allIssues.filter(i => i.release_id === rel.id);
  const total = issues.length;
  const done = issues.filter(i => i.status === 'Done' || i.status === 'Archive').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const triggerHtml = isOpen && userCan(state.currentUser, ACTION_TRIGGER_RELEASE)
    ? `<button class="btn primary btn--sm release-trigger-btn" data-id="${rel.id}">Release</button>`
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
          <div class="release-progress-bar"><div class="release-progress-fill" style="width:${pct}%"></div></div>
          <span class="release-count">${done}/${total}</span>
        </div>
      </div>
    </div>
    <div class="release-card-actions">
      <span class="release-stats-nav-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="6" height="18" rx="1"/><circle cx="5" cy="7" r="0.7" fill="currentColor"/><circle cx="5" cy="11" r="0.7" fill="currentColor"/><rect x="9" y="3" width="6" height="18" rx="1"/><circle cx="12" cy="7" r="0.7" fill="currentColor"/><rect x="16" y="3" width="6" height="18" rx="1"/><circle cx="19" cy="7" r="0.7" fill="currentColor"/><circle cx="19" cy="11" r="0.7" fill="currentColor"/><circle cx="19" cy="15" r="0.7" fill="currentColor"/></svg></span>
      ${triggerHtml}
    </div>
  `;
  row.querySelector('.release-stats-nav-icon').addEventListener('click', (e) => {
    e.stopPropagation();
    document.dispatchEvent(new CustomEvent('nav-to-release', { detail: { releaseId: rel.id } }));
  });
  return row;
}

async function handleDeleteRelease(rel) {
  const confirmed = await showConfirm(
    'Delete Release',
    `Delete release "${rel.name}"? Issues assigned to this release will keep their data but lose the release assignment.`
  );
  if (!confirmed) return;
  try {
    await deleteRelease(rel.id);
    showNotification('Release deleted', 'success');
    if (refreshCallback) refreshCallback();
  } catch (err) {
    showNotification(err.message || 'Failed to delete release', 'error');
  }
}

async function handleTriggerReleaseDialog(rel) {
  if (!cachedAllIssues) await refreshIssueCache();
  const issues = cachedAllIssues.filter(i => i.release_id === rel.id);
  const total = issues.length;
  const done = issues.filter(i => i.status === 'Done').length;
  const notDone = issues.filter(i => i.status !== 'Done' && i.status !== 'Archive').length;

  return new Promise(resolve => {
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

    overlay.querySelector('#release-dialog-cancel').addEventListener('click', () => {
      overlay.remove();
      resolve(false);
    });

    overlay.querySelector('#release-dialog-confirm').addEventListener('click', async () => {
      const archiveDone = overlay.querySelector('#release-archive-done').checked;
      overlay.remove();
      try {
        await triggerRelease(rel.id, archiveDone);
        showNotification('Release closed', 'success');
        if (refreshCallback) refreshCallback();
      } catch (err) {
        showNotification(err.message || 'Failed to release', 'error');
      }
      resolve(true);
    });
  });
}

const STATUS_ORDER = ['Open', 'Todo', 'Stage1', 'Stage2', 'Stage3', 'Stage4', 'Done', 'Archive'];

function buildStatusBreakdown(issues) {
  if (issues.length === 0) return '';
  const counts = {};
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
