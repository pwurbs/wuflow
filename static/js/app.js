import { fetchActiveIssues, fetchLabels, fetchVersion, fetchCurrentUser } from './api.js';
import { state, setIssues, setFilterSearch, setCurrentUser } from './state.js';
import { renderBoard, setupBoardView } from './components/board.js';
import { renderBacklog, setupBacklogView } from './components/backlog.js';
import { renderPlanningPanel } from './components/planning.js';
import { renderArchive, setupArchiveView, resetArchivedLoaded } from './components/archive.js';
import { setupSetupView, renderSetupView } from './components/setup.js';
import { setupModal, openModal } from './components/modal.js';
import { debounce } from './utils.js';
import { initLabelFilter, updateLabelFilterOptions } from './components/labelFilter.js';
import { initPriorityFilter, updatePriorityFilterOptions } from './components/priorityFilter.js';
import { setupUserMenu } from './components/userMenu.js';

// DOM Elements
const navBoard = document.getElementById('nav-board');
const navArchive = document.getElementById('nav-archive');
const navBacklog = document.getElementById('nav-backlog');
const navSetup = document.getElementById('nav-setup');
const boardView = document.querySelector('.board');
const archiveView = document.getElementById('archive-view');
const backlogView = document.getElementById('backlog-view');
const setupView = document.getElementById('setup-view');
const sidebar = document.querySelector('.sidebar');
const filterContainer = document.getElementById('filter-container');
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

    // Hide Setup nav for non-admin users
    if (user.role !== 'admin') {
        navSetup.classList.add('hidden');
    }

    setupEventListeners();
    initLabelFilter(refreshApp);
    initPriorityFilter(refreshApp);
    setupBoardView(refreshApp, openModal);
    setupBacklogView(refreshApp, openModal);
    setupArchiveView(refreshApp, openModal);
    setupSetupView(refreshApp);
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
}

async function refreshApp() {
    try {
        // Reset archived loaded flag so we fetch fresh data on next Archive view
        resetArchivedLoaded();

        const issues = await fetchActiveIssues();
        setIssues(issues);

        // Refresh Label Filter
        const labels = await fetchLabels();
        updateLabelFilterOptions(labels);
        // Priority filter options are static/local so we might not strictly need to call update here unless we want to ensure sync, 
        // but let's do it to be safe if we add dynamic priorities later or reset logic.
        updatePriorityFilterOptions();

        renderBoard(refreshApp, openModal);
        renderBacklog(refreshApp, openModal);

        if (!archiveView.classList.contains('hidden')) {
            await renderArchive(refreshApp, openModal);
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
    navSetup.addEventListener('click', () => switchView('setup'));

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
            if (issue.status === 'Open' && backlogView.classList.contains('hidden')) {
                switchView('backlog');
            } else if (issue.status !== 'Open' && boardView.classList.contains('hidden')) {
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
        setupView.classList.add('hidden');

        navBoard.classList.add('active');
        navBacklog.classList.remove('active');
        navArchive.classList.remove('active');
        navSetup.classList.remove('active');

        sidebar.classList.remove('hidden');
        filterContainer.classList.remove('hidden');

        refreshApp();
    } else if (view === 'archive') {
        boardView.classList.add('hidden');
        backlogView.classList.add('hidden');
        archiveView.classList.remove('hidden');
        setupView.classList.add('hidden');

        navBoard.classList.remove('active');
        navArchive.classList.add('active');
        navBacklog.classList.remove('active');
        navSetup.classList.remove('active');

        sidebar.classList.add('hidden');
        filterContainer.classList.remove('hidden');

        refreshApp();
    } else if (view === 'backlog') {
        boardView.classList.add('hidden');
        backlogView.classList.remove('hidden');
        archiveView.classList.add('hidden');
        setupView.classList.add('hidden');

        navBoard.classList.remove('active');
        navArchive.classList.remove('active');
        navBacklog.classList.add('active');
        navSetup.classList.remove('active');

        sidebar.classList.add('hidden');
        filterContainer.classList.remove('hidden');

        refreshApp();
    } else if (view === 'setup') {
        boardView.classList.add('hidden');
        backlogView.classList.add('hidden');
        archiveView.classList.add('hidden');
        setupView.classList.remove('hidden');

        navBoard.classList.remove('active');
        navArchive.classList.remove('active');
        navBacklog.classList.remove('active');
        navSetup.classList.add('active');

        sidebar.classList.add('hidden');
        filterContainer.classList.add('hidden');

        renderSetupView(refreshApp);
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
