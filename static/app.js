const API_URL = '/api';

// State
let issues = [];
let currentIssue = null;

let draggedTask = null;

// DOM Elements
const columns = {
    Todo: document.getElementById('col-todo'),
    Pending: document.getElementById('col-pending'),
    Working: document.getElementById('col-working'),
    Done: document.getElementById('col-done')
};
const addIssueBtn = document.getElementById('add-issue-btn');
const modal = document.getElementById('issue-modal');

const issueForm = document.getElementById('issue-form');
const tasksSection = document.getElementById('tasks-section');
const taskList = document.getElementById('task-list');

const navBoard = document.getElementById('nav-board');
const navBacklog = document.getElementById('nav-backlog');
const boardView = document.querySelector('.board');
const backlogView = document.getElementById('backlog-view');
const backlogList = document.getElementById('backlog-list');
const backlogCount = document.getElementById('backlog-count');
const statusSelect = document.getElementById('status');
const deleteIssueBtn = document.getElementById('delete-issue-btn');
const confirmModal = document.getElementById('confirm-modal');
const confirmTitle = document.getElementById('confirm-title');
const confirmMessage = document.getElementById('confirm-message');
const confirmOkBtn = document.getElementById('confirm-ok-btn');
const confirmCancelBtn = document.getElementById('confirm-cancel-btn');
const moveToTodoList = document.getElementById('move-to-todo-list');
const btnDeadlines = document.getElementById('btn-deadlines');
const btnPlanning = document.getElementById('btn-planning');
const deadlinesPanel = document.getElementById('deadlines-panel');
const planningPanel = document.getElementById('planning-panel');
const planningList = document.getElementById('planning-list');
const planningCount = document.getElementById('planning-count');
const sidebar = document.querySelector('.sidebar');
const viewToggles = document.querySelector('.view-toggles');
const notificationToast = document.getElementById('notification-toast');


// Initialization
document.addEventListener('DOMContentLoaded', () => {
    fetchIssues();
    setupEventListeners();
});

function setupEventListeners() {
    addIssueBtn.addEventListener('click', () => openModal());

    document.getElementById('cancel-btn').addEventListener('click', () => closeModal());


    issueForm.addEventListener('submit', handleIssueSubmit);

    // Task form listener is now handled in setupEventListeners via add-task-btn click

    // Drag and Drop for Columns
    document.querySelectorAll('.column-content').forEach(colContent => {
        colContent.addEventListener('dragover', handleDragOver);
        colContent.addEventListener('dragleave', handleContainerDragLeave);
        colContent.addEventListener('drop', handleDrop);
    });

    // Drag and Drop for Backlog
    backlogList.addEventListener('dragover', handleDragOver);
    backlogList.addEventListener('dragleave', handleContainerDragLeave);
    backlogList.addEventListener('drop', handleDrop);

    // Drag and Drop for Container Backgrounds (to clear planned date)
    boardView.addEventListener('dragover', handleContainerDragOver);
    boardView.addEventListener('drop', handleContainerDrop);
    backlogView.addEventListener('dragover', handleContainerDragOver);
    backlogView.addEventListener('drop', handleContainerDrop);

    // Drag and Drop for Move to Todo
    moveToTodoList.addEventListener('dragover', handleDragOver);
    moveToTodoList.addEventListener('drop', handleDrop);
    moveToTodoList.addEventListener('dragenter', (e) => {
        e.preventDefault();
        moveToTodoList.classList.add('drag-over');
    });
    moveToTodoList.addEventListener('dragleave', handleContainerDragLeave);


    // Navigation
    navBoard.addEventListener('click', () => switchView('board'));
    navBacklog.addEventListener('click', () => switchView('backlog'));

    // Delete Issue
    deleteIssueBtn.addEventListener('click', handleDeleteIssue);

    // Sidebar Toggles
    btnDeadlines.addEventListener('click', () => toggleSidebar('deadlines'));
    btnPlanning.addEventListener('click', () => toggleSidebar('planning'));

    // Date input styling
    document.querySelectorAll('input[type="date"]').forEach(input => {
        input.addEventListener('input', () => updateDateInputStyle(input));
        input.addEventListener('change', () => updateDateInputStyle(input));
        updateDateInputStyle(input);
    });

    // Task Form Handling
    const addTaskBtn = document.getElementById('add-task-btn');
    if (addTaskBtn) {
        addTaskBtn.addEventListener('click', handleTaskSubmit);
    }

    // Allow Enter key in task title to submit
    const newTaskTitleInput = document.getElementById('new-task-title');
    if (newTaskTitleInput) {
        newTaskTitleInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleTaskSubmit(e);
            }
        });
    }

    // Task List Drag and Drop
    taskList.addEventListener('dragover', handleTaskDragOver);
    taskList.addEventListener('drop', handleTaskDrop);

    // Editor Toolbar
    // Editor Toolbar
    const editor = document.getElementById('description-editor');
    const toolbarBtns = document.querySelectorAll('.editor-btn');

    function updateToolbarState() {
        toolbarBtns.forEach(btn => {
            const cmd = btn.dataset.cmd;
            if (document.queryCommandState(cmd)) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    toolbarBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            // Use currentTarget to ensure we get the button even if clicking the SVG/icon inside
            const cmd = e.currentTarget.dataset.cmd;
            document.execCommand(cmd, false, null);
            editor.focus(); // Keep focus in editor
            updateToolbarState();
        });
    });

    if (editor) {
        editor.addEventListener('keyup', updateToolbarState);
        editor.addEventListener('mouseup', updateToolbarState);
        editor.addEventListener('input', (e) => {
            updateToolbarState();
            handleAutoList(e);
        });
    }

    function handleAutoList(e) {
        // Only trigger on space
        if (e.data !== ' ') return;

        const selection = window.getSelection();
        if (!selection.isCollapsed) return;

        const anchorNode = selection.anchorNode;
        if (!anchorNode || anchorNode.nodeType !== Node.TEXT_NODE) return;

        const text = anchorNode.textContent;
        const offset = selection.anchorOffset;

        // Check for bullet list: "* " or "- " at the start of the line
        const bulletMatch = text.slice(0, offset).match(/^(\*|-)\s$/);
        if (bulletMatch) {
            // Select the trigger characters
            const range = document.createRange();
            range.setStart(anchorNode, 0);
            range.setEnd(anchorNode, offset);
            selection.removeAllRanges();
            selection.addRange(range);

            // Delete the trigger characters using execCommand to ensure proper history/cursor handling
            document.execCommand('delete');

            // Apply the list formatting
            document.execCommand('insertUnorderedList');
            return;
        }

        // Check for numbered list: "1. " at the start of the line
        const numberMatch = text.slice(0, offset).match(/^1\.\s$/);
        if (numberMatch) {
            // Select the trigger characters
            const range = document.createRange();
            range.setStart(anchorNode, 0);
            range.setEnd(anchorNode, offset);
            selection.removeAllRanges();
            selection.addRange(range);

            // Delete the trigger characters
            document.execCommand('delete');

            // Apply the list formatting
            document.execCommand('insertOrderedList');
            return;
        }
    }
}

function switchView(view) {
    if (view === 'board') {
        boardView.classList.remove('hidden');
        backlogView.classList.add('hidden');
        navBoard.classList.add('active');
        navBacklog.classList.remove('active');
        sidebar.classList.remove('hidden');
        viewToggles.classList.remove('hidden');
    } else {
        boardView.classList.add('hidden');
        backlogView.classList.remove('hidden');
        navBoard.classList.remove('active');
        navBacklog.classList.add('active');
        sidebar.classList.add('hidden');
        viewToggles.classList.add('hidden');
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
        renderPlanningPanel();
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
        renderPlanningPanel();
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
    moveToTodoList.innerHTML = '';
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
    const deadlineCount = document.getElementById('deadline-count');
    deadlineList.innerHTML = '';

    const deadlineItems = [];
    issues.forEach(issue => {
        // Add issue deadline if exists and not done
        if (issue.deadline && issue.status !== 'Done') {
            deadlineItems.push({
                id: issue.id,
                issue_id: issue.id,
                title: issue.title,
                deadline: issue.deadline,
                issueTitle: 'Issue',
                isIssue: true
            });
        }

        // Add task deadlines
        if (issue.tasks) {
            issue.tasks.forEach(task => {
                if (task.deadline && !task.done) {
                    deadlineItems.push({
                        ...task,
                        issueTitle: issue.title,
                        isIssue: false
                    });
                }
            });
        }
    });

    // Sort by deadline
    deadlineItems.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));

    // Update count
    deadlineCount.textContent = deadlineItems.length;

    deadlineItems.forEach(item => {
        const li = document.createElement('li');
        li.className = 'deadline-item';
        li.dataset.issueId = item.issue_id;

        const itemDeadline = new Date(item.deadline);
        const now = new Date();
        const isOverdue = itemDeadline < now;

        const date = itemDeadline.toLocaleDateString(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric'
        });

        li.innerHTML = `
            <span class="deadline-date ${isOverdue ? 'overdue' : ''}">
                ${isOverdue ? '<span class="overdue-indicator">⚠️</span>' : ''}${date}
            </span>
            <span class="deadline-task" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
        `;

        // Add click handler to highlight the issue
        li.style.cursor = 'pointer';
        li.addEventListener('click', () => {
            const issue = issues.find(i => i.id === item.issue_id);
            if (issue) {
                // Switch view if necessary
                if (issue.status === 'Open' && backlogView.classList.contains('hidden')) {
                    switchView('backlog');
                } else if (issue.status !== 'Open' && boardView.classList.contains('hidden')) {
                    switchView('board');
                }

                // Highlight after a brief delay to allow view transition
                setTimeout(() => highlightIssueCard(issue.id), 100);
            }
        });

        // Add hover handlers to highlight the corresponding card
        li.addEventListener('mouseenter', () => {
            const targetCard = document.querySelector(`.card[data-id="${item.issue_id}"]`);
            // Only highlight if visible
            if (targetCard && targetCard.offsetParent !== null) {
                targetCard.classList.add('hover-highlight');
            }
        });

        li.addEventListener('mouseleave', () => {
            const targetCard = document.querySelector(`.card[data-id="${item.issue_id}"]`);
            if (targetCard) {
                targetCard.classList.remove('hover-highlight');
            }
        });

        deadlineList.appendChild(li);
    });
}

function renderPlanningPanel() {
    planningList.innerHTML = '';
    let count = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Helper to get local YYYY-MM-DD
    const getLocalISODate = (d) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    // Past Section
    const pastContainer = createPlanningDayElement('Past', 'past');
    planningList.appendChild(pastContainer);

    // Next 10 Days
    for (let i = 0; i < 10; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() + i);
        const dateStr = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        const dateId = getLocalISODate(date);
        const dayContainer = createPlanningDayElement(dateStr, dateId);
        planningList.appendChild(dayContainer);
    }

    // Populate Issues
    issues.forEach(issue => {
        if (issue.planned_date) {
            const planned = new Date(issue.planned_date);

            let targetId;
            if (planned < today) {
                targetId = 'day-past';
            } else {
                const plannedId = getLocalISODate(planned);
                targetId = `day-${plannedId}`;
            }

            if (targetId) {
                const container = document.getElementById(targetId);
                if (container) {
                    const content = container.querySelector('.planning-day-content');
                    content.appendChild(createPlanningItem(issue));
                    count++;
                }
            }
        }
    });

    planningCount.textContent = count;

    // Mark empty days
    document.querySelectorAll('.planning-day').forEach(day => {
        const content = day.querySelector('.planning-day-content');
        if (content.children.length === 0) {
            day.classList.add('empty');
        } else {
            day.classList.remove('empty');
        }
    });
}

function createPlanningDayElement(title, idSuffix) {
    const div = document.createElement('div');
    div.className = `planning-day ${idSuffix === 'past' ? 'past' : ''}`;
    div.id = `day-${idSuffix}`;
    div.dataset.date = idSuffix === 'past' ? 'past' : idSuffix;

    div.innerHTML = `
        <div class="planning-day-header">
            <span class="planning-date">${title}</span>
        </div>
        <div class="planning-day-content"></div>
    `;

    div.addEventListener('dragover', (e) => {
        e.preventDefault();
        // Visual cue
        document.querySelectorAll('.planning-day').forEach(el => el.classList.remove('drag-over'));
        div.classList.add('drag-over');
    });
    div.addEventListener('dragleave', (e) => {
        // Only remove if we are leaving the element, not entering a child
        if (!div.contains(e.relatedTarget)) {
            div.classList.remove('drag-over');
        }
    });
    div.addEventListener('drop', handlePlanningDrop);

    return div;
}

function createPlanningItem(issue) {
    const div = document.createElement('div');
    div.className = 'planning-item';
    div.textContent = issue.title;
    div.draggable = true;
    div.dataset.id = issue.id;
    div.addEventListener('dragstart', handleDragStart);
    div.addEventListener('dragend', handleDragEnd); // Re-use dragend to cleanup

    // Hover handlers to highlight the corresponding card
    div.addEventListener('mouseenter', () => {
        const targetCard = document.querySelector(`.card[data-id="${issue.id}"]`);
        if (targetCard && targetCard.offsetParent !== null) {
            targetCard.classList.add('hover-highlight');
        }
    });

    div.addEventListener('mouseleave', () => {
        const targetCard = document.querySelector(`.card[data-id="${issue.id}"]`);
        if (targetCard) {
            targetCard.classList.remove('hover-highlight');
        }
    });

    return div;
}

async function handlePlanningDrop(e) {
    e.preventDefault();
    this.classList.remove('drag-over');
    const dateStr = this.dataset.date;

    if (draggedCard) {
        // Mark as dropped in planning so dragEnd knows to revert DOM
        draggedCard.dataset.droppedInPlanning = 'true';

        const issueId = parseInt(draggedCard.dataset.id);
        const issue = issues.find(i => i.id === issueId);

        if (issue && dateStr !== 'past') {
            const [y, m, d] = dateStr.split('-').map(Number);
            const newDate = new Date(y, m - 1, d, 12, 0, 0, 0);

            // Only update if date changed
            const oldDate = issue.planned_date ? new Date(issue.planned_date).setHours(12, 0, 0, 0) : 0;
            if (newDate.getTime() !== oldDate) {
                issue.planned_date = newDate;
                await updateIssue(issue);
                renderPlanningPanel();
            }
        }
    }
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
            <div class="card-title"><span class="card-id">Issue #${issue.id}</span> ${escapeHtml(issue.title)}</div>
            <div class="card-description">${escapeHtml(stripHtml(issue.description || ''))}</div>
        </div>
        ${(() => {
            if (issue.status === 'Open' || !issue.tasks) return '';
            const openTasks = issue.tasks.filter(t => !t.done);
            if (openTasks.length === 0) return '';

            return `<div class="card-tasks">
                ${openTasks.map(t => `
                    <div class="card-task-item">
                        <span class="card-task-icon">☐</span>
                        <span class="card-task-title">${escapeHtml(t.title)}</span>
                        ${t.deadline ? `<span class="card-task-deadline">📅 ${new Date(t.deadline).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}</span>` : ''}
                    </div>
                `).join('')}
            </div>`;
        })()}
        ${(() => {
            const hasDeadline = !!issue.deadline;
            const showProgress = issue.status === 'Open' && totalTasks > 0;

            if (!hasDeadline && !showProgress) return '';

            return `<div class="card-meta">
                ${hasDeadline ? `<span>📅 ${new Date(issue.deadline).toLocaleDateString()}</span>` : '<span></span>'}
                ${showProgress ? `<div class="task-progress">Tasks: ${totalTasks}</div>` : ''}
            </div>`;
        })()}
    `;

    card.addEventListener('click', () => openModal(issue));
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragend', handleDragEnd);

    // Hover handlers to highlight the corresponding planning item and deadline item
    card.addEventListener('mouseenter', () => {
        const targetItem = document.querySelector(`.planning-item[data-id="${issue.id}"]`);
        if (targetItem) {
            targetItem.classList.add('hover-highlight');
        }
        document.querySelectorAll(`.deadline-item[data-issue-id="${issue.id}"]`).forEach(el => {
            el.classList.add('hover-highlight');
        });
    });

    card.addEventListener('mouseleave', () => {
        const targetItem = document.querySelector(`.planning-item[data-id="${issue.id}"]`);
        if (targetItem) {
            targetItem.classList.remove('hover-highlight');
        }
        document.querySelectorAll(`.deadline-item[data-issue-id="${issue.id}"]`).forEach(el => {
            el.classList.remove('hover-highlight');
        });
    });

    return card;
}

function stripHtml(html) {
    if (!html) return '';

    // Add spaces around block-level tags to prevent text merging
    // This handles <div>, <p>, <br>, <li>, etc. (both opening and closing tags)
    const processed = html.replace(
        /<\/?(div|p|li|ul|ol|h[1-6]|blockquote|pre|br)\b[^>]*>/gi,
        ' $& '
    );

    const tmp = document.createElement("DIV");
    tmp.innerHTML = processed;
    const text = tmp.textContent || tmp.innerText || "";

    // Collapse multiple spaces into one and trim
    return text.replace(/\s+/g, ' ').trim();
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

    const commentsSection = document.querySelector('.comments-section-placeholder');


    if (issue) {
        document.getElementById('modal-title').textContent = 'Edit Issue';
        document.getElementById('issue-id').value = issue.id;
        document.getElementById('title').value = issue.title;
        document.getElementById('description-editor').innerHTML = issue.description || '';
        document.getElementById('planned-date').value = issue.planned_date ? new Date(issue.planned_date).toISOString().slice(0, 10) : '';
        document.getElementById('deadline').value = issue.deadline ? new Date(issue.deadline).toISOString().slice(0, 10) : '';
        statusSelect.value = issue.status;

        updateDateInputStyle(document.getElementById('planned-date'));
        updateDateInputStyle(document.getElementById('deadline'));

        tasksSection.classList.remove('hidden');
        renderTasks(issue.tasks || []);
        deleteIssueBtn.classList.remove('hidden');

        // Show comments and reset description size for Edit Issue
        if (commentsSection) commentsSection.classList.remove('hidden');
    } else {
        document.getElementById('modal-title').textContent = 'New Issue';
        document.getElementById('issue-form').reset();
        document.getElementById('description-editor').innerHTML = '';
        document.getElementById('issue-id').value = '';
        statusSelect.value = 'Open'; // Default for new issues

        updateDateInputStyle(document.getElementById('planned-date'));
        updateDateInputStyle(document.getElementById('deadline'));

        tasksSection.classList.add('hidden');
        deleteIssueBtn.classList.add('hidden');

        // Hide comments and enlarge description for New Issue
        if (commentsSection) commentsSection.classList.add('hidden');
    }
    resetTaskForm();
}

function closeModal() {
    modal.classList.add('hidden');
    currentIssue = null;
    resetTaskForm();
}

function showNotification(message) {
    notificationToast.textContent = message;
    notificationToast.classList.remove('hidden');
    setTimeout(() => {
        notificationToast.classList.add('hidden');
    }, 5000);
}

// Custom Confirmation Dialog
function showConfirm(title, message, okButtonText = 'Delete') {
    return new Promise((resolve) => {
        confirmTitle.textContent = title;
        confirmMessage.textContent = message;
        confirmOkBtn.textContent = okButtonText;
        confirmModal.classList.remove('hidden');

        const handleOk = () => {
            confirmModal.classList.add('hidden');
            cleanup();
            resolve(true);
        };

        const handleCancel = () => {
            confirmModal.classList.add('hidden');
            cleanup();
            resolve(false);
        };

        const cleanup = () => {
            confirmOkBtn.removeEventListener('click', handleOk);
            confirmCancelBtn.removeEventListener('click', handleCancel);
            confirmModal.removeEventListener('click', handleModalClick);
        };

        const handleModalClick = (e) => {
            if (e.target === confirmModal) {
                handleCancel();
            }
        };

        confirmOkBtn.addEventListener('click', handleOk);
        confirmCancelBtn.addEventListener('click', handleCancel);
        confirmModal.addEventListener('click', handleModalClick);
    });
}


async function handleDeleteIssue() {
    if (!currentIssue) return;

    const confirmed = await showConfirm(
        'Delete Issue',
        `Are you sure you want to delete "${currentIssue.title}"? This will also delete all associated tasks.`,
        'Delete'
    );

    if (confirmed) {
        await deleteIssue(currentIssue.id);
        closeModal();
        fetchIssues();
    }
}

async function handleIssueSubmit(e) {
    e.preventDefault();

    const issueData = {
        title: document.getElementById('title').value,
        description: document.getElementById('description-editor').innerHTML,
        deadline: document.getElementById('deadline').value ? new Date(document.getElementById('deadline').value + 'T12:00:00') : null,
        planned_date: document.getElementById('planned-date').value ? new Date(document.getElementById('planned-date').value + 'T12:00:00') : null,
        status: statusSelect.value,
        position: currentIssue ? currentIssue.position : 0 // Backend handles new position
    };

    if (currentIssue) {
        issueData.id = currentIssue.id;
        await updateIssue(issueData);
    } else {
        const newIssue = await createIssue(issueData);
        showNotification(`Issue #${newIssue.id} created successfully`);
    }

    closeModal();
    fetchIssues();
}

// Task Handling
// Task Handling
function renderTasks(tasks) {
    taskList.innerHTML = '';

    // Sort tasks by position
    tasks.sort((a, b) => a.position - b.position);

    tasks.forEach(task => {
        const li = document.createElement('li');
        li.className = `task-item ${task.done ? 'done' : ''}`;
        li.draggable = true;
        li.dataset.id = task.id;

        li.innerHTML = `
            <span class="task-drag-handle">⋮⋮</span>
            <input type="checkbox" id="task-check-${task.id}" name="task_check_${task.id}" ${task.done ? 'checked' : ''}>
            <div class="task-info">
                <input type="text" id="task-title-${task.id}" name="task_title_${task.id}" class="task-title-input" value="${escapeHtml(task.title)}" title="${escapeHtml(task.title)}">
                <div class="task-actions">
                    <div class="task-deadline-container" title="Set Deadline">
                        <span class="task-deadline task-deadline-display">
                            ${task.deadline ? `📅 ${new Date(task.deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : '📅'}
                        </span>
                        <input type="date" id="task-deadline-${task.id}" name="task_deadline_${task.id}" class="task-deadline-input" value="${task.deadline ? new Date(task.deadline).toISOString().slice(0, 10) : ''}">
                    </div>
                    <div class="delete-task-btn" title="Delete Task">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </div>
                </div>
            </div>
        `;

        // Drag events
        li.addEventListener('dragstart', handleTaskDragStart);
        li.addEventListener('dragend', handleTaskDragEnd);

        const checkbox = li.querySelector('input[type="checkbox"]');
        checkbox.addEventListener('change', async () => {
            task.done = checkbox.checked;
            await updateTask(task);
            fetchIssues();
            li.className = `task-item ${task.done ? 'done' : ''}`;
        });

        const titleInput = li.querySelector('.task-title-input');

        // Prevent drag when interacting with input
        titleInput.addEventListener('mousedown', (e) => {
            li.draggable = false;
            e.stopPropagation();
        });

        titleInput.addEventListener('blur', async () => {
            li.draggable = true;
            const newTitle = titleInput.value.trim();
            if (newTitle !== task.title) {
                if (!newTitle) {
                    // Revert if empty
                    titleInput.value = task.title;
                    return;
                }
                task.title = newTitle;
                await updateTask(task);
                // No fetchIssues() here to prevent re-rendering and losing focus/state if user is quick
                // But we should update the local state if needed.
                // Since we updated the task object, it should be fine.
            }
        });

        titleInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                titleInput.blur();
            }
        });

        const deadlineContainer = li.querySelector('.task-deadline-container');
        const deadlineInput = li.querySelector('.task-deadline-input');

        deadlineContainer.addEventListener('click', () => {
            deadlineInput.showPicker();
        });

        deadlineInput.addEventListener('change', async () => {
            const newDate = deadlineInput.value ? new Date(deadlineInput.value + 'T12:00:00') : null;
            task.deadline = newDate;
            await updateTask(task);

            // Update display
            const display = li.querySelector('.task-deadline-display');
            display.innerHTML = task.deadline ? `📅 ${new Date(task.deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : '📅';

            // fetchIssues(); // Optional: might cause re-render
        });

        const deleteBtn = li.querySelector('.delete-task-btn');
        deleteBtn.addEventListener('click', async () => {
            const confirmed = await showConfirm(
                'Delete Task',
                `Are you sure you want to delete "${task.title}"?`,
                'Delete'
            );

            if (confirmed) {
                await deleteTask(task.id);
                currentIssue.tasks = currentIssue.tasks.filter(t => t.id !== task.id);
                renderTasks(currentIssue.tasks);
                fetchIssues();
            }
        });

        taskList.appendChild(li);
    });
}

// Removed handleTaskEdit and resetTaskForm as they are no longer needed for inline editing

function resetTaskForm() {

    const titleInput = document.getElementById('new-task-title');
    const deadlineInput = document.getElementById('new-task-deadline');
    const addBtn = document.getElementById('add-task-btn');

    titleInput.value = '';
    deadlineInput.value = '';
    updateDateInputStyle(deadlineInput);

    addBtn.textContent = 'Add';
    addBtn.classList.remove('primary');
    addBtn.classList.add('secondary');
}



// ... (rest of the file)

async function handleTaskSubmit(e) {
    e.preventDefault();
    if (!currentIssue) return;

    const titleInput = document.getElementById('new-task-title');
    const deadlineInput = document.getElementById('new-task-deadline');

    if (!titleInput.value.trim()) return;

    const deadline = deadlineInput.value ? new Date(deadlineInput.value + 'T12:00:00') : null;

    const taskData = {
        issue_id: currentIssue.id,
        title: titleInput.value,
        done: false,
        deadline: deadlineInput.value ? new Date(deadlineInput.value + 'T12:00:00') : null,
        position: currentIssue.tasks ? currentIssue.tasks.length : 0
    };

    const newTask = await createTask(taskData);
    if (!currentIssue.tasks) currentIssue.tasks = [];
    currentIssue.tasks.push(newTask);

    renderTasks(currentIssue.tasks);
    titleInput.value = '';
    deadlineInput.value = '';
    updateDateInputStyle(deadlineInput);
    fetchIssues();
}

function updateDateInputStyle(input) {
    if (input.value) {
        input.classList.add('has-value');
    } else {
        input.classList.remove('has-value');
    }
}

// Drag and Drop Logic
let draggedCard = null;
let draggedCardOrigin = null;

function handleDragStart(e) {
    draggedCard = this;
    draggedCardOrigin = {
        parent: this.parentNode,
        nextSibling: this.nextElementSibling
    };
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd(e) {
    this.classList.remove('dragging');

    // If dropped in planning (and it's a board card), revert DOM position
    // This prevents the card from staying in a column it was dragged over
    if (this.dataset.droppedInPlanning === 'true' && this.classList.contains('card')) {
        if (draggedCardOrigin && draggedCardOrigin.parent) {
            draggedCardOrigin.parent.insertBefore(this, draggedCardOrigin.nextSibling);
        }
        delete this.dataset.droppedInPlanning;
    } else {
        // Only save board state if it wasn't a planning drop
        // And only if it's a card (not a planning item)
        if (this.classList.contains('card')) {
            saveBoardState();
        }
    }

    draggedCard = null;
    draggedCardOrigin = null;
}

function handleContainerDragLeave(e) {
    if (this.id === 'move-to-todo-list') {
        this.classList.remove('drag-over');
    }

    if (!draggedCard || !draggedCard.classList.contains('card')) return;

    // Check if we are really leaving the container
    if (this.contains(e.relatedTarget)) return;

    // Revert to origin
    if (draggedCardOrigin && draggedCardOrigin.parent) {
        draggedCardOrigin.parent.insertBefore(draggedCard, draggedCardOrigin.nextSibling);
    }
}

function handleDragOver(e) {
    if (!draggedCard) return;

    // Allow cards and planning items
    if (draggedCard.classList.contains('card') || draggedCard.classList.contains('planning-item')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    } else {
        return;
    }

    // Only do visual sorting/insertion for cards
    // For planning items, only show insertion if dropping in backlog/move-to-todo
    if (draggedCard.classList.contains('card')) {
        const container = this; // This is now .column-content
        const afterElement = getDragAfterElement(container, e.clientY);

        if (afterElement == null) {
            container.appendChild(draggedCard);
        } else {
            container.insertBefore(draggedCard, afterElement);
        }
    } else if (draggedCard.classList.contains('planning-item')) {
        // Only for backlog/move-to-todo
        if (this.id === 'backlog-list' || this.id === 'move-to-todo-list') {
            const container = this;
            const afterElement = getDragAfterElement(container, e.clientY);
            if (afterElement == null) {
                container.appendChild(draggedCard);
            } else {
                container.insertBefore(draggedCard, afterElement);
            }
        }
    }
}

function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation(); // Prevent bubbling to container handlers
    if (e.currentTarget.id === 'move-to-todo-list') {
        e.currentTarget.classList.remove('drag-over');
    }

    if (!draggedCard) return;

    // Handle dropping a planning item onto the board (clears planned date)
    if (draggedCard.classList.contains('planning-item')) {
        const issueId = parseInt(draggedCard.dataset.id);
        const issue = issues.find(i => i.id === issueId);
        if (issue) {
            const container = e.currentTarget;
            let newStatus = issue.status;

            // Determine status based on drop target
            if (container.id === 'backlog-list') {
                newStatus = 'Open';
            } else if (container.id === 'move-to-todo-list') {
                newStatus = 'Todo';
                const todoIssues = issues.filter(i => i.status === 'Todo');
                issue.position = todoIssues.length;
            }
            // If dropped on a column (container.closest('.column')), keep existing status
            // This allows users to drop on the board to unschedule without accidentally changing status

            issue.planned_date = null;
            issue.status = newStatus;

            updateIssue(issue).then(() => {
                fetchIssues();
            });
        }
        return;
    }

    if (!draggedCard.classList.contains('card')) return;
}

function handleContainerDragOver(e) {
    if (!draggedCard) return;
    // Only allow planning items to be dropped on background
    if (draggedCard.classList.contains('planning-item')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }
}

function handleContainerDrop(e) {
    e.preventDefault();
    if (!draggedCard || !draggedCard.classList.contains('planning-item')) return;

    const issueId = parseInt(draggedCard.dataset.id);
    const issue = issues.find(i => i.id === issueId);

    if (issue) {
        issue.planned_date = null;

        // If dropped on Backlog view background, ensure status is Open
        if (e.currentTarget === backlogView) {
            issue.status = 'Open';
        }
        // If dropped on Board view background, keep current status 
        // (unless it was Open, but then it won't show on board, which is expected behavior for "removing from plan")

        updateIssue(issue).then(() => {
            fetchIssues();
        });
    }
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
    let todoCount = 0;

    document.querySelectorAll('.column').forEach(col => {
        const status = col.dataset.status;
        const cards = [...col.querySelectorAll('.column-content .card')];

        if (status === 'Todo') {
            todoCount = cards.length;
        }

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

    // Handle Move to Todo
    const moveToTodoCards = [...moveToTodoList.querySelectorAll('.card')];
    moveToTodoCards.forEach((card, index) => {
        const id = parseInt(card.dataset.id);
        const issue = issues.find(i => i.id === id);

        if (issue) {
            issue.status = 'Todo';
            // Append to the "Todo" column
            issue.position = todoCount + index;
            updates.push(updateIssue(issue));
        }
    });


    await Promise.all(updates);

    // Refresh board and backlog
    if (moveToTodoCards.length > 0) {
        setTimeout(async () => {
            await fetchIssues();
        }, 5000);
    }
}

// Task Drag and Drop Functions
function handleTaskDragStart(e) {
    draggedTask = this;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handleTaskDragEnd(e) {
    this.classList.remove('dragging');
    draggedTask = null;
    saveTaskOrder();
}

function handleTaskDragOver(e) {
    e.preventDefault();
    if (!draggedTask) return;

    const container = taskList;
    const afterElement = getDragAfterTaskElement(container, e.clientY);

    if (afterElement == null) {
        container.appendChild(draggedTask);
    } else {
        container.insertBefore(draggedTask, afterElement);
    }
}

function handleTaskDrop(e) {
    e.preventDefault();
}

function getDragAfterTaskElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.task-item:not(.dragging)')];

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

async function saveTaskOrder() {
    if (!currentIssue || !currentIssue.tasks) return;

    const taskItems = [...taskList.querySelectorAll('.task-item')];
    const updates = [];

    taskItems.forEach((item, index) => {
        const id = parseInt(item.dataset.id);
        const task = currentIssue.tasks.find(t => t.id === id);

        if (task && task.position !== index) {
            task.position = index;
            updates.push(updateTask(task));
        }
    });

    if (updates.length > 0) {
        await Promise.all(updates);
        // Update local array order
        currentIssue.tasks.sort((a, b) => a.position - b.position);
    }
}
