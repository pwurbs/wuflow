#!/usr/bin/env bash
# seed_demo_data.sh — Loads realistic demo data into a fresh wuFlow SQLite database.
#
# Usage:
#   ./seed_demo_data.sh                  (prompts for DB path and password)
#   ./seed_demo_data.sh wuflow.db        (prompts for password only)
#   ./seed_demo_data.sh wuflow.db secret (non-interactive)
#
# The script creates the database file from scratch, including the full schema.
# The target path must not exist — the script exits immediately if it does.
#
# Creates:
#   - 4 demo team members (admin + 3 users)
#   - 2 projects with custom board column names
#   - Labels and releases per project
#   - 31 realistic issues spread across all board statuses
#   - Subtasks for several of those issues
#   - All dates are relative to today, so the data stays current on every run.
#
# Requirements: sqlite3, python3 (with the bcrypt package installed).

set -euo pipefail

# ── Helpers ───────────────────────────────────────────────────────────────────

ask() {
  local prompt="$1" default="$2" reply
  read -rp "$prompt" reply
  echo "${reply:-$default}"
}

ask_password() {
  local prompt="$1" pw
  # Read without echo
  if [ -t 0 ]; then
    read -rsp "$prompt" pw
    echo >&2   # newline after hidden input
  else
    read -rp "$prompt" pw
  fi
  echo "$pw"
}

# ── Arguments / prompts ───────────────────────────────────────────────────────

DB="${1:-}"
PASSWORD="${2:-}"

if [ -z "$DB" ]; then
  DB=$(ask "Database path [wuflow.db]: " "wuflow.db")
fi

if [ -f "$DB" ]; then
  echo "Error: '$DB' already exists. Remove it first or choose a different path." >&2
  exit 1
fi

if [ -z "$PASSWORD" ]; then
  PASSWORD=$(ask_password "Password for demo users: ")
fi

if [ -z "$PASSWORD" ]; then
  echo "Error: password must not be empty." >&2
  exit 1
fi

# ── Generate bcrypt hash ───────────────────────────────────────────────────────

echo "Generating password hash…"
HASH=$(WF_DEMO_PW="$PASSWORD" python3 - <<'PYEOF'
import os, sys
try:
    import bcrypt
except ImportError:
    sys.exit("Error: python3 'bcrypt' package is missing. Install it with:  pip3 install bcrypt")
pw = os.environ["WF_DEMO_PW"].encode()
print(bcrypt.hashpw(pw, bcrypt.gensalt(12)).decode())
PYEOF
)

echo "Seeding demo data into '$DB'…"

# ── SQL ───────────────────────────────────────────────────────────────────────

sqlite3 "$DB" <<SQL
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = OFF;
BEGIN;

-- ── Schema ────────────────────────────────────────────────────────────────────
CREATE TABLE projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT ''
);
CREATE TABLE releases (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id   INTEGER NOT NULL,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    start_date   DATETIME,
    release_date DATETIME,
    closed_at    DATETIME,
    status       TEXT NOT NULL DEFAULT 'open',
    owner_id     INTEGER,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (owner_id)   REFERENCES users(id)    ON DELETE SET NULL,
    UNIQUE(project_id, name)
);
CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    first_name    TEXT NOT NULL,
    last_name     TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',
    active        BOOLEAN NOT NULL DEFAULT 1,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE labels (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    color      TEXT NOT NULL,
    project_id INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE TABLE project_status_config (
    project_id  INTEGER PRIMARY KEY,
    stage1_name TEXT NOT NULL DEFAULT 'Pending',
    stage2_name TEXT NOT NULL DEFAULT 'Working',
    stage3_name TEXT NOT NULL DEFAULT '',
    stage4_name TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE TABLE issues (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT NOT NULL,
    description  TEXT,
    status       TEXT NOT NULL,
    position     INTEGER NOT NULL,
    deadline     DATETIME,
    planned_dates TEXT,
    label_id     INTEGER,
    priority     TEXT DEFAULT 'Normal',
    creator_id   INTEGER,
    assignee_id  INTEGER,
    updated_by   INTEGER,
    project_id   INTEGER NOT NULL DEFAULT 1,
    release_id   INTEGER,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (label_id)    REFERENCES labels(id)   ON DELETE SET NULL,
    FOREIGN KEY (creator_id)  REFERENCES users(id)    ON DELETE SET NULL,
    FOREIGN KEY (assignee_id) REFERENCES users(id)    ON DELETE SET NULL,
    FOREIGN KEY (updated_by)  REFERENCES users(id)    ON DELETE SET NULL,
    FOREIGN KEY (project_id)  REFERENCES projects(id),
    FOREIGN KEY (release_id)  REFERENCES releases(id) ON DELETE SET NULL
);
CREATE TABLE tasks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id   INTEGER NOT NULL,
    title      TEXT NOT NULL,
    done       BOOLEAN NOT NULL DEFAULT 0,
    position   INTEGER NOT NULL DEFAULT 0,
    deadline   DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
);
CREATE TABLE sessions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);

-- ── Default project (id = 1, required by the app) ─────────────────────────────
INSERT INTO projects (id, name, description) VALUES
  (1, 'Development', 'Core product development and bug tracking');

-- ── Users ─────────────────────────────────────────────────────────────────────
INSERT INTO users (id, email, first_name, last_name, password_hash, role, active) VALUES
  (2, 'sarah.chen@wuflow.demo',    'Sarah',  'Chen',     '$HASH', 'sysadmin', 1),
  (3, 'marcus.weber@wuflow.demo',  'Marcus', 'Weber',    '$HASH', 'admin', 1),
  (4, 'lena.hoffmann@wuflow.demo', 'Lena',   'Hoffmann', '$HASH', 'user',  1),
  (5, 'tom.fischer@wuflow.demo',   'Tom',    'Fischer',  '$HASH', 'user',  1);
INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES ('users', 5);

-- ── Projects ──────────────────────────────────────────────────────────────────
-- Project 1 already updated above (id = 1)
INSERT INTO projects (id, name, description) VALUES
  (2, 'Website', 'Corporate website redesign and ongoing maintenance');
INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES ('projects', 2);

-- ── Board status config ───────────────────────────────────────────────────────
-- Project 1 row may already exist from the app's startup migration, so use REPLACE.
INSERT OR REPLACE INTO project_status_config (project_id, stage1_name, stage2_name, stage3_name, stage4_name) VALUES
  (1, 'Working', 'Testing', 'Release', ''),
  (2, 'Draft',     'Review',     '',        '');

-- ── Labels ────────────────────────────────────────────────────────────────────
-- Project 1
INSERT INTO labels (id, name, color, project_id) VALUES
  (1, 'Bug',          '#e74c3c', 1),
  (2, 'Feature',      '#3498db', 1),
  (3, 'Enhancement',  '#27ae60', 1),
  (4, 'Documentation','#f39c12', 1),
  (5, 'Performance',  '#9b59b6', 1);
-- Project 2
INSERT INTO labels (id, name, color, project_id) VALUES
  (6, 'Design',    '#e91e63', 2),
  (7, 'Content',   '#00bcd4', 2),
  (8, 'Technical', '#607d8b', 2),
  (9, 'SEO',       '#ff9800', 2);
INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES ('labels', 9);

-- ── Releases ──────────────────────────────────────────────────────────────────
-- Project 1
INSERT INTO releases (id, project_id, name, description, start_date, release_date, closed_at, status, owner_id) VALUES
  (1, 1, 'v1.2.0',
   'Initial release: core Kanban board, user management, and label support.',
   datetime('now', '-70 days'), datetime('now', '-21 days'), datetime('now', '-21 days'),
   'closed', 2),
  (2, 1, 'v1.3.0',
   'Multi-project support, release management view, and UX improvements.',
   datetime('now', '-28 days'), datetime('now', '+14 days'), NULL,
   'open', 2),
  (3, 1, 'v1.4.0',
   'Issue search and filtering, bulk operations, and OAuth2 / SSO integration.',
   datetime('now', '+21 days'), datetime('now', '+70 days'), NULL,
   'open', 2),
  (6, 1, 'v2.0.0',
   'Next major release: full UX redesign, mobile app, and enterprise SSO.',
   datetime('now', '+90 days'), datetime('now', '+180 days'), NULL,
   'open', 2);
-- Project 2
INSERT INTO releases (id, project_id, name, description, start_date, release_date, closed_at, status, owner_id) VALUES
  (4, 2, 'Q1 2025 Refresh',
   'Hosting migration, brand refresh, and GDPR compliance updates.',
   datetime('now', '-98 days'), datetime('now', '-42 days'), datetime('now', '-42 days'),
   'closed', 3),
  (5, 2, 'Q2 2025 Launch',
   'Full redesign of pricing, homepage, and contact pages.',
   datetime('now', '-14 days'), datetime('now', '+28 days'), NULL,
   'open', 4);
INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES ('releases', 6);

-- ── Issues — Project 1: Development ─────────────────────────────────────────

-- Open (unscheduled backlog)
INSERT INTO issues (id, title, description, status, position, priority, label_id, creator_id, assignee_id, project_id, release_id, deadline, created_at) VALUES
  (1,
   'Dark mode support',
   'Add a system-aware dark colour theme to the board and all modals. Should follow the prefers-color-scheme media query.',
   'Open', 1, 'Normal', 2, 2, NULL, 1, 3, NULL,
   datetime('now', '-5 days')),
  (2,
   'Bulk issue operations',
   'Allow selecting multiple issues to move, relabel, or delete them in one action. Useful for sprint cleanup.',
   'Open', 2, 'Normal', 3, 3, NULL, 1, 3, NULL,
   datetime('now', '-3 days')),
  (3,
   'OAuth2 / SSO integration',
   'Support login via Google and GitHub using OAuth2. Required by several enterprise prospects.',
   'Open', 3, 'Normal', 2, 2, NULL, 1, 3, NULL,
   datetime('now', '-2 days'));

-- Todo (committed to v1.3.0)
INSERT INTO issues (id, title, description, status, position, priority, label_id, creator_id, assignee_id, project_id, release_id, deadline, created_at) VALUES
  (4,
   'Fix drag-and-drop on mobile browsers',
   'Cards cannot be reordered on touch devices due to missing pointer-event handling in the drag library.',
   'Todo', 1, 'High', 1, 3, 3, 1, 2, datetime('now', '-2 days'),
   datetime('now', '-12 days')),
  (5,
   'Add issue search and filter bar',
   'Users need to quickly find issues by keyword, label, or assignee. A persistent filter bar above the board is preferred.',
   'Todo', 2, 'Normal', 2, 2, 4, 1, 2, datetime('now', '+4 days'),
   datetime('now', '-10 days')),
  (6,
   'Export board to CSV',
   'Allow project managers to download the full issue list as a CSV for reporting and imports into other tools.',
   'Todo', 3, 'Normal', 3, 4, NULL, 1, 2, datetime('now', '+14 days'),
   datetime('now', '-8 days')),
  (7,
   'Update API documentation',
   'The OpenAPI spec is outdated since the release-management endpoints were added. Needs a full review pass.',
   'Todo', 4, 'Normal', 4, 5, 5, 1, 2, datetime('now', '+18 days'),
   datetime('now', '-6 days'));

-- Stage1 — In Review
INSERT INTO issues (id, title, description, status, position, priority, label_id, creator_id, assignee_id, project_id, release_id, deadline, planned_dates, created_at) VALUES
  (8,
   'Configurable board column names',
   'Let teams rename Stage1–Stage4 columns to match their own workflow, e.g. "In Review", "QA", "Staging". Stored per project.',
   'Stage1', 1, 'High', 3, 2, 3, 1, 2, datetime('now', '-1 days'),
   NULL,
   datetime('now', '-18 days')),
  (9,
   'Release management view',
   'A dedicated releases page where issues can be grouped by milestone, with start and release dates, and a status overview.',
   'Stage1', 2, 'Normal', 2, 2, 4, 1, 2, datetime('now', '+6 days'),
   json_array(date('now', '+3 days'), date('now', '+5 days')),
   datetime('now', '-15 days')),
  (10,
   'Fix label colour contrast on dark backgrounds',
   'Label badges become unreadable when project cards are shown on a dark panel. Needs a luminance-aware text colour.',
   'Stage1', 3, 'Normal', 1, 3, 2, 1, 2, datetime('now', '+12 days'),
   NULL,
   datetime('now', '-9 days'));

-- Stage2 — In Testing
INSERT INTO issues (id, title, description, status, position, priority, label_id, creator_id, assignee_id, project_id, release_id, deadline, planned_dates, created_at) VALUES
  (11,
   'Issue archiving and restore',
   'Users can archive resolved issues to hide them from the board. Archived issues remain searchable and can be restored.',
   'Stage2', 1, 'Normal', 2, 4, 5, 1, 2, datetime('now', '+3 days'),
   json_array(date('now', '+1 days'), date('now', '+2 days')),
   datetime('now', '-20 days')),
  (12,
   'Improve form validation error messages',
   'Current messages are too generic ("Invalid input"). Needs field-level hints so users know exactly what to correct.',
   'Done', 5, 'Normal', 3, 5, 4, 1, 2, NULL,
   NULL,
   datetime('now', '-14 days'));

-- Stage3 — Staging
INSERT INTO issues (id, title, description, status, position, priority, label_id, creator_id, assignee_id, project_id, release_id, deadline, created_at) VALUES
  (13,
   'Multi-project support',
   'Allow teams to create multiple independent projects, each with its own board, labels, and releases. Includes a project switcher in the nav bar.',
   'Stage3', 1, 'Normal', 2, 2, 3, 1, 2, datetime('now', '+2 days'),
   datetime('now', '-28 days'));

-- Done
INSERT INTO issues (id, title, description, status, position, priority, label_id, creator_id, assignee_id, updated_by, project_id, release_id, created_at) VALUES
  (14,
   'Fix session expiry on inactive tab',
   'When a browser tab is left idle, the refresh-token loop fails silently and the user is unexpectedly logged out. Fixed with a visibility-change listener.',
   'Done', 1, 'High', 1, 3, 2, 2, 1, 1,
   datetime('now', '-35 days')),
  (15,
   'Keyboard shortcuts for board navigation',
   'Added j/k to move between cards, n to open the new-issue dialog, and ? to show the shortcuts overlay.',
   'Done', 2, 'Normal', 3, 4, 3, 3, 1, 1,
   datetime('now', '-30 days')),
  (16,
   'Subtask and checklist support',
   'Issues can contain an ordered list of subtasks, each with its own optional deadline and a done checkbox. Subtasks can be drag-reordered.',
   'Done', 3, 'High', 2, 2, 4, 4, 1, 1,
   datetime('now', '-42 days')),
  (17,
   'Password change flow',
   'Added a self-service password change form on the profile page. Old password is verified before the new one is accepted.',
   'Done', 4, 'Normal', 3, 5, 5, 5, 1, 2,
   datetime('now', '-22 days'));

-- Archive (linked to v1.2.0 — either rejected or deferred during that cycle)
INSERT INTO issues (id, title, description, status, position, priority, label_id, creator_id, project_id, release_id, created_at) VALUES
  (18,
   'Migrate backend from REST to GraphQL',
   'Proposal rejected: the REST API is sufficient for current needs and GraphQL would add schema complexity without a clear benefit.',
   'Archive', 1, 'Normal', 2, 2, 1, 1,
   datetime('now', '-60 days')),
  (19,
   'Real-time push notifications via WebSocket',
   'Deferred to v1.4.0. Requires infrastructure changes (connection state, reconnect logic) that are out of scope for the current sprint.',
   'Archive', 2, 'Normal', 3, 3, 1, 1,
   datetime('now', '-55 days'));

-- ── Issues — Project 2: Company Website ──────────────────────────────────────

-- Open
INSERT INTO issues (id, title, description, status, position, priority, label_id, creator_id, project_id, release_id, created_at) VALUES
  (20,
   'New product video section',
   'Add an auto-playing (muted) looping video to the product landing page to demonstrate the tool in action.',
   'Open', 1, 'Normal', 6, 3, 2, 5,
   datetime('now', '-4 days')),
  (21,
   'Blog RSS feed',
   'Publish an RSS 2.0 feed for the blog so visitors can subscribe with feed readers.',
   'Open', 2, 'Normal', 8, 4, 2, NULL,
   datetime('now', '-2 days'));

-- Todo
INSERT INTO issues (id, title, description, status, position, priority, label_id, creator_id, assignee_id, project_id, release_id, deadline, created_at) VALUES
  (22,
   'Redesign pricing page',
   'The current pricing page has a 68 % bounce rate. New design should highlight value props and simplify tier comparison.',
   'Todo', 1, 'High', 6, 3, 3, 2, 5, datetime('now', '-3 days'),
   datetime('now', '-11 days')),
  (23,
   'Write case studies for three clients',
   'Draft and publish case studies for Acme Corp, BrightPath, and NovaTech. Each study should include measurable outcomes.',
   'Todo', 2, 'Normal', 7, 4, 5, 2, 5, datetime('now', '+20 days'),
   datetime('now', '-9 days')),
  (24,
   'Fix broken links audit',
   'Run a full crawl of internal and external links and fix all 404 responses found. Target: zero broken links before launch.',
   'Todo', 3, 'Normal', 8, 5, NULL, 2, 5, datetime('now', '+5 days'),
   datetime('now', '-7 days'));

-- Stage1 — Draft
INSERT INTO issues (id, title, description, status, position, priority, label_id, creator_id, assignee_id, project_id, release_id, deadline, planned_dates, created_at) VALUES
  (25,
   'Homepage hero section copy update',
   'Current headline is too technical. Rewrite to focus on user outcome rather than a feature list. Target reading grade 8.',
   'Stage1', 1, 'Normal', 7, 4, 4, 2, 5, datetime('now', '+9 days'),
   NULL,
   datetime('now', '-16 days')),
  (26,
   'Add cookie consent banner',
   'Required for GDPR compliance. Analytics and tracking scripts must be blocked until the user explicitly consents.',
   'Stage1', 2, 'High', 8, 5, 3, 2, 5, datetime('now', '+8 days'),
   json_array(date('now', '+4 days'), date('now', '+7 days')),
   datetime('now', '-13 days'));

-- Stage2 — Review
INSERT INTO issues (id, title, description, status, position, priority, label_id, creator_id, assignee_id, project_id, release_id, deadline, created_at) VALUES
  (27,
   'SEO metadata for all pages',
   'Add og:title, og:description, canonical URLs, and JSON-LD structured data markup to every public-facing page.',
   'Stage2', 1, 'Normal', 9, 3, 4, 2, 5, datetime('now', '-5 days'),
   datetime('now', '-19 days')),
  (28,
   'Contact form redesign',
   'Simplify the contact form from 8 fields to 3 and add a clear CTA. Current form has only a 12 % completion rate.',
   'Stage2', 2, 'Normal', 6, 4, 5, 2, 5, datetime('now', '+7 days'),
   datetime('now', '-17 days'));

-- Done
INSERT INTO issues (id, title, description, status, position, priority, label_id, creator_id, assignee_id, updated_by, project_id, release_id, created_at) VALUES
  (29,
   'Migrate to new hosting',
   'Moved from shared hosting to a containerised setup on Hetzner Cloud. Median page load time reduced by 40 %.',
   'Done', 1, 'High', 8, 3, 3, 3, 2, 4,
   datetime('now', '-50 days')),
  (30,
   'Logo and brand refresh',
   'Updated logo, colour palette, and typography across all pages to align with the new brand guidelines.',
   'Done', 2, 'Normal', 6, 4, 4, 4, 2, 4,
   datetime('now', '-48 days')),
  (31,
   'GDPR privacy policy update',
   'Legal reviewed and updated the privacy policy. Added data-retention schedules, DPA contact details, and cookie inventory.',
   'Done', 3, 'Normal', 7, 5, NULL, 5, 2, 4,
   datetime('now', '-45 days'));

INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES ('issues', 31);

-- ── Tasks (subtasks) ──────────────────────────────────────────────────────────

-- Issue 8: Configurable board column names
INSERT INTO tasks (issue_id, title, done, position) VALUES
  (8, 'Add project_status_config table and migration',        1, 1),
  (8, 'API endpoint GET /PUT /api/projects/:id/statusconfig', 1, 2),
  (8, 'Settings panel in project configuration UI',           0, 3),
  (8, 'Update board column headers to use configured names',  0, 4);

-- Issue 9: Release management view
INSERT INTO tasks (issue_id, title, done, position) VALUES
  (9, 'Design wireframe for releases page',            1, 1),
  (9, 'Backend: releases CRUD API',                    1, 2),
  (9, 'Frontend: release list and detail component',   0, 3),
  (9, 'Link issues to a release via the edit form',    0, 4);

-- Issue 13: Multi-project support
INSERT INTO tasks (issue_id, title, done, position) VALUES
  (13, 'Add project_id to issues and labels tables',       1, 1),
  (13, 'Project creation and management API',              1, 2),
  (13, 'Project switcher in the navigation bar',           1, 3),
  (13, 'Scope labels and releases per project',            1, 4),
  (13, 'Data migration for single-project installations',  1, 5);

-- Issue 16: Subtask and checklist support
INSERT INTO tasks (issue_id, title, done, position) VALUES
  (16, 'Add tasks table to database schema',               1, 1),
  (16, 'Tasks CRUD API under /api/issues/:id/tasks',       1, 2),
  (16, 'Render checklist in the issue detail modal',       1, 3),
  (16, 'Drag-to-reorder tasks within an issue',            1, 4);

-- Issue 22: Redesign pricing page
INSERT INTO tasks (issue_id, title, done, position) VALUES
  (22, 'Competitive analysis of 5 competitor pricing pages', 1, 1),
  (22, 'Three wireframe variants for review',                0, 2),
  (22, 'Copywriting for each pricing tier',                  0, 3),
  (22, 'Implementation and cross-browser testing',           0, 4);

-- Issue 26: Cookie consent banner
INSERT INTO tasks (issue_id, title, done, position) VALUES
  (26, 'Document GDPR consent requirements',                 1, 1),
  (26, 'Implement consent state in localStorage',            0, 2),
  (26, 'Block analytics scripts until consent is given',     0, 3),
  (26, 'QA: test opt-in and opt-out flows across browsers',  0, 4);

INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES ('tasks', 24);

COMMIT;
PRAGMA foreign_keys = ON;
SQL

echo ""
echo "Demo data loaded successfully into '$DB'."
echo ""
echo "Demo user accounts (password: the one you entered):"
printf "  %-35s %s\n" "sarah.chen@wuflow.demo"    "(sysadmin)"
printf "  %-35s %s\n" "marcus.weber@wuflow.demo"  "(admin)"
printf "  %-35s %s\n" "lena.hoffmann@wuflow.demo" "(user)"
printf "  %-35s %s\n" "tom.fischer@wuflow.demo"   "(user)"
echo ""
echo "Projects:"
echo "  1 — Development   (board: In Review / In Testing / Staging)"
echo "  2 — Website      (board: Draft / Review)"
