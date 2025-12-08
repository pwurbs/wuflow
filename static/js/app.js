import { fetchIssues, fetchLabels } from './api.js';
import { state, setIssues, setFilterLabel } from './state.js';
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
const labelFilterContainer = document.getElementById('label-filter-container');
const labelFilterBtn = document.getElementById('label-filter-btn');
const labelFilterOptions = document.getElementById('label-filter-options');

document.addEventListener('DOMContentLoaded', () => {
    init();
});

async function init() {
    setupEventListeners();
    setupBoardView(refreshApp, openModal);
    setupBacklogView(refreshApp, openModal);
    setupBacklogView(refreshApp, openModal);
    setupSetupView(refreshApp);
    setupModal(refreshApp); // Pass refresh callback
    await refreshApp();
}

async function refreshApp() {
    try {
        const issues = await fetchIssues();
        setIssues(issues);

        // Refresh Label Filter
        const labels = await fetchLabels();
        updateLabelFilterOptions(labels);

        renderBoard(refreshApp, openModal);
        renderBacklog(refreshApp, openModal);
        renderPlanningPanel(refreshApp);
        renderDeadlineList();
    } catch (err) {
        console.error('Failed to refresh app:', err);
    }
}

function updateLabelFilterOptions(labels) {
    const currentVal = state.filter.label;

    // Clear dropdown options
    labelFilterOptions.innerHTML = '';

    // Add "No Label"
    const noLabelOption = createCustomOption('No Label', '__no_label__');
    labelFilterOptions.appendChild(noLabelOption);

    labels.forEach(label => {
        const option = createCustomOption(label.name, label.name);
        labelFilterOptions.appendChild(option);
    });

    // Update button content
    labelFilterBtn.innerHTML = ''; // Clear existing
    if (currentVal) {
        // Filter Selected
        const labelText = currentVal === '__no_label__' ? 'No Label' : currentVal;

        const textSpan = document.createElement('span');
        textSpan.textContent = `Label: ${labelText}`;
        labelFilterBtn.appendChild(textSpan);

        const clearIcon = document.createElement('span');
        clearIcon.className = 'filter-icon-clear';
        clearIcon.innerHTML = '&times;'; // Cross entity
        clearIcon.title = 'Clear filter';

        clearIcon.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent opening dropdown
            setFilterLabel(null);
            refreshApp();
        });

        labelFilterBtn.appendChild(clearIcon);
        labelFilterBtn.classList.add('has-selection');
    } else {
        // No Filter
        const textSpan = document.createElement('span');
        textSpan.textContent = 'Label';
        labelFilterBtn.appendChild(textSpan);

        const arrowIcon = document.createElement('span');
        arrowIcon.className = 'filter-icon-arrow';
        // arrowIcon.innerHTML = '&#9662;'; // Down triangle
        // or a small svg? Using text for simplicity as requested "small down arrow"
        arrowIcon.innerHTML = '▼';

        labelFilterBtn.appendChild(arrowIcon);
        labelFilterBtn.classList.remove('has-selection');
    }
}

function createCustomOption(text, value) {
    const div = document.createElement('div');
    div.className = 'custom-option';
    if (state.filter.label === value || (!state.filter.label && value === '')) {
        // div.classList.add('selected'); // Optional styling
    }
    div.textContent = text;
    div.addEventListener('click', () => {
        setFilterLabel(value || null);
        labelFilterBtn.textContent = text;
        labelFilterOptions.classList.add('hidden');
        refreshApp();
    });
    return div;
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

    // Label Filter Dropdown Toggle
    labelFilterBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent document click
        labelFilterOptions.classList.toggle('hidden');
    });

    // Close Dropdown on outside click
    document.addEventListener('click', (e) => {
        if (!labelFilterContainer.contains(e.target)) {
            labelFilterOptions.classList.add('hidden');
        }
    });

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
        labelFilterContainer.classList.remove('hidden');
    } else if (view === 'backlog') {
        boardView.classList.add('hidden');
        backlogView.classList.remove('hidden');
        setupView.classList.add('hidden');

        navBoard.classList.remove('active');
        navBacklog.classList.add('active');
        navSetup.classList.remove('active');

        sidebar.classList.add('hidden');
        viewToggles.classList.add('hidden');
        labelFilterContainer.classList.remove('hidden');
    } else if (view === 'setup') {
        boardView.classList.add('hidden');
        backlogView.classList.add('hidden');
        setupView.classList.remove('hidden');

        navBoard.classList.remove('active');
        navBacklog.classList.remove('active');
        navSetup.classList.add('active');

        sidebar.classList.add('hidden');
        sidebar.classList.add('hidden');
        viewToggles.classList.add('hidden');
        labelFilterContainer.classList.add('hidden');


        renderSetupView(refreshApp);
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
