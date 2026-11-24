import { fetchLabelsByProject, fetchVersion, fetchCurrentUser, fetchUsers, fetchProjects, fetchStatusConfig, fetchReleases } from './api.ts';
import { renderMarkdown } from './markdown.ts';
import { state, setFilterSearch, setCurrentUser, setStatusConfig, setReleases, setLabels, setUsers, setProjects, setFilterRelease, setFilterReleaseOwner, setFilterReleaseSearch } from './state.ts';
import { renderBoard, setupBoardView } from './components/board.ts';
import { renderBacklog, setupBacklogView } from './components/backlog.ts';
import { renderPlanningPanel, setupPlanningPanel } from './components/planning.ts';
import { renderArchive, setupArchiveView } from './components/archive.ts';
import { setupSystemSettingsView, renderSystemSettingsView } from './components/system-settings.ts';
import { setupProjectSettingsView, renderProjectSettingsView } from './components/project-settings.ts';
import { setupReleasesView, renderReleasesView, renderReleaseOwnerOptions } from './components/releases.ts';
import { setupModal, openModal } from './components/modal.ts';
import { setupMyWorkView, loadMyIssues, renderMyWork, mergeMyIssue } from './components/my-work.ts';
import { setupSession } from './session.ts';
import { loadIssues, ensureIssueLists, VIEW_ISSUE_LISTS } from './issue-lists.ts';
import { byId, bySelector, debounce, errorMessage, showNotification } from './utils.ts';
import { initToolbarFilters, bindSearchClear, updateLabelFilterOptions, updatePriorityFilterOptions, updateUserFilterOptions, updateReleaseFilterOptions, setupUserMenu, initProjectSelector, updateProjectSelectorOptions } from './components/toolbar.ts';

// DOM Elements
const navBoard = byId('nav-board');
const navArchive = byId('nav-archive');
const navBacklog = byId('nav-backlog');
const navSystemSettings = byId('nav-system-settings');
const navProjectSettings = byId('nav-project-settings');
const navReleases = byId('nav-releases');
const navMyWork = byId('nav-my-work');
const boardView = bySelector(document, '.board');
const myWorkView = byId('my-work-view');
const archiveView = byId('archive-view');
const backlogView = byId('backlog-view');
const releasesView = byId('releases-view');
const systemSettingsView = byId('system-settings-view');
const projectSettingsView = byId('project-settings-view');
const sidebar = bySelector(boardView, '.sidebar'); // the board's planning panel (My Work has its own)
const filterContainer = byId('filter-container');
const projectSelectorContainer = byId('project-selector-container');
const searchInput = byId('search-input', HTMLInputElement);
const releaseSearchInput = byId('release-search-input', HTMLInputElement);
let syncReleaseSearchClear = () => {}; // set in setupEventListeners


document.addEventListener('DOMContentLoaded', () => {
    void init();
});

async function init() {
    // Check authentication before anything else
    const user = await fetchCurrentUser();
    if (!user) {
        globalThis.location.href = '/login';
        return;
    }
    setCurrentUser(user);
    // Installed only after the initial auth check: an expired session at page load
    // still redirects to /login, later expiries open the re-login dialog instead.
    setupSession();
    // Hide System Settings nav (and the separator above it) for non-sysadmin users
    if (user.role !== 'sysadmin') {
        navSystemSettings.classList.add('hidden');
        byId('system-menu-separator').classList.add('hidden');
    }
    // Hide Project Settings nav for user role
    if (user.role === 'user') {
        navProjectSettings.classList.add('hidden');
    }

    setupEventListeners();
    initToolbarFilters(rerenderActiveView);
    initProjectSelector(refreshApp);
    setupBoardView(refreshApp, openModal, rerenderActiveView);
    setupBacklogView(refreshApp, openModal, rerenderActiveView);
    setupArchiveView(refreshApp, openModal, rerenderActiveView);
    setupPlanningPanel(refreshApp, openModal, rerenderActiveView);
    setupMyWorkView(openModal);
    setupSystemSettingsView();
    setupProjectSettingsView();
    setupReleasesView();
    setupModal(refreshApp, rerenderAfterIssueChange);
    setupUserMenu(user);

    // Fetch and display version
    void fetchVersion().then(version => {
        byId('app-version').textContent = 'v' + version;
    });

    await refreshApp();

    // Pre-warm marked + DOMPurify: the modal renders the description synchronously on
    // click, so move their one-time init cost off that path. Deferred via setTimeout
    // so the initial page paint is not delayed.
    setTimeout(() => renderMarkdown('a'), 0);
}

// null: no project is selected or the load failed. The board then shows the default columns.
async function loadStatusConfig(projectId: number | null) {
    try {
        return projectId ? await fetchStatusConfig(projectId) : null;
    } catch (err) {
        console.warn('Failed to load status config, using defaults:', err);
        return null;
    }
}

// Single source of truth for which view is currently visible, shared by
// refreshApp() and rerenderActiveView() so they can't drift out of sync.
function getVisibleViews() {
    return {
        backlog: !backlogView.classList.contains('hidden'),
        archive: !archiveView.classList.contains('hidden'),
        projectSettings: !projectSettingsView.classList.contains('hidden'),
        releases: !releasesView.classList.contains('hidden'),
        myWork: !myWorkView.classList.contains('hidden'),
    };
}

// Loads my issues for My Work. A failure is shown, and the view keeps its last list.
async function loadMyWork() {
    try {
        await loadMyIssues();
    } catch (err) {
        showNotification(errorMessage(err), 'error');
    }
}

// The open/archived issue lists the given view needs on top of the active issues.
function issueListsFor(visible: ReturnType<typeof getVisibleViews>) {
    if (visible.releases) return VIEW_ISSUE_LISTS.releases;
    if (visible.backlog) return VIEW_ISSUE_LISTS.backlog;
    if (visible.archive) return VIEW_ISSUE_LISTS.archive;
    return [];
}

// Bumped by every refreshApp(), so the results of a superseded refresh are discarded.
let refreshSeq = 0;

async function refreshApp() {
    const seq = ++refreshSeq;
    const projectId = state.selectedProjectId;
    try {
        // Everything is requested in one parallel wave: nothing renders before all of it
        // has arrived, so the status config does not need to be awaited first.
        const issuesLoad = loadIssues();
        // The lists the visible view needs are requested in the same wave but not awaited
        // here: the view's render joins the request and handles its errors, so a failed
        // list does not stop the rest of the refresh.
        const visibleAtStart = getVisibleViews();
        void ensureIssueLists(issueListsFor(visibleAtStart)).catch(() => {});
        const myWorkLoad = visibleAtStart.myWork ? loadMyWork() : null;
        const [, statusConfig, labels, releases, users, projects] = await Promise.all([
            issuesLoad,
            loadStatusConfig(projectId),
            projectId ? fetchLabelsByProject(projectId) : Promise.resolve([]),
            projectId ? fetchReleases(projectId) : Promise.resolve([]),
            fetchUsers(),
            fetchProjects(),
        ]);
        if (seq !== refreshSeq) return; // a newer refresh started meanwhile, e.g. a project switch

        setStatusConfig(statusConfig);

        setLabels(labels, projectId);
        updateLabelFilterOptions(labels);

        setReleases(releases);
        updateReleaseFilterOptions(releases);

        setUsers(users);
        const visible = getVisibleViews();
        updateUserFilterOptions(state.users, visible.releases ? 'releases' : 'issues');
        if (visible.releases) renderReleaseOwnerOptions(state.users);

        setProjects(projects);
        updateProjectSelectorOptions(projects);

        // Priority filter options are static/local so we might not strictly need to call update here unless we want to ensure sync,
        // but let's do it to be safe if we add dynamic priorities later or reset logic.
        updatePriorityFilterOptions();

        renderBoard(refreshApp, openModal, rerenderActiveView);
        if (visible.backlog) {
            await renderBacklog(refreshApp, openModal, rerenderActiveView);
        }
        if (visible.archive) {
            await renderArchive(refreshApp, openModal, rerenderActiveView);
        }
        if (visible.projectSettings) {
            await renderProjectSettingsView();
        }
        if (visible.releases) {
            void renderReleasesView();
        }
        renderPlanningPanel();
        if (myWorkLoad) {
            await myWorkLoad;
            renderMyWork();
        }
    } catch (err) {
        console.error('Failed to refresh app:', err);
    }
}

// Re-renders whatever view is currently visible from already-loaded state, with zero API calls.
function rerenderActiveView() {
    // The label/user/release filter buttons only rebuild their "selected + clear icon"
    // display as a side effect of these calls, so a filter change must still trigger them —
    // just reusing already-cached data instead of re-fetching it.
    updateLabelFilterOptions(state.labels);
    updateReleaseFilterOptions(state.releases);
    const visible = getVisibleViews();
    updateUserFilterOptions(state.users, visible.releases ? 'releases' : 'issues');

    renderBoard();
    if (visible.backlog) {
        void renderBacklog();
    }
    if (visible.archive) {
        void renderArchive();
    }
    if (visible.projectSettings) {
        void renderProjectSettingsView();
    }
    if (visible.releases) {
        void renderReleasesView();
    }
    if (visible.myWork) {
        renderMyWork();
    }
    renderPlanningPanel();
}

// Used by the issue modal: state.currentIssue is a separate object from its state.issues
// entry (fetched independently), so field/task edits made in the modal must be merged back
// before the board/planning panel behind the modal re-render.
function rerenderAfterIssueChange() {
    if (state.currentIssue) {
        const current = state.currentIssue;
        const idx = state.issues.findIndex(i => i.id === current.id);
        if (idx !== -1) state.issues[idx] = { ...state.issues[idx], ...current };
        mergeMyIssue(current);
    }
    renderBoard();
    renderPlanningPanel();
    if (getVisibleViews().myWork) renderMyWork();
}

function setupEventListeners() {
    // Navigation
    navBoard.addEventListener('click', () => switchView('board'));
    navArchive.addEventListener('click', () => switchView('archive'));
    navBacklog.addEventListener('click', () => switchView('backlog'));
    navSystemSettings.addEventListener('click', () => switchView('system-settings'));
    navProjectSettings.addEventListener('click', () => switchView('project-settings'));
    navReleases.addEventListener('click', () => switchView('releases'));
    navMyWork.addEventListener('click', () => switchView('my-work'));

    // New Issue Btn
    byId('add-issue-btn').addEventListener('click', () => openModal(null));

    // Issue search
    searchInput.addEventListener('input', debounce(() => {
        setFilterSearch(searchInput.value);
        rerenderActiveView();
    }, 300));

    // Release search
    releaseSearchInput.addEventListener('input', debounce(() => {
        setFilterReleaseSearch(releaseSearchInput.value);
        void renderReleasesView();
    }, 300));

    bindSearchClear(searchInput, byId('search-clear'));
    syncReleaseSearchClear = bindSearchClear(releaseSearchInput, byId('release-search-clear'));

    // Custom Events
    document.addEventListener('nav-to-release', (e) => {
        if (!(e instanceof CustomEvent)) return;
        setFilterRelease(e.detail.releaseId);
        switchView('board');
    });
}

// The toolbar's filter fields by name. On the releases view the user filter is the owner filter.
const FILTER_WRAPPERS = {
    label: 'label-filter-wrapper',
    priority: 'priority-filter-wrapper',
    release: 'release-filter-wrapper',
    user: 'user-filter-wrapper',
    search: 'search-filter-wrapper',
    releaseSearch: 'release-search-wrapper',
} as const;
type FilterWrapper = keyof typeof FILTER_WRAPPERS;

const ISSUE_FILTERS = ['label', 'priority', 'release', 'user', 'search'] as const;

// filters: the filter fields the view shows; none hides the filter bar.
const VIEW_CONFIG = {
    'my-work':         { el: myWorkView,           nav: navMyWork,          hideSidebar: true,  hideProjectSelector: true,  filters: ['priority', 'search'],     onEnter: () => refreshApp() },
    'board':           { el: boardView,           nav: navBoard,           hideSidebar: false, hideProjectSelector: false, filters: ISSUE_FILTERS,              onEnter: () => refreshApp() },
    'backlog':         { el: backlogView,          nav: navBacklog,         hideSidebar: true,  hideProjectSelector: false, filters: ISSUE_FILTERS,              onEnter: () => refreshApp() },
    'archive':         { el: archiveView,          nav: navArchive,         hideSidebar: true,  hideProjectSelector: false, filters: ISSUE_FILTERS,              onEnter: () => refreshApp() },
    'releases':        { el: releasesView,         nav: navReleases,        hideSidebar: true,  hideProjectSelector: false, filters: ['user', 'releaseSearch'],  onEnter: () => renderReleasesView() },
    'project-settings':{ el: projectSettingsView,  nav: navProjectSettings, hideSidebar: true,  hideProjectSelector: false, filters: [],                         onEnter: () => renderProjectSettingsView() },
    'system-settings': { el: systemSettingsView,   nav: navSystemSettings,  hideSidebar: true,  hideProjectSelector: true,  filters: [],                         onEnter: () => renderSystemSettingsView() },
} as const;

function applyFilterVisibility(shown: readonly FilterWrapper[]) {
    filterContainer.classList.toggle('hidden', shown.length === 0);
    const visible = new Set<string>(shown);
    for (const [name, id] of Object.entries(FILTER_WRAPPERS)) {
        byId(id).classList.toggle('hidden', !visible.has(name));
    }
}

function switchView(view: keyof typeof VIEW_CONFIG) {
    const cfg = VIEW_CONFIG[view];

    Object.values(VIEW_CONFIG).forEach(c => { c.el.classList.add('hidden'); c.nav.classList.remove('active'); });

    cfg.el.classList.remove('hidden');
    cfg.nav.classList.add('active');
    sidebar.classList.toggle('hidden', cfg.hideSidebar);
    projectSelectorContainer.classList.toggle('hidden', cfg.hideProjectSelector);
    applyFilterVisibility(cfg.filters);

    const isReleases = view === 'releases';
    updateUserFilterOptions(state.users, isReleases ? 'releases' : 'issues');
    if (isReleases) renderReleaseOwnerOptions(state.users);

    // Reset release filters when leaving releases view
    if (!isReleases) {
        setFilterReleaseOwner(null);
        setFilterReleaseSearch('');
        releaseSearchInput.value = '';
        syncReleaseSearchClear();
    }

    void cfg.onEnter();
}
