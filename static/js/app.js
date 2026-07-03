import { fetchActiveIssuesByProject, fetchLabelsByProject, fetchVersion, fetchCurrentUser, fetchUsers, fetchProjects, fetchStatusConfig, fetchReleases } from './api.js';
import { renderMarkdown } from './markdown.js';
import { state, setIssues, setFilterSearch, setCurrentUser, setStatusConfig, setReleases, setFilterRelease, setFilterReleaseOwner, setFilterReleaseSearch } from './state.js';
import { renderBoard, setupBoardView } from './components/board.js';
import { renderBacklog, setupBacklogView, resetOpenLoaded } from './components/backlog.js';
import { renderPlanningPanel, setupPlanningPanel } from './components/planning.js';
import { renderArchive, setupArchiveView, resetArchivedLoaded } from './components/archive.js';
import { setupSystemSettingsView, renderSystemSettingsView } from './components/system-settings.js';
import { setupProjectSettingsView, renderProjectSettingsView } from './components/project-settings.js';
import { setupReleasesView, renderReleasesView, invalidateReleaseIssueCache, renderReleaseOwnerOptions } from './components/releases.js';
import { setupModal, openModal } from './components/modal.js';
import { debounce } from './utils.js';
import { STATUS_OPEN } from './status-config.js';
import { initLabelFilter, updateLabelFilterOptions, initPriorityFilter, updatePriorityFilterOptions, initUserFilter, updateUserFilterOptions, initReleaseFilter, updateReleaseFilterOptions, setupUserMenu, initProjectSelector, updateProjectSelectorOptions } from './components/toolbar.js';

// DOM Elements
const navBoard = document.getElementById('nav-board');
const navArchive = document.getElementById('nav-archive');
const navBacklog = document.getElementById('nav-backlog');
const navSystemSettings = document.getElementById('nav-system-settings');
const navProjectSettings = document.getElementById('nav-project-settings');
const navReleases = document.getElementById('nav-releases');
const boardView = document.querySelector('.board');
const archiveView = document.getElementById('archive-view');
const backlogView = document.getElementById('backlog-view');
const releasesView = document.getElementById('releases-view');
const systemSettingsView = document.getElementById('system-settings-view');
const projectSettingsView = document.getElementById('project-settings-view');
const sidebar = document.querySelector('.sidebar');
const filterContainer = document.getElementById('filter-container');
const projectSelectorContainer = document.getElementById('project-selector-container');
const toolbar = document.querySelector('.toolbar');
const searchInput = document.getElementById('search-input');
const releaseSearchInput = document.getElementById('release-search-input');

let cachedUsers = [];
let cachedLabels = [];


document.addEventListener('DOMContentLoaded', () => {
    init();
});

async function init() {
    // Check authentication before anything else
    const user = await fetchCurrentUser();
    if (!user) {
        globalThis.location.href = '/login';
        return;
    }
    setCurrentUser(user);
    // Hide System Settings nav for non-sysadmin users
    if (user.role !== 'sysadmin') {
        navSystemSettings.classList.add('hidden');
    }
    // Hide Project Settings nav for user role
    if (user.role === 'user') {
        navProjectSettings.classList.add('hidden');
    }

    setupEventListeners();
    initLabelFilter(rerenderActiveView);
    initPriorityFilter(rerenderActiveView);
    initUserFilter(rerenderActiveView);
    initReleaseFilter(rerenderActiveView);
    initProjectSelector(refreshApp);
    setupBoardView(refreshApp, openModal, rerenderActiveView);
    setupBacklogView(refreshApp, openModal, rerenderActiveView);
    setupArchiveView(refreshApp, openModal, rerenderActiveView);
    setupPlanningPanel(refreshApp, openModal, rerenderActiveView);
    setupSystemSettingsView(refreshApp);
    setupProjectSettingsView();
    setupReleasesView();
    setupModal(refreshApp, rerenderAfterIssueChange);
    setupUserMenu(user);

    // Fetch and display version
    fetchVersion().then(version => {
        const versionEl = document.getElementById('app-version');
        if (versionEl) {
            versionEl.textContent = 'v' + version;
        }
    });

    await refreshApp();

    // Pre-warm marked + DOMPurify so the first modal open is fast.
    // Deferred via setTimeout so the initial page paint is not delayed.
    setTimeout(() => renderMarkdown('a'), 0);
}

async function loadStatusConfig() {
    const id = state.selectedProjectId;
    try {
        setStatusConfig(id ? await fetchStatusConfig(id) : null);
    } catch (err) {
        console.warn('Failed to load status config, using defaults:', err);
        setStatusConfig(null);
    }
}

async function refreshApp() {
    try {
        await loadStatusConfig();

        // Reset lazy-load flags so we fetch fresh data on next view switch
        resetArchivedLoaded();
        resetOpenLoaded();
        invalidateReleaseIssueCache();

        const [issues, labels, releases, users, projects] = await Promise.all([
            fetchActiveIssuesByProject(state.selectedProjectId),
            state.selectedProjectId ? fetchLabelsByProject(state.selectedProjectId) : Promise.resolve([]),
            state.selectedProjectId ? fetchReleases(state.selectedProjectId) : Promise.resolve([]),
            fetchUsers(),
            fetchProjects(),
        ]);

        setIssues(issues);

        cachedLabels = labels;
        updateLabelFilterOptions(labels);

        setReleases(releases);
        updateReleaseFilterOptions(releases);

        cachedUsers = users;
        const isReleasesView = releasesView && !releasesView.classList.contains('hidden');
        updateUserFilterOptions(cachedUsers, isReleasesView ? 'releases' : 'issues');
        if (isReleasesView) renderReleaseOwnerOptions(cachedUsers);

        updateProjectSelectorOptions(projects);

        // Priority filter options are static/local so we might not strictly need to call update here unless we want to ensure sync,
        // but let's do it to be safe if we add dynamic priorities later or reset logic.
        updatePriorityFilterOptions();

        renderBoard(refreshApp, openModal, rerenderActiveView);
        if (!backlogView.classList.contains('hidden')) {
            await renderBacklog(refreshApp, openModal, rerenderActiveView);
        }
        if (!archiveView.classList.contains('hidden')) {
            await renderArchive(refreshApp, openModal, rerenderActiveView);
        }
        if (projectSettingsView && !projectSettingsView.classList.contains('hidden')) {
            await renderProjectSettingsView();
        }
        if (releasesView && !releasesView.classList.contains('hidden')) {
            renderReleasesView();
        }
        renderPlanningPanel();
    } catch (err) {
        console.error('Failed to refresh app:', err);
    }
}

// Re-renders whatever view is currently visible from already-loaded state, with zero API calls.
function rerenderActiveView() {
    // The label/user/release filter buttons only rebuild their "selected + clear icon"
    // display as a side effect of these calls, so a filter change must still trigger them —
    // just reusing already-cached data instead of re-fetching it.
    updateLabelFilterOptions(cachedLabels);
    updateReleaseFilterOptions(state.releases);
    const isReleasesView = releasesView && !releasesView.classList.contains('hidden');
    updateUserFilterOptions(cachedUsers, isReleasesView ? 'releases' : 'issues');

    renderBoard();
    if (!backlogView.classList.contains('hidden')) {
        renderBacklog();
    }
    if (!archiveView.classList.contains('hidden')) {
        renderArchive();
    }
    if (projectSettingsView && !projectSettingsView.classList.contains('hidden')) {
        renderProjectSettingsView();
    }
    if (isReleasesView) {
        renderReleasesView();
    }
    renderPlanningPanel();
}

// Used by the issue modal: state.currentIssue is a separate object from its state.issues
// entry (fetched independently), so field/task edits made in the modal must be merged back
// before the board/planning panel behind the modal re-render.
function rerenderAfterIssueChange() {
    if (state.currentIssue) {
        const idx = state.issues.findIndex(i => i.id === state.currentIssue.id);
        if (idx !== -1) state.issues[idx] = { ...state.issues[idx], ...state.currentIssue };
    }
    renderBoard();
    renderPlanningPanel();
}

function setupEventListeners() {
    // Navigation
    navBoard.addEventListener('click', () => switchView('board'));
    navArchive.addEventListener('click', () => switchView('archive'));
    navBacklog.addEventListener('click', () => switchView('backlog'));
    navSystemSettings.addEventListener('click', () => switchView('system-settings'));
    navProjectSettings.addEventListener('click', () => switchView('project-settings'));
    navReleases.addEventListener('click', () => switchView('releases'));

    // New Issue Btn
    document.getElementById('add-issue-btn').addEventListener('click', () => openModal(null));

    // Issue search
    if (searchInput) {
        searchInput.addEventListener('input', debounce((e) => {
            setFilterSearch(e.target.value);
            rerenderActiveView();
        }, 300));
    }

    // Release search
    if (releaseSearchInput) {
        releaseSearchInput.addEventListener('input', debounce((e) => {
            setFilterReleaseSearch(e.target.value);
            renderReleasesView();
        }, 300));
    }

    // Custom Events
    document.addEventListener('nav-to-release', (e) => {
        setFilterRelease(e.detail.releaseId);
        switchView('board');
    });

    document.addEventListener('nav-to-issue', (e) => {
        const issueId = e.detail.issueId;
        const issue = state.issues.find(i => i.id === issueId);
        if (issue) {
            if (issue.status === STATUS_OPEN && backlogView.classList.contains('hidden')) {
                switchView('backlog');
            } else if (issue.status !== STATUS_OPEN && boardView.classList.contains('hidden')) {
                switchView('board');
            }
            setTimeout(() => highlightIssueCard(issue.id), 100);
        }
    });
}

const VIEW_CONFIG = {
    'board':           { el: boardView,           nav: navBoard,           hideSidebar: false, hideFilter: false, hideProjectSelector: false, systemSettings: false, onEnter: () => refreshApp() },
    'backlog':         { el: backlogView,          nav: navBacklog,         hideSidebar: true,  hideFilter: false, hideProjectSelector: false, systemSettings: false, onEnter: () => refreshApp() },
    'archive':         { el: archiveView,          nav: navArchive,         hideSidebar: true,  hideFilter: false, hideProjectSelector: false, systemSettings: false, onEnter: () => refreshApp() },
    'releases':        { el: releasesView,         nav: navReleases,        hideSidebar: true,  hideFilter: false, hideProjectSelector: false, systemSettings: false, onEnter: () => renderReleasesView() },
    'project-settings':{ el: projectSettingsView,  nav: navProjectSettings, hideSidebar: true,  hideFilter: true,  hideProjectSelector: false, systemSettings: false, onEnter: () => renderProjectSettingsView() },
    'system-settings': { el: systemSettingsView,   nav: navSystemSettings,  hideSidebar: true,  hideFilter: true,  hideProjectSelector: true,  systemSettings: true,  onEnter: () => renderSystemSettingsView(refreshApp) },
};

function applyReleaseFilterVisibility(isReleases) {
    document.getElementById('label-filter-wrapper')?.classList.toggle('hidden', isReleases);
    document.getElementById('priority-filter-wrapper')?.classList.toggle('hidden', isReleases);
    document.getElementById('release-filter-wrapper')?.classList.toggle('hidden', isReleases);
    document.getElementById('search-filter-wrapper')?.classList.toggle('hidden', isReleases);
    document.getElementById('release-search-wrapper')?.classList.toggle('hidden', !isReleases);
}

function switchView(view) {
    const cfg = VIEW_CONFIG[view];
    if (!cfg) return;

    Object.values(VIEW_CONFIG).forEach(c => { c.el?.classList.add('hidden'); c.nav?.classList.remove('active'); });

    cfg.el.classList.remove('hidden');
    cfg.nav.classList.add('active');
    sidebar.classList.toggle('hidden', cfg.hideSidebar);
    filterContainer.classList.toggle('hidden', cfg.hideFilter);
    projectSelectorContainer?.classList.toggle('hidden', cfg.hideProjectSelector);
    toolbar.classList.toggle('toolbar--system-settings', cfg.systemSettings);

    const isReleases = view === 'releases';
    applyReleaseFilterVisibility(isReleases);
    updateUserFilterOptions(cachedUsers, isReleases ? 'releases' : 'issues');
    if (isReleases) renderReleaseOwnerOptions(cachedUsers);

    // Reset release filters when leaving releases view
    if (!isReleases) {
        setFilterReleaseOwner(null);
        setFilterReleaseSearch('');
        if (releaseSearchInput) releaseSearchInput.value = '';
    }

    cfg.onEnter();
}

function highlightIssueCard(issueId) {
    document.querySelectorAll('.card.highlighted').forEach(card => card.classList.remove('highlighted'));
    const targetCard = document.querySelector(`.card[data-id="${issueId}"]`);
    if (targetCard) {
        targetCard.classList.add('highlighted');
        targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => targetCard.classList.remove('highlighted'), 2000);
    }
}
