import { fetchActiveIssuesByProject, fetchLabelsByProject, fetchVersion, fetchCurrentUser, fetchUsers, fetchProjects, fetchStatusConfig } from './api.js';
import { renderMarkdown } from './markdown.js';
import { state, setIssues, setFilterSearch, setCurrentUser, setStatusConfig } from './state.js';
import { renderBoard, setupBoardView } from './components/board.js';
import { renderBacklog, setupBacklogView, resetOpenLoaded } from './components/backlog.js';
import { renderPlanningPanel } from './components/planning.js';
import { renderArchive, setupArchiveView, resetArchivedLoaded } from './components/archive.js';
import { setupSystemSettingsView, renderSystemSettingsView } from './components/system-settings.js';
import { setupProjectSettingsView, renderProjectSettingsView } from './components/project-settings.js';
import { setupModal, openModal } from './components/modal.js';
import { debounce } from './utils.js';
import { STATUS_OPEN } from './status-config.js';
import { initLabelFilter, updateLabelFilterOptions, initPriorityFilter, updatePriorityFilterOptions, initUserFilter, updateUserFilterOptions, setupUserMenu, initProjectSelector, updateProjectSelectorOptions } from './components/toolbar.js';

// DOM Elements
const navBoard = document.getElementById('nav-board');
const navArchive = document.getElementById('nav-archive');
const navBacklog = document.getElementById('nav-backlog');
const navSystemSettings = document.getElementById('nav-system-settings');
const navProjectSettings = document.getElementById('nav-project-settings');
const boardView = document.querySelector('.board');
const archiveView = document.getElementById('archive-view');
const backlogView = document.getElementById('backlog-view');
const systemSettingsView = document.getElementById('system-settings-view');
const projectSettingsView = document.getElementById('project-settings-view');
const sidebar = document.querySelector('.sidebar');
const filterContainer = document.getElementById('filter-container');
const projectSelectorContainer = document.getElementById('project-selector-container');
const toolbar = document.querySelector('.toolbar');
const searchInput = document.getElementById('search-input');


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
    initLabelFilter(refreshApp);
    initPriorityFilter(refreshApp);
    initUserFilter(refreshApp);
    initProjectSelector(refreshApp);
    setupBoardView(refreshApp, openModal);
    setupBacklogView(refreshApp, openModal);
    setupArchiveView(refreshApp, openModal);
    setupSystemSettingsView(refreshApp);
    setupProjectSettingsView(refreshApp);
    setupModal(refreshApp); // Pass refresh callback
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

        const issues = await fetchActiveIssuesByProject(state.selectedProjectId);
        setIssues(issues);

        // Refresh Label Filter (project-scoped; empty when no project selected)
        const labels = state.selectedProjectId ? await fetchLabelsByProject(state.selectedProjectId) : [];
        updateLabelFilterOptions(labels);

        const users = await fetchUsers();
        updateUserFilterOptions(users);

        // Update project selector
        const projects = await fetchProjects();
        updateProjectSelectorOptions(projects);

        // Priority filter options are static/local so we might not strictly need to call update here unless we want to ensure sync, 
        // but let's do it to be safe if we add dynamic priorities later or reset logic.
        updatePriorityFilterOptions();

        renderBoard(refreshApp, openModal);
        if (!backlogView.classList.contains('hidden')) {
            await renderBacklog(refreshApp, openModal);
        }
        if (!archiveView.classList.contains('hidden')) {
            await renderArchive(refreshApp, openModal);
        }
        if (projectSettingsView && !projectSettingsView.classList.contains('hidden')) {
            await renderProjectSettingsView();
        }
        renderPlanningPanel(refreshApp, openModal);
    } catch (err) {
        console.error('Failed to refresh app:', err);
    }
}



function setupEventListeners() {
    // Navigation
    navBoard.addEventListener('click', () => switchView('board'));
    navArchive.addEventListener('click', () => switchView('archive'));
    navBacklog.addEventListener('click', () => switchView('backlog'));
    navSystemSettings.addEventListener('click', () => switchView('system-settings'));
    navProjectSettings.addEventListener('click', () => switchView('project-settings'));

    // New Issue Btn
    document.getElementById('add-issue-btn').addEventListener('click', () => openModal(null));

    // Search
    if (searchInput) {
        searchInput.addEventListener('input', debounce((e) => {
            setFilterSearch(e.target.value);
            refreshApp();
        }, 300));
    }

    // Custom Events
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

function switchView(view) {
    if (view === 'board') {
        boardView.classList.remove('hidden');
        backlogView.classList.add('hidden');
        archiveView.classList.add('hidden');
        systemSettingsView.classList.add('hidden');
        projectSettingsView.classList.add('hidden');

        navBoard.classList.add('active');
        navBacklog.classList.remove('active');
        navArchive.classList.remove('active');
        navSystemSettings.classList.remove('active');
        navProjectSettings.classList.remove('active');

        sidebar.classList.remove('hidden');
        filterContainer.classList.remove('hidden');
        if (projectSelectorContainer) projectSelectorContainer.classList.remove('hidden');
        toolbar.classList.remove('toolbar--system-settings');

        refreshApp();
    } else if (view === 'archive') {
        boardView.classList.add('hidden');
        backlogView.classList.add('hidden');
        archiveView.classList.remove('hidden');
        systemSettingsView.classList.add('hidden');
        projectSettingsView.classList.add('hidden');

        navBoard.classList.remove('active');
        navArchive.classList.add('active');
        navBacklog.classList.remove('active');
        navSystemSettings.classList.remove('active');
        navProjectSettings.classList.remove('active');

        sidebar.classList.add('hidden');
        filterContainer.classList.remove('hidden');
        if (projectSelectorContainer) projectSelectorContainer.classList.remove('hidden');
        toolbar.classList.remove('toolbar--system-settings');

        refreshApp();
    } else if (view === 'backlog') {
        boardView.classList.add('hidden');
        backlogView.classList.remove('hidden');
        archiveView.classList.add('hidden');
        systemSettingsView.classList.add('hidden');
        projectSettingsView.classList.add('hidden');

        navBoard.classList.remove('active');
        navArchive.classList.remove('active');
        navBacklog.classList.add('active');
        navSystemSettings.classList.remove('active');
        navProjectSettings.classList.remove('active');

        sidebar.classList.add('hidden');
        filterContainer.classList.remove('hidden');
        if (projectSelectorContainer) projectSelectorContainer.classList.remove('hidden');
        toolbar.classList.remove('toolbar--system-settings');

        refreshApp();
    } else if (view === 'system-settings') {
        boardView.classList.add('hidden');
        backlogView.classList.add('hidden');
        archiveView.classList.add('hidden');
        systemSettingsView.classList.remove('hidden');
        projectSettingsView.classList.add('hidden');

        navBoard.classList.remove('active');
        navArchive.classList.remove('active');
        navBacklog.classList.remove('active');
        navSystemSettings.classList.add('active');
        navProjectSettings.classList.remove('active');

        sidebar.classList.add('hidden');
        filterContainer.classList.add('hidden');
        if (projectSelectorContainer) projectSelectorContainer.classList.add('hidden');
        toolbar.classList.add('toolbar--system-settings');

        renderSystemSettingsView(refreshApp);
    } else if (view === 'project-settings') {
        boardView.classList.add('hidden');
        backlogView.classList.add('hidden');
        archiveView.classList.add('hidden');
        systemSettingsView.classList.add('hidden');
        projectSettingsView.classList.remove('hidden');

        navBoard.classList.remove('active');
        navArchive.classList.remove('active');
        navBacklog.classList.remove('active');
        navSystemSettings.classList.remove('active');
        navProjectSettings.classList.add('active');

        sidebar.classList.add('hidden');
        filterContainer.classList.add('hidden');
        if (projectSelectorContainer) projectSelectorContainer.classList.remove('hidden');
        toolbar.classList.remove('toolbar--system-settings');

        renderProjectSettingsView();
    }
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
