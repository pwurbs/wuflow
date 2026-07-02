package backend

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"time"

	// Import sqlite3 driver for side effects (registration)
	_ "github.com/mattn/go-sqlite3"
)

// DB is the global database connection pool.
var DB *sql.DB

// ErrIssueNotFound is returned when an issue is not found.
var ErrIssueNotFound = errors.New("issue not found")

// ErrTaskNotFound is returned when a task is not found.
var ErrTaskNotFound = errors.New("task not found")

// ErrLabelNotFound is returned when a label is not found.
var ErrLabelNotFound = errors.New("label not found")

// ErrUserNotFound is returned when a user is not found.
var ErrUserNotFound = errors.New("user not found")

// ErrSessionNotFound is returned when a session is not found.
var ErrSessionNotFound = errors.New("session not found")

// ErrDuplicateEmail is returned when a user with the same email already exists.
var ErrDuplicateEmail = errors.New("email already exists")

// ErrProjectNotFound is returned when a project is not found.
var ErrProjectNotFound = errors.New("project not found")

// ErrReleaseNotFound is returned when a release is not found.
var ErrReleaseNotFound = errors.New("release not found")

// ErrDuplicateProjectName is returned when a project with the same name already exists.
var ErrDuplicateProjectName = errors.New("project name already exists")

// ErrDuplicateReleaseName is returned when a release with the same name already exists in the project.
var ErrDuplicateReleaseName = errors.New("release name already exists")

// errUniqueConstraintFailed is the SQLite error text for UNIQUE constraint violations.
const errUniqueConstraintFailed = "UNIQUE constraint failed"
const dbErrPrefix = "Database Error: "

// InitDB initializes the database connection and creates tables if they don't exist.
func InitDB(ctx context.Context, dataSourceName string) error {
	if _, err := os.Stat(dataSourceName); os.IsNotExist(err) {
		LogInfo("Creating new database", "path", dataSourceName)
	}

	dsn := dataSourceName
	if strings.Contains(dsn, "?") {
		dsn += "&_fk=1"
	} else {
		dsn += "?_fk=1"
	}

	var err error
	DB, err = sql.Open("sqlite3", dsn)
	if err != nil {
		LogError("Failed to open database", "error", err)
		return err
	}

	if err = DB.PingContext(ctx); err != nil {
		LogError("Failed to ping database", "error", err)
		return err
	}

	if _, err := DB.ExecContext(ctx, "PRAGMA journal_mode=WAL"); err != nil {
		LogError("Failed to set WAL mode", "error", err)
		return err
	}

	if err := createTables(ctx); err != nil {
		return err
	}

	return nil
}

// createTables creates the necessary tables for the application.
func createTables(ctx context.Context) error {
	// Projects table must be created before issues if we want to reference it
	createProjectsTable := `
	CREATE TABLE IF NOT EXISTS projects (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE,
		description TEXT NOT NULL DEFAULT ''
	);`
	if _, err := DB.ExecContext(ctx, createProjectsTable); err != nil {
		LogError("Failed to create projects table", "error", err)
		return err
	}

	// Seed the default project (id=1)
	if _, err := DB.ExecContext(ctx, `INSERT OR IGNORE INTO projects(id, name, description) VALUES(1, 'default', 'Default project')`); err != nil {
		LogError("Failed to seed default project", "error", err)
		return err
	}

	createReleasesTable := `
	CREATE TABLE IF NOT EXISTS releases (
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
		FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL,
		UNIQUE(project_id, name)
	);`
	if _, err := DB.ExecContext(ctx, createReleasesTable); err != nil {
		LogError("Failed to create releases table", "error", err)
		return err
	}

	createIssuesTable := `
	CREATE TABLE IF NOT EXISTS issues (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		title TEXT NOT NULL,
		description TEXT,
		status TEXT NOT NULL,
		position INTEGER NOT NULL,
		deadline DATETIME,
		planned_dates TEXT, -- JSON array of date strings
		label_id INTEGER,
		priority TEXT DEFAULT 'Normal',
		creator_id INTEGER,
		assignee_id INTEGER,
		updated_by INTEGER,
		project_id INTEGER NOT NULL DEFAULT 1,
		release_id INTEGER,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE SET NULL,
		FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE SET NULL,
		FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL,
		FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
		FOREIGN KEY (project_id) REFERENCES projects(id),
		FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE SET NULL
	);`

	createTasksTable := `
	CREATE TABLE IF NOT EXISTS tasks (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		issue_id INTEGER NOT NULL,
		title TEXT NOT NULL,
		done BOOLEAN NOT NULL DEFAULT 0,
		position INTEGER NOT NULL DEFAULT 0,
		deadline DATETIME,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
	);`

	if _, err := DB.ExecContext(ctx, createIssuesTable); err != nil {
		LogError("Failed to create issues table", "error", err)
		return err
	}

	if _, err := DB.ExecContext(ctx, createTasksTable); err != nil {
		LogError("Failed to create tasks table", "error", err)
		return err
	}

	createLabelsTable := `
	CREATE TABLE IF NOT EXISTS labels (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		color TEXT NOT NULL,
		project_id INTEGER NOT NULL DEFAULT 1,
		FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
	);`
	if _, err := DB.ExecContext(ctx, createLabelsTable); err != nil {
		LogError("Failed to create labels table", "error", err)
		return err
	}

	createStatusConfigTable := `
	CREATE TABLE IF NOT EXISTS project_status_config (
		project_id   INTEGER PRIMARY KEY,
		stage1_name  TEXT NOT NULL DEFAULT 'Pending',
		stage2_name  TEXT NOT NULL DEFAULT 'Working',
		stage3_name  TEXT NOT NULL DEFAULT '',
		stage4_name  TEXT NOT NULL DEFAULT '',
		FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
	);`
	if _, err := DB.ExecContext(ctx, createStatusConfigTable); err != nil {
		LogError("Failed to create project_status_config table", "error", err)
		return err
	}

	createUsersTable := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT NOT NULL UNIQUE,
		first_name TEXT NOT NULL,
		last_name TEXT NOT NULL,
		password_hash TEXT NOT NULL,
		role TEXT NOT NULL DEFAULT 'user',
		active BOOLEAN NOT NULL DEFAULT 1,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		last_login DATETIME
	);`
	if _, err := DB.ExecContext(ctx, createUsersTable); err != nil {
		LogError("Failed to create users table", "error", err)
		return err
	}

	createSessionsTable := `
	CREATE TABLE IF NOT EXISTS sessions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		session_token TEXT NOT NULL DEFAULT '',
		token_hash TEXT NOT NULL,
		expires_at DATETIME NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	);`
	if _, err := DB.ExecContext(ctx, createSessionsTable); err != nil {
		LogError("Failed to create sessions table", "error", err)
		return err
	}
	// Create index on user_id to speed up session revocation by user (e.g., logout all devices)
	if _, err := DB.ExecContext(ctx, "CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);"); err != nil {
		LogError("Failed to create index on sessions(user_id)", "error", err)
		return err
	}

	if err := runMigrations(ctx); err != nil {
		return err
	}
	// Create index on session_token after migrations so the column is guaranteed to exist on existing DBs.
	if _, err := DB.ExecContext(ctx, "CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(session_token);"); err != nil {
		LogError("Failed to create index on sessions(session_token)", "error", err)
		return err
	}
	return nil
}

// runMigrations applies incremental schema and data migrations to existing databases.
// All migrations must be idempotent so they are safe to run on every startup.
func runMigrations(ctx context.Context) error {
	// TODO: Migration code for 1.3.2 , can be removed in a later version.
	if err := migrateSessionsAddTokenColumn(ctx); err != nil {
		return err
	}
	// TODO: Migration code for 1.3.2 , can be removed in a later version.
	if err := migrateUsersAddLastLogin(ctx); err != nil {
		return err
	}
	return nil
}

// migrateSessionsAddTokenColumn adds session_token to existing databases that predate the column.
func migrateSessionsAddTokenColumn(ctx context.Context) error {
	var count int
	if err := DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name='session_token'`).Scan(&count); err != nil {
		LogError("Failed to check for session_token column in sessions", "error", err)
		return err
	}
	if count > 0 {
		return nil
	}
	if _, err := DB.ExecContext(ctx, `ALTER TABLE sessions ADD COLUMN session_token TEXT NOT NULL DEFAULT ''`); err != nil {
		LogError("Failed to add session_token column to sessions", "error", err)
		return err
	}
	if _, err := DB.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(session_token)`); err != nil {
		LogError("Failed to create index on sessions(session_token)", "error", err)
		return err
	}
	LogInfo("Migrated sessions table: added session_token column (existing sessions invalidated)")
	return nil
}

// migrateUsersAddLastLogin adds last_login to existing databases that predate the column.
func migrateUsersAddLastLogin(ctx context.Context) error {
	var count int
	if err := DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM pragma_table_info('users') WHERE name='last_login'`).Scan(&count); err != nil {
		LogError("Failed to check for last_login column in users", "error", err)
		return err
	}
	if count > 0 {
		return nil
	}
	if _, err := DB.ExecContext(ctx, `ALTER TABLE users ADD COLUMN last_login DATETIME`); err != nil {
		LogError("Failed to add last_login column to users", "error", err)
		return err
	}
	LogInfo("Migrated users table: added last_login column")
	return nil
}

// UserExistsAndActive checks if a user exists and is active.
func UserExistsAndActive(ctx context.Context, id int) (bool, error) {
	return existsQuery(ctx, "SELECT COUNT(*) FROM users WHERE id = ? AND active = 1", id)
}

// UserExists checks if a user exists, regardless of active status.
func UserExists(ctx context.Context, id int) (bool, error) {
	return existsQuery(ctx, "SELECT COUNT(*) FROM users WHERE id = ?", id)
}

// LabelExistsInProject checks if a label exists and belongs to the given project.
func LabelExistsInProject(ctx context.Context, labelID, projectID int) (bool, error) {
	return existsQuery(ctx, "SELECT COUNT(*) FROM labels WHERE id = ? AND project_id = ?", labelID, projectID)
}

// GetIssueByIDInProject returns the issue only if it belongs to the given project.
// The (id, project_id) pair is filtered in the SQL WHERE clause, so an issue
// living in a different project is indistinguishable from "no such issue" — the
// helper returns nil so the caller can respond 404 uniformly.
func GetIssueByIDInProject(ctx context.Context, id, projectID int) (*Issue, error) {
	row := DB.QueryRowContext(ctx, queryIssueByIDInProject, id, projectID)
	issue, err := scanIssueRow(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		LogError("Database Error: GetIssueByIDInProject", "id", id, "project_id", projectID, "error", err)
		return nil, err
	}
	tasks, err := GetTasksByIssueID(ctx, issue.ID)
	if err != nil {
		LogError("Database Error: GetIssueByIDInProject GetTasksByIssueID", "id", id, "error", err)
		return nil, err
	}
	issue.Tasks = tasks
	return &issue, nil
}

// ProjectExists checks if a project exists.
func ProjectExists(ctx context.Context, id int) (bool, error) {
	return existsQuery(ctx, "SELECT COUNT(*) FROM projects WHERE id = ?", id)
}

// existsQuery runs a SELECT COUNT(*) query and returns true if count > 0.
func existsQuery(ctx context.Context, query string, args ...any) (bool, error) {
	var count int
	if err := DB.QueryRowContext(ctx, query, args...).Scan(&count); err != nil {
		LogError("Database Error: existence check", "error", err)
		return false, err
	}
	return count > 0, nil
}

// checkRowsAffected inspects res and returns notFoundErr when zero rows were affected.
func checkRowsAffected(res sql.Result, caller string, notFoundErr error) error {
	rows, err := res.RowsAffected()
	if err != nil {
		LogError("Database Error: "+caller+" RowsAffected", "error", err)
		return err
	}
	if rows == 0 {
		return notFoundErr
	}
	return nil
}

// CreateIssue inserts a new issue into the database.
func CreateIssue(ctx context.Context, i *Issue) error {
	if i.Priority == "" {
		i.Priority = PriorityNormal
	}
	// Get max position for the status to append to the end
	var maxPos sql.NullInt64
	err := DB.QueryRowContext(ctx, "SELECT MAX(position) FROM issues WHERE status = ?", i.Status).Scan(&maxPos)
	if err != nil && err != sql.ErrNoRows {
		LogError("Database Error: CreateIssue MaxPos", "error", err)
		return err
	}
	i.Position = int(maxPos.Int64) + 1
	i.UpdatedAt = time.Now().UTC()

	var labelID *int
	if i.Label != nil {
		id := i.Label.ID
		labelID = &id
	}

	var creatorID *int
	if i.CreatorID != 0 {
		creatorID = &i.CreatorID
	}

	var updaterID *int
	if i.UpdaterID != nil && *i.UpdaterID != 0 {
		updaterID = i.UpdaterID
	}

	var plannedDatesJSON any
	if i.PlannedDates != nil {
		b, err := json.Marshal(i.PlannedDates)
		if err != nil {
			LogError("Database Error: CreateIssue Marshal Dates", "error", err)
			return err
		}
		plannedDatesJSON = string(b)
	}

	res, err := DB.ExecContext(ctx,
		"INSERT INTO issues(title, description, status, position, deadline, planned_dates, priority, label_id, creator_id, assignee_id, updated_by, project_id, release_id, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		i.Title, i.Description, i.Status, i.Position, i.Deadline, plannedDatesJSON, i.Priority, labelID, creatorID, i.AssigneeID, updaterID, i.ProjectID, i.ReleaseID, i.UpdatedAt,
	)
	if err != nil {
		LogError("Database Error: CreateIssue", "error", err)
		return err
	}

	id, err := res.LastInsertId()
	if err != nil {
		LogError("Database Error: CreateIssue LastInsertId", "error", err)
		return err
	}
	i.ID = int(id)
	return nil
}

// issueSelectBase is the shared SELECT + JOIN used by all project-scoped issue queries.
const issueSelectBase = `
		SELECT i.id, i.title, i.description, i.status, i.position, i.deadline, i.planned_dates, i.priority, i.created_at, i.updated_at,
		       l.id, l.name, l.color,
		       c.id, c.email, c.first_name, c.last_name,
		       a.id, a.email, a.first_name, a.last_name,
		       u.id, u.email, u.first_name, u.last_name,
		       p.id, p.name, p.description,
		       r.id, r.name, r.status, r.release_date
		FROM issues i
		LEFT JOIN labels l ON i.label_id = l.id
		LEFT JOIN users c ON i.creator_id = c.id
		LEFT JOIN users a ON i.assignee_id = a.id
		LEFT JOIN users u ON i.updated_by = u.id
		LEFT JOIN projects p ON i.project_id = p.id
		LEFT JOIN releases r ON i.release_id = r.id`

const (
	queryActiveIssues       = issueSelectBase + ` WHERE i.status NOT IN (?, ?) AND i.project_id = ? ORDER BY i.position ASC`
	queryArchivedIssues     = issueSelectBase + ` WHERE i.status = ? AND i.project_id = ? ORDER BY i.position ASC`
	queryOpenIssues         = issueSelectBase + ` WHERE i.status = ? AND i.project_id = ? ORDER BY i.position ASC`
	queryIssueByID          = issueSelectBase + ` WHERE i.id = ?`
	queryIssueByIDInProject = issueSelectBase + ` WHERE i.id = ? AND i.project_id = ?`
)

// getTasksForIssues fetches tasks for the given issues, keyed by issue ID.
func getTasksForIssues(ctx context.Context, issues []Issue) (map[int][]Task, error) {
	ids := make([]int, len(issues))
	for i, iss := range issues {
		ids[i] = iss.ID
	}
	jsonIDs, err := json.Marshal(ids)
	if err != nil {
		return nil, err
	}
	rows, err := DB.QueryContext(ctx,
		"SELECT id, issue_id, title, done, position, deadline, created_at, updated_at FROM tasks WHERE issue_id IN (SELECT value FROM json_each(?)) ORDER BY position ASC",
		string(jsonIDs),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[int][]Task)
	for rows.Next() {
		t, err := scanTaskRow(rows)
		if err != nil {
			return nil, err
		}
		result[t.IssueID] = append(result[t.IssueID], t)
	}
	return result, rows.Err()
}

// queryIssuesByProject executes query, scans the results, and attaches tasks.
func queryIssuesByProject(ctx context.Context, caller string, query string, args ...any) ([]Issue, error) {
	rows, err := DB.QueryContext(ctx, query, args...)
	if err != nil {
		LogError(dbErrPrefix+caller, "error", err)
		return nil, err
	}
	defer rows.Close()

	var issues []Issue
	for rows.Next() {
		i, err := scanIssueRow(rows)
		if err != nil {
			LogError(dbErrPrefix+caller+" Scan", "error", err)
			return nil, err
		}
		issues = append(issues, i)
	}
	if err := rows.Err(); err != nil {
		LogError(dbErrPrefix+caller+" Rows", "error", err)
		return nil, err
	}

	if len(issues) > 0 {
		tasksByIssue, err := getTasksForIssues(ctx, issues)
		if err != nil {
			LogError(dbErrPrefix+caller+" GetTasks", "error", err)
			return nil, err
		}
		for idx := range issues {
			issues[idx].Tasks = tasksByIssue[issues[idx].ID]
		}
	}

	return issues, nil
}

// GetActiveIssuesByProject retrieves issues in the active workflow statuses for a project (excludes Open and Archive).
func GetActiveIssuesByProject(ctx context.Context, projectID int) ([]Issue, error) {
	return queryIssuesByProject(ctx, "GetActiveIssuesByProject", queryActiveIssues, StatusArchive, StatusOpen, projectID)
}

// GetArchivedIssuesByProject retrieves all archived issues for a specific project.
func GetArchivedIssuesByProject(ctx context.Context, projectID int) ([]Issue, error) {
	return queryIssuesByProject(ctx, "GetArchivedIssuesByProject", queryArchivedIssues, StatusArchive, projectID)
}

// GetOpenIssuesByProject retrieves all open (status = Open) issues for a specific project.
func GetOpenIssuesByProject(ctx context.Context, projectID int) ([]Issue, error) {
	return queryIssuesByProject(ctx, "GetOpenIssuesByProject", queryOpenIssues, StatusOpen, projectID)
}

// GetIssueByID retrieves a single issue by ID, including its associated tasks.
func GetIssueByID(ctx context.Context, id int) (*Issue, error) {
	row := DB.QueryRowContext(ctx, queryIssueByID, id)
	issue, err := scanIssueRow(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		LogError("Database Error: GetIssueByID", "error", err)
		return nil, err
	}

	tasks, err := GetTasksByIssueID(ctx, issue.ID)
	if err != nil {
		LogError("Database Error: GetIssueByID GetTasksByIssueID", "error", err)
		return nil, err
	}
	issue.Tasks = tasks

	return &issue, nil
}

// UpdateIssue updates an existing issue in the database.
func UpdateIssue(ctx context.Context, i *Issue) error {
	i.UpdatedAt = time.Now().UTC()

	var labelID *int
	if i.Label != nil {
		id := i.Label.ID
		labelID = &id
	}

	var plannedDatesJSON any
	if i.PlannedDates != nil {
		b, err := json.Marshal(i.PlannedDates)
		if err != nil {
			LogError("Database Error: UpdateIssue Marshal Dates", "error", err)
			return err
		}
		plannedDatesJSON = string(b)
	}

	var updaterID *int
	if i.UpdaterID != nil && *i.UpdaterID != 0 {
		updaterID = i.UpdaterID
	}

	res, err := DB.ExecContext(ctx,
		"UPDATE issues SET title = ?, description = ?, status = ?, position = ?, deadline = ?, planned_dates = ?, priority = ?, label_id = ?, assignee_id = ?, updated_by = ?, project_id = ?, release_id = ?, updated_at = ? WHERE id = ?",
		i.Title, i.Description, i.Status, i.Position, i.Deadline, plannedDatesJSON, i.Priority, labelID, i.AssigneeID, updaterID, i.ProjectID, i.ReleaseID, i.UpdatedAt, i.ID,
	)
	if err != nil {
		LogError("Database Error: UpdateIssue", "error", err)
		return err
	}

	return checkRowsAffected(res, "UpdateIssue", ErrIssueNotFound)
}

// UpdateIssuePosition updates only the position of an issue without modifying
// updated_at or updated_by — used when a drag reorder shifts cards cosmetically.
func UpdateIssuePosition(ctx context.Context, id, position int) error {
	res, err := DB.ExecContext(ctx, "UPDATE issues SET position = ? WHERE id = ?", position, id)
	if err != nil {
		LogError("Database Error: UpdateIssuePosition", "error", err)
		return err
	}
	return checkRowsAffected(res, "UpdateIssuePosition", ErrIssueNotFound)
}

// DeleteIssue removes an issue from the database by its ID.
func DeleteIssue(ctx context.Context, id int) error {
	res, err := DB.ExecContext(ctx, "DELETE FROM issues WHERE id = ?", id)
	if err != nil {
		LogError("Database Error: DeleteIssue", "error", err)
		return err
	}

	return checkRowsAffected(res, "DeleteIssue", ErrIssueNotFound)
}

// CreateTask inserts a new task into the database.
func CreateTask(ctx context.Context, t *Task) error {
	exists, err := existsQuery(ctx, "SELECT COUNT(*) FROM issues WHERE id = ?", t.IssueID)
	if err != nil {
		LogError("Database Error: CreateTask CheckIssue", "error", err)
		return err
	}
	if !exists {
		return ErrIssueNotFound
	}

	// Get max position
	var maxPos sql.NullInt64
	err = DB.QueryRowContext(ctx, "SELECT MAX(position) FROM tasks WHERE issue_id = ?", t.IssueID).Scan(&maxPos)
	if err != nil && err != sql.ErrNoRows {
		LogError("Database Error: CreateTask MaxPos", "error", err)
		return err
	}
	t.Position = int(maxPos.Int64) + 1
	t.UpdatedAt = time.Now().UTC()

	res, err := DB.ExecContext(ctx,
		"INSERT INTO tasks(issue_id, title, done, position, deadline, updated_at) VALUES(?, ?, ?, ?, ?, ?)",
		t.IssueID, t.Title, t.Done, t.Position, t.Deadline, t.UpdatedAt,
	)
	if err != nil {
		LogError("Database Error: CreateTask", "error", err)
		return err
	}

	id, err := res.LastInsertId()
	if err != nil {
		LogError("Database Error: CreateTask LastInsertId", "error", err)
		return err
	}
	t.ID = int(id)
	return nil
}

// scanTaskRow scans one task row from any sql.Row or sql.Rows scanner.
func scanTaskRow(s issueScanner) (Task, error) {
	var t Task
	var deadline sql.NullTime
	if err := s.Scan(&t.ID, &t.IssueID, &t.Title, &t.Done, &t.Position, &deadline, &t.CreatedAt, &t.UpdatedAt); err != nil {
		return Task{}, err
	}
	if deadline.Valid {
		t.Deadline = &deadline.Time
	}
	return t, nil
}

// GetTasksByIssueID retrieves all tasks associated with a specific issue.
func GetTasksByIssueID(ctx context.Context, issueID int) ([]Task, error) {
	rows, err := DB.QueryContext(ctx, "SELECT id, issue_id, title, done, position, deadline, created_at, updated_at FROM tasks WHERE issue_id = ? ORDER BY position ASC", issueID)
	if err != nil {
		LogError("Database Error: GetTasksByIssueID", "error", err)
		return nil, err
	}
	defer rows.Close()

	var tasks []Task
	for rows.Next() {
		t, err := scanTaskRow(rows)
		if err != nil {
			LogError("Database Error: GetTasksByIssueID Scan", "error", err)
			return nil, err
		}
		tasks = append(tasks, t)
	}
	if err := rows.Err(); err != nil {
		LogError("Database Error: GetTasksByIssueID Rows", "error", err)
		return nil, err
	}
	return tasks, nil
}

// UpdateTask updates a task that must belong to the given issue. The (id,
// issue_id) pair is filtered in the SQL WHERE clause, so a task addressed
// through the wrong parent issue is indistinguishable from "no such task" —
// zero rows affected → ErrTaskNotFound → handler responds 404.
func UpdateTask(ctx context.Context, t *Task, issueID int) error {
	t.UpdatedAt = time.Now().UTC()
	res, err := DB.ExecContext(ctx,
		"UPDATE tasks SET title = ?, done = ?, position = ?, deadline = ?, updated_at = ? WHERE id = ? AND issue_id = ?",
		t.Title, t.Done, t.Position, t.Deadline, t.UpdatedAt, t.ID, issueID,
	)
	if err != nil {
		LogError("Database Error: UpdateTask", "error", err)
		return err
	}
	return checkRowsAffected(res, "UpdateTask", ErrTaskNotFound)
}

// DeleteTask removes a task that must belong to the given issue. Ownership is
// enforced in the WHERE clause; see UpdateTask for the rationale.
func DeleteTask(ctx context.Context, id, issueID int) error {
	res, err := DB.ExecContext(ctx, "DELETE FROM tasks WHERE id = ? AND issue_id = ?", id, issueID)
	if err != nil {
		LogError("Database Error: DeleteTask", "error", err)
		return err
	}

	return checkRowsAffected(res, "DeleteTask", ErrTaskNotFound)
}

// CreateLabel inserts a new label into the database.
func CreateLabel(ctx context.Context, l *Label) error {
	res, err := DB.ExecContext(ctx, "INSERT INTO labels(name, color, project_id) VALUES(?, ?, ?)", l.Name, l.Color, l.ProjectID)
	if err != nil {
		LogError("Database Error: CreateLabel", "error", err)
		return err
	}

	id, err := res.LastInsertId()
	if err != nil {
		LogError("Database Error: CreateLabel LastInsertId", "error", err)
		return err
	}
	l.ID = int(id)
	return nil
}

// GetLabelsByProject retrieves all labels belonging to a specific project.
func GetLabelsByProject(ctx context.Context, projectID int) ([]Label, error) {
	rows, err := DB.QueryContext(ctx, "SELECT id, name, color, project_id FROM labels WHERE project_id = ? ORDER BY name ASC", projectID)
	if err != nil {
		LogError("Database Error: GetLabelsByProject", "project_id", projectID, "error", err)
		return nil, err
	}
	defer rows.Close()

	labels := []Label{}
	for rows.Next() {
		var l Label
		if err := rows.Scan(&l.ID, &l.Name, &l.Color, &l.ProjectID); err != nil {
			LogError("Database Error: GetLabelsByProject Scan", "error", err)
			return nil, err
		}
		labels = append(labels, l)
	}
	if err := rows.Err(); err != nil {
		LogError("Database Error: GetLabelsByProject Rows", "error", err)
		return nil, err
	}
	return labels, nil
}

// DeleteLabel removes a label from the database, verifying it belongs to the given project.
func DeleteLabel(ctx context.Context, labelID, projectID int) error {
	res, err := DB.ExecContext(ctx, "DELETE FROM labels WHERE id = ? AND project_id = ?", labelID, projectID)
	if err != nil {
		LogError("Database Error: DeleteLabel", "error", err)
		return err
	}

	return checkRowsAffected(res, "DeleteLabel", ErrLabelNotFound)
}

// -----------------------------------------------------------------------------
// Project Management
// -----------------------------------------------------------------------------

// CreateProject inserts a new project into the database.
func CreateProject(ctx context.Context, p *Project) error {
	res, err := DB.ExecContext(ctx, "INSERT INTO projects(name, description) VALUES(?, ?)", p.Name, p.Description)
	if err != nil {
		if strings.Contains(err.Error(), errUniqueConstraintFailed) {
			return ErrDuplicateProjectName
		}
		LogError("Database Error: CreateProject", "error", err)
		return err
	}

	id, err := res.LastInsertId()
	if err != nil {
		LogError("Database Error: CreateProject LastInsertId", "error", err)
		return err
	}
	p.ID = int(id)

	// Seed default column/status config for the new project.
	if _, err := DB.ExecContext(ctx, `INSERT OR IGNORE INTO project_status_config (project_id) VALUES (?)`, p.ID); err != nil {
		LogError("Database Error: CreateProject seed status config", "error", err)
		return err
	}
	return nil
}

// GetAllProjects retrieves all projects from the database.
func GetAllProjects(ctx context.Context) ([]Project, error) {
	rows, err := DB.QueryContext(ctx, "SELECT id, name, description FROM projects ORDER BY id ASC")
	if err != nil {
		LogError("Database Error: GetAllProjects", "error", err)
		return nil, err
	}
	defer rows.Close()

	projects := []Project{} // Initialize as empty slice to ensure JSON [] instead of null
	for rows.Next() {
		var p Project
		if err := rows.Scan(&p.ID, &p.Name, &p.Description); err != nil {
			LogError("Database Error: GetAllProjects Scan", "error", err)
			return nil, err
		}
		projects = append(projects, p)
	}
	if err := rows.Err(); err != nil {
		LogError("Database Error: GetAllProjects Rows", "error", err)
		return nil, err
	}
	return projects, nil
}

// GetProjectByID retrieves a single project by its ID.
func GetProjectByID(ctx context.Context, id int) (*Project, error) {
	row := DB.QueryRowContext(ctx, "SELECT id, name, description FROM projects WHERE id = ?", id)

	var p Project
	err := row.Scan(&p.ID, &p.Name, &p.Description)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		LogError("Database Error: GetProjectByID", "error", err)
		return nil, err
	}
	return &p, nil
}

// UpdateProject updates an existing project in the database.
func UpdateProject(ctx context.Context, p *Project) error {
	res, err := DB.ExecContext(ctx, "UPDATE projects SET name = ?, description = ? WHERE id = ?", p.Name, p.Description, p.ID)
	if err != nil {
		if strings.Contains(err.Error(), errUniqueConstraintFailed) {
			return ErrDuplicateProjectName
		}
		LogError("Database Error: UpdateProject", "error", err)
		return err
	}

	return checkRowsAffected(res, "UpdateProject", ErrProjectNotFound)
}

// DeleteProject removes a project from the database by its ID.
func DeleteProject(ctx context.Context, id int) error {
	res, err := DB.ExecContext(ctx, "DELETE FROM projects WHERE id = ?", id)
	if err != nil {
		LogError("Database Error: DeleteProject", "error", err)
		return err
	}

	return checkRowsAffected(res, "DeleteProject", ErrProjectNotFound)
}

// CountIssuesByProject counts how many issues reference a given project.
func CountIssuesByProject(ctx context.Context, projectID int) (int, error) {
	var count int
	err := DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM issues WHERE project_id = ?", projectID).Scan(&count)
	if err != nil {
		LogError("Database Error: CountIssuesByProject", "project_id", projectID, "error", err)
		return 0, err
	}
	return count, nil
}

// issueScanner is satisfied by both *sql.Row and *sql.Rows, allowing a single
// scan implementation to be shared between single-row and multi-row queries.
type issueScanner interface {
	Scan(dest ...any) error
}

// scanIssueRow scans one issue row and hydrates all related fields.
func scanIssueRow(s issueScanner) (Issue, error) {
	var i Issue
	var desc sql.NullString
	var deadline sql.NullTime
	var plannedDatesStr sql.NullString
	var lID sql.NullInt64
	var lName, lColor sql.NullString
	var priority sql.NullString
	var cID sql.NullInt64
	var cEmail, cFirstName, cLastName sql.NullString
	var aID sql.NullInt64
	var aEmail, aFirstName, aLastName sql.NullString
	var uID sql.NullInt64
	var uEmail, uFirstName, uLastName sql.NullString
	var pID sql.NullInt64
	var pName, pDesc sql.NullString
	var rID sql.NullInt64
	var rName, rStatus sql.NullString
	var rReleaseDate sql.NullTime

	if err := s.Scan(&i.ID, &i.Title, &desc, &i.Status, &i.Position, &deadline, &plannedDatesStr, &priority, &i.CreatedAt, &i.UpdatedAt,
		&lID, &lName, &lColor,
		&cID, &cEmail, &cFirstName, &cLastName,
		&aID, &aEmail, &aFirstName, &aLastName,
		&uID, &uEmail, &uFirstName, &uLastName,
		&pID, &pName, &pDesc,
		&rID, &rName, &rStatus, &rReleaseDate); err != nil {
		return Issue{}, err
	}

	i.Description = desc.String
	if priority.Valid {
		i.Priority = IssuePriority(priority.String)
	} else {
		i.Priority = PriorityNormal
	}
	if deadline.Valid {
		i.Deadline = &deadline.Time
	}
	if plannedDatesStr.Valid {
		if err := json.Unmarshal([]byte(plannedDatesStr.String), &i.PlannedDates); err != nil {
			LogError("Database Error: parsing planned_dates", "id", i.ID, "error", err)
		}
	}
	if lID.Valid {
		i.Label = &Label{ID: int(lID.Int64), Name: lName.String, Color: lColor.String}
	}
	if cID.Valid {
		i.CreatorID = int(cID.Int64)
		i.Creator = &User{ID: int(cID.Int64), Email: cEmail.String, FirstName: cFirstName.String, LastName: cLastName.String}
	}
	if aID.Valid {
		id := int(aID.Int64)
		i.AssigneeID = &id
		i.Assignee = &User{ID: id, Email: aEmail.String, FirstName: aFirstName.String, LastName: aLastName.String}
	}
	if uID.Valid {
		id := int(uID.Int64)
		i.UpdaterID = &id
		i.Updater = &User{ID: id, Email: uEmail.String, FirstName: uFirstName.String, LastName: uLastName.String}
	}
	if pID.Valid {
		i.ProjectID = int(pID.Int64)
		i.Project = &Project{ID: int(pID.Int64), Name: pName.String, Description: pDesc.String}
	}
	if rID.Valid {
		id := int(rID.Int64)
		i.ReleaseID = &id
		rel := &Release{ID: id, Name: rName.String, Status: ReleaseStatus(rStatus.String)}
		if rReleaseDate.Valid {
			rel.ReleaseDate = &rReleaseDate.Time
		}
		i.Release = rel
	}

	return i, nil
}

// CreateUser inserts a new user into the database.
func CreateUser(ctx context.Context, u *User) error {
	u.UpdatedAt = time.Now().UTC()
	res, err := DB.ExecContext(ctx,
		"INSERT INTO users(email, first_name, last_name, password_hash, role, active, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?)",
		u.Email, u.FirstName, u.LastName, u.PasswordHash, u.Role, u.Active, u.UpdatedAt,
	)
	if err != nil {
		if strings.Contains(err.Error(), errUniqueConstraintFailed) {
			return ErrDuplicateEmail
		}
		LogError("Database Error: CreateUser", "error", err)
		return err
	}

	id, err := res.LastInsertId()
	if err != nil {
		LogError("Database Error: CreateUser LastInsertId", "error", err)
		return err
	}
	u.ID = int(id)
	return nil
}

// GetUserByEmail retrieves a user by their email address.
func GetUserByEmail(ctx context.Context, email string) (*User, error) {
	row := DB.QueryRowContext(ctx, "SELECT id, email, first_name, last_name, password_hash, role, active, created_at, updated_at, last_login FROM users WHERE email = ?", email)

	var u User
	var lastLogin sql.NullTime // last_login is nullable (NULL until first login)
	err := row.Scan(&u.ID, &u.Email, &u.FirstName, &u.LastName, &u.PasswordHash, &u.Role, &u.Active, &u.CreatedAt, &u.UpdatedAt, &lastLogin)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		LogError("Database Error: GetUserByEmail", "error", err)
		return nil, err
	}
	if lastLogin.Valid {
		u.LastLogin = &lastLogin.Time
	}
	return &u, nil
}

// GetUserByID retrieves a user by their ID.
func GetUserByID(ctx context.Context, id int) (*User, error) {
	row := DB.QueryRowContext(ctx, "SELECT id, email, first_name, last_name, password_hash, role, active, created_at, updated_at, last_login FROM users WHERE id = ?", id)

	var u User
	var lastLogin sql.NullTime
	err := row.Scan(&u.ID, &u.Email, &u.FirstName, &u.LastName, &u.PasswordHash, &u.Role, &u.Active, &u.CreatedAt, &u.UpdatedAt, &lastLogin)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		LogError("Database Error: GetUserByID", "error", err)
		return nil, err
	}
	if lastLogin.Valid {
		u.LastLogin = &lastLogin.Time
	}
	return &u, nil
}

// GetAllUsers retrieves all users from the database.
func GetAllUsers(ctx context.Context) ([]User, error) {
	rows, err := DB.QueryContext(ctx, "SELECT id, email, first_name, last_name, role, active, created_at, updated_at, last_login FROM users ORDER BY id ASC")
	if err != nil {
		LogError("Database Error: GetAllUsers", "error", err)
		return nil, err
	}
	defer rows.Close()

	users := []User{}
	for rows.Next() {
		var u User
		var lastLogin sql.NullTime
		if err := rows.Scan(&u.ID, &u.Email, &u.FirstName, &u.LastName, &u.Role, &u.Active, &u.CreatedAt, &u.UpdatedAt, &lastLogin); err != nil {
			LogError("Database Error: GetAllUsers Scan", "error", err)
			return nil, err
		}
		if lastLogin.Valid {
			u.LastLogin = &lastLogin.Time
		}
		users = append(users, u)
	}
	return users, nil
}

// UpdateUserLastLogin records the current time as the user's last successful login.
func UpdateUserLastLogin(ctx context.Context, userID int) error {
	_, err := DB.ExecContext(ctx, "UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?", userID)
	if err != nil {
		LogError("Database Error: UpdateUserLastLogin", "error", err)
	}
	return err
}

// UpdateUser updates an existing user in the database.
func UpdateUser(ctx context.Context, u *User) error {
	u.UpdatedAt = time.Now().UTC()
	res, err := DB.ExecContext(ctx,
		"UPDATE users SET email = ?, first_name = ?, last_name = ?, password_hash = ?, role = ?, active = ?, updated_at = ? WHERE id = ?",
		u.Email, u.FirstName, u.LastName, u.PasswordHash, u.Role, u.Active, u.UpdatedAt, u.ID,
	)
	if err != nil {
		if strings.Contains(err.Error(), errUniqueConstraintFailed) {
			return ErrDuplicateEmail
		}
		LogError("Database Error: UpdateUser", "error", err)
		return err
	}

	return checkRowsAffected(res, "UpdateUser", ErrUserNotFound)
}

// CountUsers returns the total number of users in the database.
func CountUsers(ctx context.Context) (int, error) {
	var count int
	err := DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM users").Scan(&count)
	if err != nil {
		LogError("Database Error: CountUsers", "error", err)
		return 0, err
	}
	return count, nil
}

// CountActiveSysAdmins returns the number of active users with sysadmin role.
func CountActiveSysAdmins(ctx context.Context) (int, error) {
	var count int
	err := DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM users WHERE role = ? AND active = 1", RoleSysAdmin).Scan(&count)
	if err != nil {
		LogError("Database Error: CountActiveSysAdmins", "error", err)
		return 0, err
	}
	return count, nil
}

// -----------------------------------------------------------------------------
// Session Management
// -----------------------------------------------------------------------------

// CreateSession inserts a new session into the database.
func CreateSession(ctx context.Context, s *Session) error {
	if s.CreatedAt.IsZero() {
		s.CreatedAt = time.Now().UTC()
	}
	s.ExpiresAt = s.ExpiresAt.UTC()

	res, err := DB.ExecContext(ctx,
		"INSERT INTO sessions(user_id, session_token, token_hash, expires_at, created_at) VALUES(?, ?, ?, ?, ?)",
		s.UserID, s.SessionToken, s.TokenHash, s.ExpiresAt, s.CreatedAt,
	)
	if err != nil {
		LogError("Database Error: CreateSession", "error", err)
		return err
	}

	id, err := res.LastInsertId()
	if err != nil {
		LogError("Database Error: CreateSession LastInsertId", "error", err)
		return err
	}
	s.ID = int(id)
	return nil
}

// GetSessionByID retrieves a session by its integer primary key.
func GetSessionByID(ctx context.Context, id int) (*Session, error) {
	row := DB.QueryRowContext(ctx, "SELECT id, user_id, session_token, token_hash, expires_at, created_at FROM sessions WHERE id = ?", id)

	var s Session
	err := row.Scan(&s.ID, &s.UserID, &s.SessionToken, &s.TokenHash, &s.ExpiresAt, &s.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		LogError("Database Error: GetSessionByID", "error", err)
		return nil, err
	}
	return &s, nil
}

// GetSessionByToken retrieves a session by its unguessable session_token lookup key.
func GetSessionByToken(ctx context.Context, token string) (*Session, error) {
	row := DB.QueryRowContext(ctx, "SELECT id, user_id, session_token, token_hash, expires_at, created_at FROM sessions WHERE session_token = ?", token)

	var s Session
	err := row.Scan(&s.ID, &s.UserID, &s.SessionToken, &s.TokenHash, &s.ExpiresAt, &s.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		LogError("Database Error: GetSessionByToken", "error", err)
		return nil, err
	}
	return &s, nil
}

// UpdateSession updates the token hash and expiration of an existing session (Rotation).
func UpdateSession(ctx context.Context, s *Session) error {
	res, err := DB.ExecContext(ctx, "UPDATE sessions SET token_hash = ?, expires_at = ? WHERE id = ?", s.TokenHash, s.ExpiresAt, s.ID)
	if err != nil {
		LogError("Database Error: UpdateSession", "error", err)
		return err
	}

	return checkRowsAffected(res, "UpdateSession", ErrSessionNotFound)
}

// DeleteSession removes a session from the database by its ID.
func DeleteSession(ctx context.Context, id int) error {
	res, err := DB.ExecContext(ctx, "DELETE FROM sessions WHERE id = ?", id)
	if err != nil {
		LogError("Database Error: DeleteSession", "error", err)
		return err
	}

	return checkRowsAffected(res, "DeleteSession", ErrSessionNotFound)
}

// DeleteSessionsByUserID removes all sessions for a specific user.
func DeleteSessionsByUserID(ctx context.Context, userID int) error {
	_, err := DB.ExecContext(ctx, "DELETE FROM sessions WHERE user_id = ?", userID)
	if err != nil {
		LogError("Database Error: DeleteSessionsByUserID", "error", err)
		return err
	}
	return nil
}

// DeleteExpiredSessions removes all sessions that have expired from the database.
func DeleteExpiredSessions(ctx context.Context) (int64, error) {
	// Use time.Now() so the driver formats it consistently with how sessions were inserted
	res, err := DB.ExecContext(ctx, "DELETE FROM sessions WHERE expires_at < ?", time.Now().UTC())
	if err != nil {
		LogError("Database Error: DeleteExpiredSessions", "error", err)
		return 0, err
	}

	rowsAffected, err := res.RowsAffected()
	if err != nil {
		LogError("Database Error: DeleteExpiredSessions RowsAffected", "error", err)
		return 0, err
	}
	return rowsAffected, nil
}

// GetStatusConfig retrieves the status config for a project.
// Returns default values if no config row exists yet.
func GetStatusConfig(ctx context.Context, projectID int) (*StatusConfig, error) {
	cfg := &StatusConfig{ProjectID: projectID}
	err := DB.QueryRowContext(ctx,
		`SELECT stage1_name, stage2_name, stage3_name, stage4_name
		 FROM project_status_config WHERE project_id = ?`, projectID,
	).Scan(&cfg.Stage1Name, &cfg.Stage2Name, &cfg.Stage3Name, &cfg.Stage4Name)
	if errors.Is(err, sql.ErrNoRows) {
		cfg.Stage1Name = "Pending"
		cfg.Stage2Name = "Working"
		return cfg, nil
	}
	if err != nil {
		LogError("Database Error: GetStatusConfig", "project_id", projectID, "error", err)
		return nil, err
	}
	return cfg, nil
}

// -----------------------------------------------------------------------------
// Release Management
// -----------------------------------------------------------------------------

// CreateRelease inserts a new release into the database.
func CreateRelease(ctx context.Context, r *Release) error {
	r.Status = ReleaseStatusOpen
	r.CreatedAt = time.Now().UTC()
	r.UpdatedAt = r.CreatedAt
	res, err := DB.ExecContext(ctx,
		`INSERT INTO releases(project_id, name, description, start_date, release_date, status, owner_id, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		r.ProjectID, r.Name, r.Description, r.StartDate, r.ReleaseDate, r.Status, r.OwnerID, r.CreatedAt, r.UpdatedAt,
	)
	if err != nil {
		if strings.Contains(err.Error(), errUniqueConstraintFailed) {
			return ErrDuplicateReleaseName
		}
		LogError("Database Error: CreateRelease", "error", err)
		return err
	}
	id, err := res.LastInsertId()
	if err != nil {
		LogError("Database Error: CreateRelease LastInsertId", "error", err)
		return err
	}
	r.ID = int(id)
	return nil
}

// GetReleasesByProject retrieves all releases for a project ordered by created_at desc.
func GetReleasesByProject(ctx context.Context, projectID int) ([]Release, error) {
	rows, err := DB.QueryContext(ctx,
		`SELECT r.id, r.project_id, r.name, r.description, r.start_date, r.release_date, r.closed_at, r.status, r.created_at, r.updated_at,
		        o.id, o.first_name, o.last_name, o.email
		 FROM releases r
		 LEFT JOIN users o ON r.owner_id = o.id
		 WHERE r.project_id = ? ORDER BY r.created_at DESC`, projectID,
	)
	if err != nil {
		LogError("Database Error: GetReleasesByProject", "project_id", projectID, "error", err)
		return nil, err
	}
	defer rows.Close()

	releases := []Release{}
	for rows.Next() {
		r, err := scanRelease(rows)
		if err != nil {
			LogError("Database Error: GetReleasesByProject Scan", "error", err)
			return nil, err
		}
		releases = append(releases, r)
	}
	if err := rows.Err(); err != nil {
		LogError("Database Error: GetReleasesByProject Rows", "error", err)
		return nil, err
	}
	return releases, nil
}

// releaseNullFields holds the nullable columns scanned for a release row.
type releaseNullFields struct {
	startDate   sql.NullTime
	releaseDate sql.NullTime
	closedAt    sql.NullTime
	ownerID     sql.NullInt64
	ownerFirst  sql.NullString
	ownerLast   sql.NullString
	ownerEmail  sql.NullString
}

// hydrateRelease fills the nullable date and owner fields on r after a Scan.
func hydrateRelease(r *Release, f releaseNullFields) {
	if f.startDate.Valid {
		r.StartDate = &f.startDate.Time
	}
	if f.releaseDate.Valid {
		r.ReleaseDate = &f.releaseDate.Time
	}
	if f.closedAt.Valid {
		r.ClosedAt = &f.closedAt.Time
	}
	if f.ownerID.Valid {
		oid := int(f.ownerID.Int64)
		r.OwnerID = &oid
		r.Owner = &User{ID: oid, FirstName: f.ownerFirst.String, LastName: f.ownerLast.String, Email: f.ownerEmail.String}
	}
}

// GetReleaseByID retrieves a single release by ID.
func GetReleaseByID(ctx context.Context, id int) (*Release, error) {
	row := DB.QueryRowContext(ctx,
		`SELECT r.id, r.project_id, r.name, r.description, r.start_date, r.release_date, r.closed_at, r.status, r.created_at, r.updated_at,
		        o.id, o.first_name, o.last_name, o.email
		 FROM releases r
		 LEFT JOIN users o ON r.owner_id = o.id
		 WHERE r.id = ?`, id,
	)
	var r Release
	var f releaseNullFields
	err := row.Scan(&r.ID, &r.ProjectID, &r.Name, &r.Description, &f.startDate, &f.releaseDate, &f.closedAt, &r.Status, &r.CreatedAt, &r.UpdatedAt,
		&f.ownerID, &f.ownerFirst, &f.ownerLast, &f.ownerEmail)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		LogError("Database Error: GetReleaseByID", "id", id, "error", err)
		return nil, err
	}
	hydrateRelease(&r, f)
	return &r, nil
}

// UpdateRelease updates name, description, dates, and owner of an existing release.
func UpdateRelease(ctx context.Context, r *Release) error {
	r.UpdatedAt = time.Now().UTC()
	res, err := DB.ExecContext(ctx,
		`UPDATE releases SET name = ?, description = ?, start_date = ?, release_date = ?, owner_id = ?, updated_at = ? WHERE id = ?`,
		r.Name, r.Description, r.StartDate, r.ReleaseDate, r.OwnerID, r.UpdatedAt, r.ID,
	)
	if err != nil {
		if strings.Contains(err.Error(), errUniqueConstraintFailed) {
			return ErrDuplicateReleaseName
		}
		LogError("Database Error: UpdateRelease", "id", r.ID, "error", err)
		return err
	}
	return checkRowsAffected(res, "UpdateRelease", ErrReleaseNotFound)
}

// DeleteRelease removes a release. The FK ON DELETE SET NULL clears release_id on issues.
func DeleteRelease(ctx context.Context, id int) error {
	res, err := DB.ExecContext(ctx, `DELETE FROM releases WHERE id = ?`, id)
	if err != nil {
		LogError("Database Error: DeleteRelease", "id", id, "error", err)
		return err
	}
	return checkRowsAffected(res, "DeleteRelease", ErrReleaseNotFound)
}

// ReopenRelease sets a release status back to 'open'. Already archived issues are not changed.
func ReopenRelease(ctx context.Context, id int) error {
	now := time.Now().UTC()
	res, err := DB.ExecContext(ctx, `UPDATE releases SET status = ?, closed_at = NULL, updated_at = ? WHERE id = ? AND status = ?`,
		ReleaseStatusOpen, now, id, ReleaseStatusClosed,
	)
	if err != nil {
		LogError("Database Error: ReopenRelease", "id", id, "error", err)
		return err
	}
	return checkRowsAffected(res, "ReopenRelease", ErrReleaseNotFound)
}

// TriggerRelease sets a release status to 'closed' and optionally archives all Done issues in it.
func TriggerRelease(ctx context.Context, id int, archiveDone bool) error {
	now := time.Now().UTC()
	res, err := DB.ExecContext(ctx, `UPDATE releases SET status = ?, closed_at = ?, updated_at = ? WHERE id = ? AND status = ?`,
		ReleaseStatusClosed, now, now, id, ReleaseStatusOpen,
	)
	if err != nil {
		LogError("Database Error: TriggerRelease", "id", id, "error", err)
		return err
	}
	if err := checkRowsAffected(res, "TriggerRelease", ErrReleaseNotFound); err != nil {
		return err
	}
	if archiveDone {
		if _, err := DB.ExecContext(ctx,
			`UPDATE issues SET status = ?, updated_at = ? WHERE release_id = ? AND status = ?`,
			StatusArchive, now, id, StatusDone,
		); err != nil {
			LogError("Database Error: TriggerRelease archive done issues", "id", id, "error", err)
			return err
		}
	}
	return nil
}

// ReleaseExistsInProject checks if a release exists and belongs to the given project.
// Used by checkRelease to validate that a release referenced from an issue body lives
// in the same project as the issue.
func ReleaseExistsInProject(ctx context.Context, releaseID, projectID int) (bool, error) {
	return existsQuery(ctx, "SELECT COUNT(*) FROM releases WHERE id = ? AND project_id = ?", releaseID, projectID)
}

// GetReleaseByIDInProject returns the release only if it belongs to the given project.
// Filtered in the SQL WHERE clause; same nil-on-not-in-project contract as
// GetIssueByIDInProject.
func GetReleaseByIDInProject(ctx context.Context, id, projectID int) (*Release, error) {
	row := DB.QueryRowContext(ctx,
		`SELECT r.id, r.project_id, r.name, r.description, r.start_date, r.release_date, r.closed_at, r.status, r.created_at, r.updated_at,
		        o.id, o.first_name, o.last_name, o.email
		 FROM releases r
		 LEFT JOIN users o ON r.owner_id = o.id
		 WHERE r.id = ? AND r.project_id = ?`, id, projectID,
	)
	var r Release
	var f releaseNullFields
	err := row.Scan(&r.ID, &r.ProjectID, &r.Name, &r.Description, &f.startDate, &f.releaseDate, &f.closedAt, &r.Status, &r.CreatedAt, &r.UpdatedAt,
		&f.ownerID, &f.ownerFirst, &f.ownerLast, &f.ownerEmail)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		LogError("Database Error: GetReleaseByIDInProject", "id", id, "project_id", projectID, "error", err)
		return nil, err
	}
	hydrateRelease(&r, f)
	return &r, nil
}

func scanRelease(rows *sql.Rows) (Release, error) {
	var r Release
	var f releaseNullFields
	if err := rows.Scan(&r.ID, &r.ProjectID, &r.Name, &r.Description, &f.startDate, &f.releaseDate, &f.closedAt, &r.Status, &r.CreatedAt, &r.UpdatedAt,
		&f.ownerID, &f.ownerFirst, &f.ownerLast, &f.ownerEmail); err != nil {
		return Release{}, err
	}
	hydrateRelease(&r, f)
	return r, nil
}

// UpsertStatusConfig saves the status config for a project.
func UpsertStatusConfig(ctx context.Context, cfg *StatusConfig) error {
	_, err := DB.ExecContext(ctx,
		`INSERT OR REPLACE INTO project_status_config
		 (project_id, stage1_name, stage2_name, stage3_name, stage4_name)
		 VALUES (?, ?, ?, ?, ?)`,
		cfg.ProjectID, cfg.Stage1Name, cfg.Stage2Name, cfg.Stage3Name, cfg.Stage4Name,
	)
	if err != nil {
		LogError("Database Error: UpsertStatusConfig", "project_id", cfg.ProjectID, "error", err)
	}
	return err
}
