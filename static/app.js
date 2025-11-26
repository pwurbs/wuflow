const API_URL = '/api';

// State
let issues = [];
let currentIssue = null;

// DOM Elements
const columns = {
    Todo: document.getElementById('col-todo'),
    Pending: document.getElementById('col-pending'),
    Working: document.getElementById('col-working'),
    Done: document.getElementById('col-done')
};
const addIssueBtn = document.getElementById('add-issue-btn');
const modal = document.getElementById('issue-modal');
const closeModalBtn = document.querySelector('.close-modal');
const issueForm = document.getElementById('issue-form');
const tasksSection = document.getElementById('tasks-section');
const taskList = document.getElementById('task-list');
const taskForm = document.getElementById('task-form');
const navBoard = document.getElementById('nav-board');
const navBacklog = document.getElementById('nav-backlog');
const boardView = document.querySelector('.board');
const backlogView = document.getElementById('backlog-view');
const backlogList = document.getElementById('backlog-list');
const backlogCount = document.getElementById('backlog-count');
const statusSelect = document.getElementById('status');
const deleteIssueBtn = document.getElementById('delete-issue-btn');

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    fetchIssues();
    setupEventListeners();
});

function setupEventListeners() {
    addIssueBtn.addEventListener('click', () => openModal());
    closeModalBtn.addEventListener('click', () => closeModal());
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    issueForm.addEventListener('submit', handleIssueSubmit);
    taskForm.addEventListener('submit', handleTaskSubmit);

    // Drag and Drop for Columns
    document.querySelectorAll('.column-content').forEach(colContent => {
        colContent.addEventListener('dragover', handleDragOver);
        colContent.addEventListener('drop', handleDrop);
    });

    // Drag and Drop for Backlog
    backlogList.addEventListener('dragover', handleDragOver);
    backlogList.addEventListener('drop', handleDrop);

    // Navigation
    navBoard.addEventListener('click', () => switchView('board'));
    navBacklog.addEventListener('click', () => switchView('backlog'));

    // Delete Issue
    deleteIssueBtn.addEventListener('click', handleDeleteIssue);
}

function switchView(view) {
    if (view === 'board') {
        boardView.classList.remove('hidden');
        backlogView.classList.add('hidden');
        navBoard.classList.add('active');
        navBacklog.classList.remove('active');
    } else {
        boardView.classList.add('hidden');
        backlogView.classList.remove('hidden');
        navBoard.classList.remove('active');
        navBacklog.classList.add('active');
    }
}

// API Calls
async function fetchIssues() {
    try {
        const res = await fetch(`${API_URL}/issues`);
        issues = await res.json();
        if (!issues) issues = [];
        renderBoard();
        renderBacklog();
    } catch (err) {
        console.error('Failed to fetch issues:', err);
    }
}

async function createIssue(issue) {
    const res = await fetch(`${API_URL}/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(issue)
    });
    return res.json();
}

async function updateIssue(issue) {
    const res = await fetch(`${API_URL}/issues/${issue.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(issue)
    });
    return res.json();
}

async function createTask(task) {
    const res = await fetch(`${API_URL}/issues/${task.issue_id}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(task)
    });
    return res.json();
}

async function updateTask(task) {
    const res = await fetch(`${API_URL}/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(task)
    });
    return res.json();
}

async function deleteTask(id) {
    await fetch(`${API_URL}/tasks/${id}`, { method: 'DELETE' });
}

async function deleteIssue(id) {
    await fetch(`${API_URL}/issues/${id}`, { method: 'DELETE' });
}

// Rendering
function renderBoard() {
    // Clear columns
    Object.values(columns).forEach(col => col.innerHTML = '');

    // Update counts
    const counts = { Todo: 0, Pending: 0, Working: 0, Done: 0 };

    // Sort issues by position
    issues.sort((a, b) => a.position - b.position);

    issues.forEach(issue => {
        if (issue.status === 'Open') return; // Skip backlog issues

        const card = createCardElement(issue);
        if (columns[issue.status]) {
            columns[issue.status].appendChild(card);
            counts[issue.status]++;
        }
    });

    // Update header counts
    document.querySelectorAll('.column').forEach(col => {
        const status = col.dataset.status;
        col.querySelector('.count').textContent = counts[status];
    });

    renderDeadlineList();
}

function renderBacklog() {
    backlogList.innerHTML = '';
    let count = 0;

    // Sort issues by position
    const backlogIssues = issues.filter(i => i.status === 'Open');
    backlogIssues.sort((a, b) => a.position - b.position);

    backlogIssues.forEach(issue => {
        const card = createCardElement(issue);
        backlogList.appendChild(card);
        count++;
    });

    backlogCount.textContent = count;
}

function renderDeadlineList() {
    const deadlineList = document.getElementById('deadline-list');
    deadlineList.innerHTML = '';

    const allTasks = [];
    issues.forEach(issue => {
        if (issue.tasks) {
            issue.tasks.forEach(task => {
                if (task.deadline && !task.done) {
                    allTasks.push({
                        ...task,
                        issueTitle: issue.title
                    });
                }
            });
        }
    });

    // Sort by deadline
    allTasks.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));

    allTasks.forEach(task => {
        const li = document.createElement('li');
        li.className = 'deadline-item';

        const taskDeadline = new Date(task.deadline);
        const now = new Date();
        const isOverdue = taskDeadline < now;

        const date = taskDeadline.toLocaleDateString(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric'
        });

        li.innerHTML = `
            <span class="deadline-date ${isOverdue ? 'overdue' : ''}">
                ${isOverdue ? '<span class="overdue-indicator">⚠️</span>' : ''}${date}
            </span>
            <span class="deadline-task" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</span>
            <span class="deadline-issue">${escapeHtml(task.issueTitle)}</span>
        `;

        // Add click handler to highlight the issue
        li.style.cursor = 'pointer';
        li.addEventListener('click', () => {
            const issue = issues.find(i => i.id === task.issue_id);
            if (issue) {
                highlightIssueCard(issue.id);
            }
        });

        deadlineList.appendChild(li);
    });
}

function highlightIssueCard(issueId) {
    // Remove previous highlights
    document.querySelectorAll('.card.highlighted').forEach(card => {
        card.classList.remove('highlighted');
    });

    // Find and highlight the target card
    const targetCard = document.querySelector(`.card[data-id="${issueId}"]`);
    if (targetCard) {
        targetCard.classList.add('highlighted');
        targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Remove highlight after 2 seconds
        setTimeout(() => {
            targetCard.classList.remove('highlighted');
        }, 2000);
    }
}

function createCardElement(issue) {
    const card = document.createElement('div');
    card.className = 'card';
    card.draggable = true;
    card.dataset.id = issue.id;

    const completedTasks = issue.tasks ? issue.tasks.filter(t => t.done).length : 0;
    const totalTasks = issue.tasks ? issue.tasks.length : 0;

    card.innerHTML = `
        <div class="card-main-content">
            <div class="card-title">${escapeHtml(issue.title)}</div>
            <div class="card-description">${escapeHtml(issue.description || '')}</div>
        </div>
        <div class="card-tasks">
            ${issue.tasks ? issue.tasks.map(t => `
                <div class="card-task-item ${t.done ? 'done' : ''}">
                    <span class="card-task-icon">${t.done ? '☑' : '☐'}</span>
                    <span class="card-task-title">${escapeHtml(t.title)}</span>
                    ${t.deadline ? `<span class="card-task-deadline">📅 ${new Date(t.deadline).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}</span>` : ''}
                </div>
            `).join('') : ''}
        </div>
        <div class="card-meta">
            ${issue.deadline ? `<span>📅 ${new Date(issue.deadline).toLocaleDateString()}</span>` : '<span></span>'}
            ${totalTasks > 0 ? `<div class="task-progress">${completedTasks}/${totalTasks}</div>` : ''}
        </div>
    `;

    card.addEventListener('click', () => openModal(issue));
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragend', handleDragEnd);

    return card;
}

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Modal Handling
function openModal(issue = null) {
    currentIssue = issue;
    modal.classList.remove('hidden');

    if (issue) {
        document.getElementById('modal-title').textContent = 'Edit Issue';
        document.getElementById('issue-id').value = issue.id;
        document.getElementById('title').value = issue.title;
        document.getElementById('description').value = issue.description || '';
        document.getElementById('deadline').value = issue.deadline ? new Date(issue.deadline).toISOString().slice(0, 16) : '';
        statusSelect.value = issue.status;


        tasksSection.classList.remove('hidden');
        renderTasks(issue.tasks || []);
        deleteIssueBtn.classList.remove('hidden');
    } else {
        document.getElementById('modal-title').textContent = 'New Issue';
        document.getElementById('issue-form').reset();
        document.getElementById('issue-id').value = '';
        statusSelect.value = 'Todo'; // Default for new issues, or user can choose Open
        tasksSection.classList.add('hidden');
        deleteIssueBtn.classList.add('hidden');
    }
}

function closeModal() {
    modal.classList.add('hidden');
    currentIssue = null;
}

async function handleDeleteIssue() {
    if (!currentIssue) return;

    if (confirm(`Are you sure you want to delete "${currentIssue.title}"? This will also delete all associated tasks.`)) {
        await deleteIssue(currentIssue.id);
        closeModal();
        fetchIssues();
    }
}

async function handleIssueSubmit(e) {
    e.preventDefault();

    const issueData = {
        title: document.getElementById('title').value,
        description: document.getElementById('description').value,
        deadline: document.getElementById('deadline').value ? new Date(document.getElementById('deadline').value) : null,
        status: statusSelect.value,
        position: currentIssue ? currentIssue.position : 0 // Backend handles new position
    };

    if (currentIssue) {
        issueData.id = currentIssue.id;
        await updateIssue(issueData);
    } else {
        await createIssue(issueData);
    }

    closeModal();
    fetchIssues();
}

// Task Handling
function renderTasks(tasks) {
    taskList.innerHTML = '';
    tasks.forEach(task => {
        const li = document.createElement('li');
        li.className = `task-item ${task.done ? 'done' : ''}`;
        li.innerHTML = `
            <input type="checkbox" ${task.done ? 'checked' : ''}>
            <div class="task-info" style="flex: 1;">
                <span>${escapeHtml(task.title)}</span>
                ${task.deadline ? `<span class="task-deadline">📅 ${new Date(task.deadline).toLocaleDateString()}</span>` : ''}
            </div>
            <span class="delete-btn">&times;</span>
        `;

        const checkbox = li.querySelector('input');
        checkbox.addEventListener('change', async () => {
            task.done = checkbox.checked;
            await updateTask(task);
            fetchIssues(); // Refresh to update card progress
            // Don't re-render modal tasks to avoid flickering, just update style
            li.className = `task-item ${task.done ? 'done' : ''}`;
        });

        const deleteBtn = li.querySelector('.delete-btn');
        deleteBtn.addEventListener('click', async () => {
            if (confirm('Delete this task?')) {
                await deleteTask(task.id);
                // Remove from local array and re-render
                currentIssue.tasks = currentIssue.tasks.filter(t => t.id !== task.id);
                renderTasks(currentIssue.tasks);
                fetchIssues();
            }
        });

        taskList.appendChild(li);
    });
}

async function handleTaskSubmit(e) {
    e.preventDefault();
    if (!currentIssue) return;

    const titleInput = document.getElementById('new-task-title');
    const deadlineInput = document.getElementById('new-task-deadline');

    const taskData = {
        issue_id: currentIssue.id,
        title: titleInput.value,
        done: false,
        deadline: deadlineInput.value ? new Date(deadlineInput.value) : null
    };

    const newTask = await createTask(taskData);
    if (!currentIssue.tasks) currentIssue.tasks = [];
    currentIssue.tasks.push(newTask);

    renderTasks(currentIssue.tasks);
    titleInput.value = '';
    deadlineInput.value = '';
    fetchIssues();
}

// Drag and Drop Logic
let draggedCard = null;

function handleDragStart(e) {
    draggedCard = this;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd(e) {
    this.classList.remove('dragging');
    draggedCard = null;

    // Save new state
    saveBoardState();
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const container = this; // This is now .column-content
    const afterElement = getDragAfterElement(container, e.clientY);

    if (afterElement == null) {
        container.appendChild(draggedCard);
    } else {
        container.insertBefore(draggedCard, afterElement);
    }
}

function handleDrop(e) {
    e.preventDefault();
}

function getDragAfterElement(column, y) {
    const draggableElements = [...column.querySelectorAll('.card:not(.dragging)')];

    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;

        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

async function saveBoardState() {
    // Iterate over all columns and update status and position
    const updates = [];

    document.querySelectorAll('.column').forEach(col => {
        const status = col.dataset.status;
        const cards = [...col.querySelectorAll('.column-content .card')];

        cards.forEach((card, index) => {
            const id = parseInt(card.dataset.id);
            const issue = issues.find(i => i.id === id);

            if (issue && (issue.status !== status || issue.position !== index)) {
                issue.status = status;
                issue.position = index;
                updates.push(updateIssue(issue));
            }
        });
    });

    // Handle Backlog
    const backlogCards = [...backlogList.querySelectorAll('.card')];
    backlogCards.forEach((card, index) => {
        const id = parseInt(card.dataset.id);
        const issue = issues.find(i => i.id === id);

        if (issue && (issue.status !== 'Open' || issue.position !== index)) {
            issue.status = 'Open';
            issue.position = index;
            updates.push(updateIssue(issue));
        }
    });

    await Promise.all(updates);
}
