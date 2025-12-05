import { fetchIssues } from './api.js';
import { state, setIssues } from './state.js';
import { renderBoard, setupBoardView } from './components/board.js';
import { renderBacklog, setupBacklogView } from './components/backlog.js';
import { renderPlanningPanel } from './components/planning.js';
import { renderDeadlineList } from './components/deadlines.js';
import { setupSetupView, renderSetupView } from './components/setup.js';
import { setupModal, openModal, closeModal } from './components/modal.js';
import { showModalNotification } from './utils.js';

// DOM Elements
const navBoard = document.getElementById('nav-board');
const navBacklog = document.getElementById('nav-backlog');
const navSetup = document.getElementById('nav-setup');
const boardView = document.querySelector('.board');
const backlogView = document.getElementById('backlog-view');
const setupView = document.getElementById('setup-view');
const sidebar = document.querySelector('.sidebar');
const viewToggles = document.querySelector('.view-toggles');
const btnDeadlines = document.getElementById('btn-deadlines');
const btnPlanning = document.getElementById('btn-planning');
const deadlinesPanel = document.getElementById('deadlines-panel');
const planningPanel = document.getElementById('planning-panel');

document.addEventListener('DOMContentLoaded', () => {
    init();
});

async function init() {
    setupEventListeners();
    setupBoardView(refreshApp, openModal);
    setupBacklogView(refreshApp, openModal);
    setupSetupView();
    setupModal(refreshApp); // Pass refresh callback
    await refreshApp();
}

async function refreshApp() {
    try {
        const issues = await fetchIssues();
        setIssues(issues);
        renderBoard(refreshApp, openModal);
        renderBacklog(refreshApp, openModal);
        renderPlanningPanel(refreshApp);
        renderDeadlineList();
    } catch (err) {
        console.error('Failed to refresh app:', err);
    }
}

function setupEventListeners() {
    // Navigation
    navBoard.addEventListener('click', () => switchView('board'));
    navBacklog.addEventListener('click', () => switchView('backlog'));
    navSetup.addEventListener('click', () => switchView('setup'));

    // Sidebar Toggles
    btnDeadlines.addEventListener('click', () => toggleSidebar('deadlines'));
    btnPlanning.addEventListener('click', () => toggleSidebar('planning'));

    // New Issue Btn
    document.getElementById('add-issue-btn').addEventListener('click', () => openModal(null));

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
        setupView.classList.add('hidden');

        navBoard.classList.add('active');
        navBacklog.classList.remove('active');
        navSetup.classList.remove('active');

        sidebar.classList.remove('hidden');
        viewToggles.classList.remove('hidden');
    } else if (view === 'backlog') {
        boardView.classList.add('hidden');
        backlogView.classList.remove('hidden');
        setupView.classList.add('hidden');

        navBoard.classList.remove('active');
        navBacklog.classList.add('active');
        navSetup.classList.remove('active');

        sidebar.classList.add('hidden');
        viewToggles.classList.add('hidden');
    } else if (view === 'setup') {
        boardView.classList.add('hidden');
        backlogView.classList.add('hidden');
        setupView.classList.remove('hidden');

        navBoard.classList.remove('active');
        navBacklog.classList.remove('active');
        navSetup.classList.add('active');

        sidebar.classList.add('hidden');
        viewToggles.classList.add('hidden');

        renderSetupView();
    }
}

function toggleSidebar(mode) {
    if (mode === 'deadlines') {
        deadlinesPanel.classList.remove('hidden');
        planningPanel.classList.add('hidden');
        btnDeadlines.classList.add('active');
        btnPlanning.classList.remove('active');
    } else {
        deadlinesPanel.classList.add('hidden');
        planningPanel.classList.remove('hidden');
        btnDeadlines.classList.remove('active');
        btnPlanning.classList.add('active');
        renderPlanningPanel(refreshApp);
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
