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
#   - 1 sysadmin account (admin@local) + 4 demo team members (2 admins, 2 users)
#   - 2 projects with custom board column names
#   - Labels and releases per project
#   - 31 realistic issues spread across all board statuses
#   - Subtasks for several of those issues
#   - A history trail (status/assignee transitions, task events) and comments
#     for every issue, mirroring what the app itself records
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
  if [[ -t 0 ]]; then
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

if [[ -z "$DB" ]]; then
  DB=$(ask "Database path [wuflow.db]: " "wuflow.db")
fi

if [[ -f "$DB" ]]; then
  echo "Error: '$DB' already exists. Remove it first or choose a different path." >&2
  exit 1
fi

if [[ -z "$PASSWORD" ]]; then
  PASSWORD=$(ask_password "Password for demo users: ")
fi

if [[ -z "$PASSWORD" ]]; then
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
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login    DATETIME
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
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,
    session_token TEXT NOT NULL DEFAULT '',
    token_hash    TEXT NOT NULL,
    expires_at    DATETIME NOT NULL,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_token ON sessions(session_token);
CREATE TABLE issue_history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id   INTEGER NOT NULL,
    user_id    INTEGER,
    event      TEXT NOT NULL,
    data       TEXT NOT NULL DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE SET NULL
);
CREATE INDEX idx_issue_history_issue ON issue_history(issue_id, created_at, id);
CREATE TABLE issue_comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id   INTEGER NOT NULL,
    user_id    INTEGER,
    body       TEXT NOT NULL,
    edited     BOOLEAN NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE SET NULL
);
CREATE INDEX idx_issue_comments_issue ON issue_comments(issue_id, created_at, id);

-- ── Default project (id = 1, required by the app) ─────────────────────────────
INSERT INTO projects (id, name, description) VALUES
  (1, 'Development', 'Core product development and bug tracking');

-- ── Users ─────────────────────────────────────────────────────────────────────
-- id=1 mirrors the app's own bootstrap admin (see EnsureInitialAdmin): the
-- sole sysadmin account, created first, just like a fresh real deployment.
INSERT INTO users (id, email, first_name, last_name, password_hash, role, active, last_login) VALUES
  (1, 'admin@local',               'Admin',  'User',     '$HASH', 'sysadmin', 1, datetime('now', '-6 hours')),
  (2, 'sarah.chen@wuflow.demo',    'Sarah',  'Chen',     '$HASH', 'admin',    1, datetime('now', '-2 hours')),
  (3, 'marcus.weber@wuflow.demo',  'Marcus', 'Weber',    '$HASH', 'admin',    1, datetime('now', '-1 days')),
  (4, 'lena.hoffmann@wuflow.demo', 'Lena',   'Hoffmann', '$HASH', 'user',     1, datetime('now', '-3 hours')),
  (5, 'tom.fischer@wuflow.demo',   'Tom',    'Fischer',  '$HASH', 'user',     1, datetime('now', '-5 days'));
INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES ('users', 5);

-- ── Projects ──────────────────────────────────────────────────────────────────
-- Project 1 already updated above (id = 1)
INSERT INTO projects (id, name, description) VALUES
  (2, 'Website', 'Corporate website redesign and ongoing maintenance');
INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES ('projects', 2);

-- ── Board status config ───────────────────────────────────────────────────────
-- Project 1 row may already exist from the app's startup migration, so use REPLACE.
INSERT OR REPLACE INTO project_status_config (project_id, stage1_name, stage2_name, stage3_name, stage4_name) VALUES
  (1, 'Working', 'Testing', 'Staging', ''),
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
INSERT INTO issues (id, title, description, status, position, priority, label_id, creator_id, assignee_id, project_id, release_id, deadline, planned_dates, created_at, updated_at) VALUES
  (11,
   'Issue archiving and restore',
   'Users can archive resolved issues to hide them from the board. Archived issues remain searchable and can be restored.',
   'Stage2', 1, 'Normal', 2, 4, 5, 1, 2, datetime('now', '+3 days'),
   json_array(date('now', '+1 days'), date('now', '+2 days')),
   datetime('now', '-20 days'), datetime('now', '-6 days')),
  (12,
   'Improve form validation error messages',
   'Current messages are too generic ("Invalid input"). Needs field-level hints so users know exactly what to correct.',
   'Done', 5, 'Normal', 3, 5, 4, 1, 2, NULL,
   NULL,
   datetime('now', '-14 days'), datetime('now', '-2 days'));

-- Stage3 — Staging
INSERT INTO issues (id, title, description, status, position, priority, label_id, creator_id, assignee_id, project_id, release_id, deadline, created_at) VALUES
  (13,
   'Multi-project support',
   '## Scope

Allow teams to create multiple **independent projects**, each with its own board, labels, and releases. Includes a project switcher in the nav bar.

### Requirements

1. Every issue, label, and release is scoped to exactly one project (`project_id` foreign key)
2. Switching projects must not lose the current board filter state
3. Existing single-project installations get a *transparent* migration to project id `1`

### Out of scope

- Per-project user permissions -- tracked separately, see the <u>project access</u> follow-up
- Cross-project search -- originally planned for this release, ~~now~~ pushed out

### Migration snippet

```
ALTER TABLE issues ADD COLUMN project_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE labels ADD COLUMN project_id INTEGER NOT NULL DEFAULT 1;
```

### Data scoping reference

| Resource | Scoped by | Cascade on project delete |
| --- | --- | --- |
| Issues | `project_id` | Yes |
| Labels | `project_id` | Yes |
| Releases | `project_id` | Yes |

---

See [Bounded Context](https://martinfowler.com/bliki/BoundedContext.html) for the general pattern this design follows.

#### Note
Ping the team once the switcher lands in staging.
QA should cover switching mid-edit on an open issue.',
   'Stage3', 1, 'Normal', 2, 2, 3, 1, 2, datetime('now', '+2 days'),
   datetime('now', '-28 days'));

-- Done
INSERT INTO issues (id, title, description, status, position, priority, label_id, creator_id, assignee_id, updated_by, project_id, release_id, created_at, updated_at) VALUES
  (14,
   'Fix session expiry on inactive tab',
   'When a browser tab is left idle, the refresh-token loop fails silently and the user is unexpectedly logged out. Fixed with a visibility-change listener.',
   'Done', 1, 'High', 1, 3, 2, 2, 1, 1,
   datetime('now', '-35 days'), datetime('now', '-21 days')),
  (15,
   'Keyboard shortcuts for board navigation',
   'Added j/k to move between cards, n to open the new-issue dialog, and ? to show the shortcuts overlay.',
   'Done', 2, 'Normal', 3, 4, 3, 3, 1, 1,
   datetime('now', '-30 days'), datetime('now', '-16 days')),
  (16,
   'Subtask and checklist support',
   'Issues can contain an ordered list of subtasks, each with its own optional deadline and a done checkbox. Subtasks can be drag-reordered.',
   'Done', 3, 'High', 2, 2, 4, 4, 1, 1,
   datetime('now', '-42 days'), datetime('now', '-20 days')),
  (17,
   'Password change flow',
   'Added a self-service password change form on the profile page. Old password is verified before the new one is accepted.',
   'Done', 4, 'Normal', 3, 5, 5, 5, 1, 2,
   datetime('now', '-22 days'), datetime('now', '-8 days'));

-- Archive (linked to v1.2.0 — either rejected or deferred during that cycle)
INSERT INTO issues (id, title, description, status, position, priority, label_id, creator_id, project_id, release_id, created_at, updated_at) VALUES
  (18,
   'Migrate backend from REST to GraphQL',
   'Proposal rejected: the REST API is sufficient for current needs and GraphQL would add schema complexity without a clear benefit.',
   'Archive', 1, 'Normal', 2, 2, 1, 1,
   datetime('now', '-60 days'), datetime('now', '-58 days')),
  (19,
   'Real-time push notifications via WebSocket',
   'Deferred to v1.4.0. Requires infrastructure changes (connection state, reconnect logic) that are out of scope for the current sprint.',
   'Archive', 2, 'Normal', 3, 3, 1, 1,
   datetime('now', '-55 days'), datetime('now', '-52 days'));

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
INSERT INTO issues (id, title, description, status, position, priority, label_id, creator_id, assignee_id, updated_by, project_id, release_id, created_at, updated_at) VALUES
  (29,
   'Migrate to new hosting',
   'Moved from shared hosting to a containerised setup on Hetzner Cloud. Median page load time reduced by 40 %.',
   'Done', 1, 'High', 8, 3, 3, 3, 2, 4,
   datetime('now', '-50 days'), datetime('now', '-35 days')),
  (30,
   'Logo and brand refresh',
   'Updated logo, colour palette, and typography across all pages to align with the new brand guidelines.',
   'Done', 2, 'Normal', 6, 4, 4, 4, 2, 4,
   datetime('now', '-48 days'), datetime('now', '-33 days')),
  (31,
   'GDPR privacy policy update',
   'Legal reviewed and updated the privacy policy. Added data-retention schedules, DPA contact details, and cookie inventory.',
   'Done', 3, 'Normal', 7, 5, NULL, 5, 2, 4,
   datetime('now', '-45 days'), datetime('now', '-32 days'));

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

-- ── Issue history ─────────────────────────────────────────────────────────────
-- Mirrors what the app itself records: one 'created' entry per issue, then one
-- 'updated' entry per changed field (status/assignee/priority), 'task' entries
-- for completed subtasks, and 'archived' for the two archived issues. Users can
-- only move their own team's cards, so status/task actors are the assignee;
-- assignee changes are logged by whoever made them; archiving is admin-only.

-- Issue 1: Dark mode support
INSERT INTO issue_history (issue_id, user_id, event, data, created_at) VALUES
  (1, 2, 'created', json_object(), datetime('now', '-5 days'));

-- Issue 2: Bulk issue operations
INSERT INTO issue_history (issue_id, user_id, event, data, created_at) VALUES
  (2, 3, 'created', json_object(), datetime('now', '-3 days'));

-- Issue 3: OAuth2 / SSO integration
INSERT INTO issue_history (issue_id, user_id, event, data, created_at) VALUES
  (3, 2, 'created', json_object(), datetime('now', '-2 days'));

-- Issue 4: Fix drag-and-drop on mobile browsers
INSERT INTO issue_history (issue_id, user_id, event, data, created_at) VALUES
  (4, 3, 'created', json_object(), datetime('now', '-12 days')),
  (4, 3, 'updated', json_object('field', 'priority', 'from', 'Normal', 'to', 'High'), datetime('now', '-10 days'));

-- Issue 5: Add issue search and filter bar
INSERT INTO issue_history (issue_id, user_id, event, data, created_at) VALUES
  (5, 2, 'created', json_object(), datetime('now', '-10 days')),
  (5, 2, 'updated', json_object('field', 'assignee', 'to', 'Lena Hoffmann'), datetime('now', '-9 days'));

-- Issue 6: Export board to CSV
INSERT INTO issue_history (issue_id, user_id, event, data, created_at) VALUES
  (6, 4, 'created', json_object(), datetime('now', '-8 days'));

-- Issue 7: Update API documentation
INSERT INTO issue_history (issue_id, user_id, event, data, created_at) VALUES
  (7, 5, 'created', json_object(), datetime('now', '-6 days'));

-- Issue 8: Configurable board column names
INSERT INTO issue_history (issue_id, user_id, event, data, created_at) VALUES
  (8, 2, 'created', json_object(), datetime('now', '-18 days')),
  (8, 2, 'updated', json_object('field', 'assignee', 'to', 'Marcus Weber'), datetime('now', '-17 days')),
  (8, 3, 'updated', json_object('field', 'status', 'from', 'Open', 'to', 'Todo'), datetime('now', '-16 days')),
  (8, 3, 'updated', json_object('field', 'status', 'from', 'Todo', 'to', 'Stage1'), datetime('now', '-10 days')),
  (8, 3, 'task', json_object('field', 'task_completed', 'detail', 'Task: Completed ''Add project_status_config table and migration'''), datetime('now', '-9 days')),
  (8, 3, 'task', json_object('field', 'task_completed', 'detail', 'Task: Completed ''API endpoint GET /PUT /api/projects/:id/statusconfig'''), datetime('now', '-5 days'));

-- Issue 9: Release management view
INSERT INTO issue_history (issue_id, user_id, event, data, created_at) VALUES
  (9, 2, 'created', json_object(), datetime('now', '-15 days')),
  (9, 2, 'updated', json_object('field', 'assignee', 'to', 'Lena Hoffmann'), datetime('now', '-14 days')),
  (9, 4, 'updated', json_object('field', 'status', 'from', 'Open', 'to', 'Todo'), datetime('now', '-13 days')),
  (9, 4, 'updated', json_object('field', 'status', 'from', 'Todo', 'to', 'Stage1'), datetime('now', '-7 days')),
  (9, 4, 'task', json_object('field', 'task_completed', 'detail', 'Task: Completed ''Design wireframe for releases page'''), datetime('now', '-12 days')),
  (9, 4, 'task', json_object('field', 'task_completed', 'detail', 'Task: Completed ''Backend: releases CRUD API'''), datetime('now', '-6 days'));

-- Issue 10: Fix label colour contrast on dark backgrounds
INSERT INTO issue_history (issue_id, user_id, event, data, created_at) VALUES
  (10, 3, 'created', json_object(), datetime('now', '-9 days')),
  (10, 3, 'updated', json_object('field', 'assignee', 'to', 'Sarah Chen'), datetime('now', '-8 days')),
  (10, 2, 'updated', json_object('field', 'status', 'from', 'Open', 'to', 'Todo'), datetime('now', '-7 days')),
  (10, 2, 'updated', json_object('field', 'status', 'from', 'Todo', 'to', 'Stage1'), datetime('now', '-4 days'));

-- Issue 11: Issue archiving and restore
INSERT INTO issue_history (issue_id, user_id, event, data, created_at) VALUES
  (11, 4, 'created', json_object(), datetime('now', '-20 days')),
  (11, 4, 'updated', json_object('field', 'assignee', 'to', 'Tom Fischer'), datetime('now', '-19 days')),
  (11, 5, 'updated', json_object('field', 'status', 'from', 'Open', 'to', 'Todo'), datetime('now', '-18 days')),
  (11, 5, 'updated', json_object('field', 'status', 'from', 'Todo', 'to', 'Stage1'), datetime('now', '-13 days')),
  (11, 5, 'updated', json_object('field', 'status', 'from', 'Stage1', 'to', 'Stage2'), datetime('now', '-6 days'));

-- Issue 12: Improve form validation error messages
INSERT INTO issue_history (issue_id, user_id, event, data, created_at) VALUES
  (12, 5, 'created', json_object(), datetime('now', '-14 days')),
  (12, 5, 'updated', json_object('field', 'assignee', 'to', 'Lena Hoffmann'), datetime('now', '-13 days')),
  (12, 4, 'updated', json_object('field', 'status', 'from', 'Open', 'to', 'Todo'), datetime('now', '-12 days')),
  (12, 4, 'updated', json_object('field', 'status', 'from', 'Todo', 'to', 'Stage1'), datetime('now', '-9 days')),
  (12, 4, 'updated', json_object('field', 'status', 'from', 'Stage1', 'to', 'Stage2'), datetime('now', '-5 days')),
  (12, 4, 'updated', json_object('field', 'status', 'from', 'Stage2', 'to', 'Done'), datetime('now', '-2 days'));

-- Issue 13: Multi-project support
INSERT INTO issue_history (issue_id, user_id, event, data, created_at) VALUES
  (13, 2, 'created', json_object(), datetime('now', '-28 days')),
  (13, 2, 'updated', json_object('field', 'assignee', 'to', 'Marcus Weber'), datetime('now', '-27 days')),
  (13, 3, 'updated', json_object('field', 'status', 'from', 'Open', 'to', 'Todo'), datetime('now', '-25 days')),
  (13, 3, 'updated', json_object('field', 'status', 'from', 'Todo', 'to', 'Stage1'), datetime('now', '-20 days')),
  (13, 3, 'updated', json_object('field', 'status', 'from', 'Stage1', 'to', 'Stage2'), datetime('now', '-14 days')),
  (13, 3, 'updated', json_object('field', 'status', 'from', 'Stage2', 'to', 'Stage3'), datetime('now', '-4 days')),
  (13, 3, 'task', json_object('field', 'task_completed', 'detail', 'Task: Completed ''Add project_id to issues and labels tables'''), datetime('now', '-26 days')),
  (13, 3, 'task', json_object('field', 'task_completed', 'detail', 'Task: Completed ''Project creation and management API'''), datetime('now', '-24 days')),
  (13, 3, 'task', json_object('field', 'task_completed', 'detail', 'Task: Completed ''Project switcher in the navigation bar'''), datetime('now', '-20 days')),
  (13, 3, 'task', json_object('field', 'task_completed', 'detail', 'Task: Completed ''Scope labels and releases per project'''), datetime('now', '-15 days')),
  (13, 3, 'task', json_object('field', 'task_completed', 'detail', 'Task: Completed ''Data migration for single-project installations'''), datetime('now', '-5 days'));

-- Issue 14: Fix session expiry on inactive tab
INSERT INTO issue_history (issue_id, user_id, event, data, created_at) VALUES
  (14, 3, 'created', json_object(), datetime('now', '-35 days')),
  (14, 3, 'updated', json_object('field', 'assignee', 'to', 'Sarah Chen'), datetime('now', '-34 days')),
  (14, 2, 'updated', json_object('field', 'status', 'from', 'Open', 'to', 'Todo'), datetime('now', '-33 days')),
  (14, 2, 'updated', json_object('field', 'status', 'from', 'Todo', 'to', 'Stage1'), datetime('now', '-30 days')),
  (14, 2, 'updated', json_object('field', 'status', 'from', 'Stage1', 'to', 'Stage2'), datetime('now', '-26 days')),
  (14, 2, 'updated', json_object('field', 'status', 'from', 'Stage2', 'to', 'Stage3'), datetime('now', '-24 days')),
  (14, 2, 'updated', json_object('field', 'status', 'from', 'Stage3', 'to', 'Done'), datetime('now', '-21 days'));

-- Issue 15: Keyboard shortcuts for board navigation
INSERT INTO issue_history (issue_id, user_id, event, data, created_at) VALUES
  (15, 4, 'created', json_object(), datetime('now', '-30 days')),
  (15, 4, 'updated', json_object('field', 'assignee', 'to', 'Marcus Weber'), datetime('now', '-29 days')),
  (15, 3, 'updated', json_object('field', 'status', 'from', 'Open', 'to', 'Todo'), datetime('now', '-27 days')),
  (15, 3, 'updated', json_object('field', 'status', 'from', 'Todo', 'to', 'Stage1'), datetime('now', '-24 days')),
  (15, 3, 'updated', json_object('field', 'status', 'from', 'Stage1', 'to', 'Stage2'), datetime('now', '-20 days')),
  (15, 3, 'updated', json_object('field', 'status', 'from', 'Stage2', 'to', 'Stage3'), datetime('now', '-18 days')),
  (15, 3, 'updated', json_object('field', 'status', 'from', 'Stage3', 'to', 'Done'), datetime('now', '-16 days'));

-- Issue 16: Subtask and checklist support
INSERT INTO issue_history (issue_id, user_id, event, data, created_at) VALUES
  (16, 2, 'created', json_object(), datetime('now', '-42 days')),
  (16, 2, 'updated', json_object('field', 'assignee', 'to', 'Lena Hoffmann'), datetime('now', '-41 days')),
  (16, 4, 'updated', json_object('field', 'status', 'from', 'Open', 'to', 'Todo'), datetime('now', '-38 days')),
  (16, 4, 'updated', json_object('field', 'status', 'from', 'Todo', 'to', 'Stage1'), datetime('now', '-33 days')),
  (16, 4, 'updated', json_object('field', 'status', 'from', 'Stage1', 'to', 'Stage2'), datetime('now', '-28 days')),
  (16, 4, 'updated', json_object('field', 'status', 'from', 'Stage2', 'to', 'Stage3'), datetime('now', '-24 days')),
  (16, 4, 'updated', json_object('field', 'status', 'from', 'Stage3', 'to', 'Done'), datetime('now', '-20 days')),
  (16, 4, 'task', json_object('field', 'task_completed', 'detail', 'Task: Completed ''Add tasks table to database schema'''), datetime('now', '-40 days')),
  (16, 4, 'task', json_object('field', 'task_completed', 'detail', 'Task: Completed ''Tasks CRUD API under /api/issues/:id/tasks'''), datetime('now', '-35 days')),
  (16, 4, 'task', json_object('field', 'task_completed', 'detail', 'Task: Completed ''Render checklist in the issue detail modal'''), datetime('now', '-29 days')),
  (16, 4, 'task', json_object('field', 'task_completed', 'detail', 'Task: Completed ''Drag-to-reorder tasks within an issue'''), datetime('now', '-22 days'));

-- Issue 17: Password change flow
INSERT INTO issue_history (issue_id, user_id, event, data, created_at) VALUES
  (17, 5, 'created', json_object(), datetime('now', '-22 days')),
  (17, 5, 'updated', json_object('field', 'status', 'from', 'Open', 'to', 'Todo'), datetime('now', '-20 days')),
  (17, 5, 'updated', json_object('field', 'status', 'from', 'Todo', 'to', 'Stage1'), datetime('now', '-17 days')),
  (17, 5, 'updated', json_object('field', 'status', 'from', 'Stage1', 'to', 'Stage2'), datetime('now', '-14 days')),
  (17, 5, 'updated', json_object('field', 'status', 'from', 'Stage2', 'to', 'Stage3'), datetime('now', '-11 days')),
  (17, 5, 'updated', json_object('field', 'status', 'from', 'Stage3', 'to', 'Done'), datetime('now', '-8 days'));

-- Issue 18: Migrate backend from REST to GraphQL (rejected)
INSERT INTO issue_history (issue_id, user_id, event, data, created_at) VALUES
  (18, 2, 'created', json_object(), datetime('now', '-60 days')),
  (18, 3, 'archived', json_object(), datetime('now', '-58 days'));

-- Issue 19: Real-time push notifications via WebSocket (deferred)
INSERT INTO issue_history (issue_id, user_id, event, data, created_at) VALUES
  (19, 3, 'created', json_object(), datetime('now', '-55 days')),
  (19, 2, 'archived', json_object(), datetime('now', '-52 days'));

-- Issue 20: New product video section
INSERT INTO issue_history (issue_id, user_id, event, data, created_at) VALUES
  (20, 3, 'created', json_object(), datetime('now', '-4 days'));

-- Issue 21: Blog RSS feed
INSERT INTO issue_history (issue_id, user_id, event, data, created_at) VALUES
  (21, 4, 'created', json_object(), datetime('now', '-2 days'));

-- Issue 22: Redesign pricing page
INSERT INTO issue_history (issue_id, user_id, event, data, created_at) VALUES
  (22, 3, 'created', json_object(), datetime('now', '-11 days')),
  (22, 3, 'updated', json_object('field', 'status', 'from', 'Open', 'to', 'Todo'), datetime('now', '-10 days')),
  (22, 3, 'task', json_object('field', 'task_completed', 'detail', 'Task: Completed ''Competitive analysis of 5 competitor pricing pages'''), datetime('now', '-4 days'));

-- Issue 23: Write case studies for three clients
INSERT INTO issue_history (issue_id, user_id, event, data, created_at) VALUES
  (23, 4, 'created', json_object(), datetime('now', '-9 days')),
  (23, 4, 'updated', json_object('field', 'assignee', 'to', 'Tom Fischer'), datetime('now', '-8 days')),
  (23, 5, 'updated', json_object('field', 'status', 'from', 'Open', 'to', 'Todo'), datetime('now', '-8 days'));

-- Issue 24: Fix broken links audit
INSERT INTO issue_history (issue_id, user_id, event, data, created_at) VALUES
  (24, 5, 'created', json_object(), datetime('now', '-7 days')),
  (24, 5, 'updated', json_object('field', 'status', 'from', 'Open', 'to', 'Todo'), datetime('now', '-6 days'));

-- Issue 25: Homepage hero section copy update
INSERT INTO issue_history (issue_id, user_id, event, data, created_at) VALUES
  (25, 4, 'created', json_object(), datetime('now', '-16 days')),
  (25, 4, 'updated', json_object('field', 'status', 'from', 'Open', 'to', 'Todo'), datetime('now', '-15 days')),
  (25, 4, 'updated', json_object('field', 'status', 'from', 'Todo', 'to', 'Stage1'), datetime('now', '-9 days'));

-- Issue 26: Add cookie consent banner
INSERT INTO issue_history (issue_id, user_id, event, data, created_at) VALUES
  (26, 5, 'created', json_object(), datetime('now', '-13 days')),
  (26, 5, 'updated', json_object('field', 'assignee', 'to', 'Marcus Weber'), datetime('now', '-12 days')),
  (26, 3, 'updated', json_object('field', 'status', 'from', 'Open', 'to', 'Todo'), datetime('now', '-11 days')),
  (26, 3, 'updated', json_object('field', 'status', 'from', 'Todo', 'to', 'Stage1'), datetime('now', '-6 days')),
  (26, 3, 'task', json_object('field', 'task_completed', 'detail', 'Task: Completed ''Document GDPR consent requirements'''), datetime('now', '-7 days'));

-- Issue 27: SEO metadata for all pages
INSERT INTO issue_history (issue_id, user_id, event, data, created_at) VALUES
  (27, 3, 'created', json_object(), datetime('now', '-19 days')),
  (27, 3, 'updated', json_object('field', 'assignee', 'to', 'Lena Hoffmann'), datetime('now', '-18 days')),
  (27, 4, 'updated', json_object('field', 'status', 'from', 'Open', 'to', 'Todo'), datetime('now', '-17 days')),
  (27, 4, 'updated', json_object('field', 'status', 'from', 'Todo', 'to', 'Stage1'), datetime('now', '-13 days')),
  (27, 4, 'updated', json_object('field', 'status', 'from', 'Stage1', 'to', 'Stage2'), datetime('now', '-6 days'));

-- Issue 28: Contact form redesign
INSERT INTO issue_history (issue_id, user_id, event, data, created_at) VALUES
  (28, 4, 'created', json_object(), datetime('now', '-17 days')),
  (28, 4, 'updated', json_object('field', 'assignee', 'to', 'Tom Fischer'), datetime('now', '-16 days')),
  (28, 5, 'updated', json_object('field', 'status', 'from', 'Open', 'to', 'Todo'), datetime('now', '-15 days')),
  (28, 5, 'updated', json_object('field', 'status', 'from', 'Todo', 'to', 'Stage1'), datetime('now', '-11 days')),
  (28, 5, 'updated', json_object('field', 'status', 'from', 'Stage1', 'to', 'Stage2'), datetime('now', '-5 days'));

-- Issue 29: Migrate to new hosting
INSERT INTO issue_history (issue_id, user_id, event, data, created_at) VALUES
  (29, 3, 'created', json_object(), datetime('now', '-50 days')),
  (29, 3, 'updated', json_object('field', 'status', 'from', 'Open', 'to', 'Todo'), datetime('now', '-48 days')),
  (29, 3, 'updated', json_object('field', 'status', 'from', 'Todo', 'to', 'Stage1'), datetime('now', '-44 days')),
  (29, 3, 'updated', json_object('field', 'status', 'from', 'Stage1', 'to', 'Stage2'), datetime('now', '-40 days')),
  (29, 3, 'updated', json_object('field', 'status', 'from', 'Stage2', 'to', 'Done'), datetime('now', '-35 days'));

-- Issue 30: Logo and brand refresh
INSERT INTO issue_history (issue_id, user_id, event, data, created_at) VALUES
  (30, 4, 'created', json_object(), datetime('now', '-48 days')),
  (30, 4, 'updated', json_object('field', 'status', 'from', 'Open', 'to', 'Todo'), datetime('now', '-46 days')),
  (30, 4, 'updated', json_object('field', 'status', 'from', 'Todo', 'to', 'Stage1'), datetime('now', '-42 days')),
  (30, 4, 'updated', json_object('field', 'status', 'from', 'Stage1', 'to', 'Stage2'), datetime('now', '-38 days')),
  (30, 4, 'updated', json_object('field', 'status', 'from', 'Stage2', 'to', 'Done'), datetime('now', '-33 days'));

-- Issue 31: GDPR privacy policy update
INSERT INTO issue_history (issue_id, user_id, event, data, created_at) VALUES
  (31, 5, 'created', json_object(), datetime('now', '-45 days')),
  (31, 5, 'updated', json_object('field', 'status', 'from', 'Open', 'to', 'Todo'), datetime('now', '-43 days')),
  (31, 5, 'updated', json_object('field', 'status', 'from', 'Todo', 'to', 'Stage1'), datetime('now', '-40 days')),
  (31, 5, 'updated', json_object('field', 'status', 'from', 'Stage1', 'to', 'Stage2'), datetime('now', '-36 days')),
  (31, 5, 'updated', json_object('field', 'status', 'from', 'Stage2', 'to', 'Done'), datetime('now', '-32 days'));

INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES ('issue_history', 123);

-- ── Issue comments ────────────────────────────────────────────────────────────
-- A representative subset of issues carry a short, contextual conversation.
-- Fresh, untouched backlog items are intentionally left without comments.
INSERT INTO issue_comments (issue_id, user_id, body, edited, created_at, updated_at) VALUES
  (3, 3, 'This is a big one -- let us scope for Google and GitHub OIDC only in v1.4.0, and defer SAML and enterprise SSO to v2.0.', 0,
   datetime('now', '-1 days'), datetime('now', '-1 days')),
  (4, 3, 'Reproduced on iOS Safari and Android Chrome -- root cause is the drag library only listening for mousedown, not pointerdown. Working on a fix.', 0,
   datetime('now', '-6 days'), datetime('now', '-6 days')),
  (4, 5, 'Any update? The deadline has already passed and QA is blocked on mobile testing.', 1,
   datetime('now', '-1 days'), datetime('now', '-1 days', '+2 hours')),
  (5, 4, 'Starting on this -- planning a persistent filter bar with keyword, label, and assignee dropdowns above the board.', 0,
   datetime('now', '-4 days'), datetime('now', '-4 days')),
  (7, 5, 'Going through the OpenAPI spec now -- the release endpoints are the biggest gap.', 0,
   datetime('now', '-2 days'), datetime('now', '-2 days')),
  (8, 3, 'Backend is done, just need the settings panel UI and to wire the board headers to the configured names.', 0,
   datetime('now', '-4 days'), datetime('now', '-4 days')),
  (9, 2, 'Wireframe approved by the team -- moving on to the list and detail component next.', 1,
   datetime('now', '-3 days'), datetime('now', '-3 days', '+3 hours')),
  (10, 2, 'Using relative luminance to pick a black or white text colour automatically now -- much better contrast on dark cards.', 0,
   datetime('now', '-3 days'), datetime('now', '-3 days')),
  (11, 5, 'Archived issues stay searchable -- added an Archived filter toggle to the search bar for that.', 0,
   datetime('now', '-5 days'), datetime('now', '-5 days')),
  (12, 4, 'Added field-level hints for every validation rule -- much clearer than the old generic Invalid input message.', 0,
   datetime('now', '-2 days'), datetime('now', '-2 days')),
  (13, 2, 'Kicking this off -- Marcus is driving the backend and schema changes, I will handle the project switcher UI.', 0,
   datetime('now', '-27 days'), datetime('now', '-27 days')),
  (13, 5, 'Do we need a data migration path for existing single-project installations, or can we assume everyone starts fresh?', 0,
   datetime('now', '-19 days'), datetime('now', '-19 days')),
  (13, 3, 'Yes, added a migration step that backfills project_id = 1 for existing rows so upgrades are not disruptive.', 0,
   datetime('now', '-18 days'), datetime('now', '-18 days')),
  (13, 4, 'Project switcher looks great in the nav bar. Tested switching between two projects and labels and releases stay correctly scoped.', 0,
   datetime('now', '-12 days'), datetime('now', '-12 days')),
  (13, 3, 'In staging now -- final smoke tests before this goes out with v1.3.0.', 0,
   datetime('now', '-3 days'), datetime('now', '-3 days')),
  (14, 2, 'Root cause was the refresh-token loop silently failing when the tab lost visibility -- added a visibilitychange listener to resume it. Shipped in v1.2.0.', 0,
   datetime('now', '-21 days'), datetime('now', '-21 days')),
  (15, 3, 'Added j and k for card navigation, n for new issue, and ? to show the shortcuts overlay. Feels much faster now.', 0,
   datetime('now', '-16 days'), datetime('now', '-16 days')),
  (16, 4, 'Subtasks support drag-to-reorder now and each one can have its own optional deadline.', 0,
   datetime('now', '-20 days'), datetime('now', '-20 days')),
  (17, 5, 'Old password is now verified server-side before the new one is accepted. Self-service, no admin involvement needed.', 0,
   datetime('now', '-8 days'), datetime('now', '-8 days')),
  (18, 3, 'Discussed in planning -- REST is sufficient for our current needs. Closing this; revisit only if a concrete GraphQL use case comes up.', 0,
   datetime('now', '-58 days'), datetime('now', '-58 days')),
  (19, 2, 'Deferring to v1.4.0 -- needs connection-state and reconnect-logic work that is out of scope for this sprint.', 0,
   datetime('now', '-52 days'), datetime('now', '-52 days')),
  (22, 3, 'Competitive analysis done -- three main patterns: tiered cards, feature comparison table, and usage-based slider. Drafting wireframes next.', 0,
   datetime('now', '-3 days'), datetime('now', '-3 days')),
  (23, 5, 'Acme Corp draft is ready for review. BrightPath and NovaTech still need a round of interviews with their teams.', 0,
   datetime('now', '-2 days'), datetime('now', '-2 days')),
  (25, 4, 'New headline tested at grade 7 reading level, focuses on the outcome (ship faster) instead of listing features.', 0,
   datetime('now', '-9 days'), datetime('now', '-9 days')),
  (26, 3, 'Consent requirements documented -- analytics and tracking scripts stay blocked until explicit opt-in. Building the localStorage state next.', 0,
   datetime('now', '-5 days'), datetime('now', '-5 days')),
  (27, 4, 'og:title, og:description, and canonical URLs are live on every page. JSON-LD structured data for products is the last piece.', 0,
   datetime('now', '-5 days'), datetime('now', '-5 days')),
  (28, 5, 'Down to 3 fields (name, email, message) with a single clear CTA button. Completion rate should improve a lot from 12 %.', 0,
   datetime('now', '-4 days'), datetime('now', '-4 days')),
  (29, 3, 'Moved from shared hosting to containers on Hetzner Cloud -- median page load time down 40 %.', 0,
   datetime('now', '-35 days'), datetime('now', '-35 days')),
  (30, 4, 'New logo, colour palette, and typography rolled out across every page to match the updated brand guidelines.', 0,
   datetime('now', '-33 days'), datetime('now', '-33 days')),
  (31, 5, 'Legal reviewed and signed off -- added data-retention schedules, DPA contact details, and a full cookie inventory to the policy.', 0,
   datetime('now', '-32 days'), datetime('now', '-32 days'));

INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES ('issue_comments', 30);

COMMIT;
PRAGMA foreign_keys = ON;
SQL

echo ""
echo "Demo data loaded successfully into '$DB'."
echo ""
USER_FMT="  %-35s %s\n"
echo "Demo user accounts (password: the one you entered):"
printf "$USER_FMT" "admin@local"               "(sysadmin)"
printf "$USER_FMT" "sarah.chen@wuflow.demo"    "(admin)"
printf "$USER_FMT" "marcus.weber@wuflow.demo"  "(admin)"
printf "$USER_FMT" "lena.hoffmann@wuflow.demo" "(user)"
printf "$USER_FMT" "tom.fischer@wuflow.demo"   "(user)"
echo ""
echo "Projects:"
echo "  1 — Development   (board: In Review / In Testing / Staging)"
echo "  2 — Website      (board: Draft / Review)"
