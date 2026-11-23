package backend

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
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

// ErrCommentNotFound is returned when a comment is not found (or not owned by the
// requesting non-admin user, which is deliberately indistinguishable).
var ErrCommentNotFound = errors.New("comment not found")

// ErrLabelNotFound is returned when a label is not found.
var ErrLabelNotFound = errors.New("label not found")

// ErrUserNotFound is returned when a user is not found.
var ErrUserNotFound = errors.New("user not found")

// ErrLastSysAdmin is returned when a write would leave no active sysadmin.
var ErrLastSysAdmin = errors.New("last active sysadmin")

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
		return fmt.Errorf("failed to open database: %w", err)
	}

	if err = DB.PingContext(ctx); err != nil {
		return fmt.Errorf("failed to ping database: %w", err)
	}

	if _, err := DB.ExecContext(ctx, "PRAGMA journal_mode=WAL"); err != nil {
		return fmt.Errorf("failed to set WAL mode: %w", err)
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
		return fmt.Errorf("failed to create projects table: %w", err)
	}

	// Seed the default project
	if _, err := DB.ExecContext(ctx, `INSERT OR IGNORE INTO projects(id, name, description) VALUES(?, 'default', 'Default project')`, DefaultProjectID); err != nil {
		return fmt.Errorf("failed to seed default project: %w", err)
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
		return fmt.Errorf("failed to create releases table: %w", err)
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
		return fmt.Errorf("failed to create issues table: %w", err)
	}

	if _, err := DB.ExecContext(ctx, createTasksTable); err != nil {
		return fmt.Errorf("failed to create tasks table: %w", err)
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
		return fmt.Errorf("failed to create labels table: %w", err)
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
		return fmt.Errorf("failed to create project_status_config table: %w", err)
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
		return fmt.Errorf("failed to create users table: %w", err)
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
		return fmt.Errorf("failed to create sessions table: %w", err)
	}
	// Create index on user_id to speed up session revocation by user (e.g., logout all devices)
	if _, err := DB.ExecContext(ctx, "CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);"); err != nil {
		return fmt.Errorf("failed to create index on sessions(user_id): %w", err)
	}

	if err := createActivityTables(ctx); err != nil {
		return err
	}

	if err := runMigrations(ctx); err != nil {
		return err
	}
	// Create index on session_token after migrations so the column is guaranteed to exist on existing DBs.
	if _, err := DB.ExecContext(ctx, "CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(session_token);"); err != nil {
		return fmt.Errorf("failed to create index on sessions(session_token): %w", err)
	}
	return nil
}

// runMigrations applies incremental schema and data migrations to existing databases.
// All migrations must be idempotent so they are safe to run on every startup.
func runMigrations(ctx context.Context) error {
	return migrateCalendarDates(ctx)
}

// calendarDateColumns are the columns that hold a calendar date (YYYY-MM-DD), with the
// statements migrateCalendarDates runs on them.
var calendarDateColumns = []struct{ name, migrate, countUnreadable string }{
	{"issues.deadline",
		"UPDATE issues SET deadline = date(deadline) WHERE date(deadline) IS NOT NULL AND deadline <> date(deadline)",
		"SELECT COUNT(*) FROM issues WHERE deadline IS NOT NULL AND date(deadline) IS NULL"},
	{"tasks.deadline",
		"UPDATE tasks SET deadline = date(deadline) WHERE date(deadline) IS NOT NULL AND deadline <> date(deadline)",
		"SELECT COUNT(*) FROM tasks WHERE deadline IS NOT NULL AND date(deadline) IS NULL"},
	{"releases.start_date",
		"UPDATE releases SET start_date = date(start_date) WHERE date(start_date) IS NOT NULL AND start_date <> date(start_date)",
		"SELECT COUNT(*) FROM releases WHERE start_date IS NOT NULL AND date(start_date) IS NULL"},
	{"releases.release_date",
		"UPDATE releases SET release_date = date(release_date) WHERE date(release_date) IS NOT NULL AND release_date <> date(release_date)",
		"SELECT COUNT(*) FROM releases WHERE release_date IS NOT NULL AND date(release_date) IS NULL"},
}

// migrateCalendarDates rewrites deadlines and release dates stored as timestamps (up to 1.5.0)
// to YYYY-MM-DD. SQLite's date() takes the stored offset into account, so a value becomes its
// UTC date: right for midnight-UTC values and for the local noon the UI saved in UTC−12 to
// UTC+12. A value date() cannot read is left as it is.
//
// TODO(calendar-dates): Remove with calendarDateColumns once upgrades from 1.5.0 or older are
// no longer supported.
func migrateCalendarDates(ctx context.Context) error {
	for _, c := range calendarDateColumns {
		res, err := DB.ExecContext(ctx, c.migrate)
		if err != nil {
			return fmt.Errorf("migrate %s to calendar dates: %w", c.name, err)
		}
		n, err := res.RowsAffected()
		if err != nil {
			return fmt.Errorf("count migrated %s: %w", c.name, err)
		}
		if n > 0 {
			LogInfo("Migrated timestamps to calendar dates", "column", c.name, "count", n)
		}
		var unreadable int
		if err := DB.QueryRowContext(ctx, c.countUnreadable).Scan(&unreadable); err != nil {
			return fmt.Errorf("count unreadable %s: %w", c.name, err)
		}
		if unreadable > 0 {
			LogWarn("Calendar dates left unconverted, not readable as a date", "column", c.name, "count", unreadable)
		}
	}
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
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetIssueByIDInProject: %w", err)
	}
	tasks, err := GetTasksByIssueID(ctx, issue.ID)
	if err != nil {
		return nil, fmt.Errorf("GetIssueByIDInProject GetTasksByIssueID: %w", err)
	}
	issue.Tasks = tasks
	return &issue, nil
}

// ProjectAccessible reports whether the project exists and userID may see it (accessibleProjects).
func ProjectAccessible(ctx context.Context, userID, projectID int) (bool, error) {
	projectsSQL, projectArgs := accessibleProjects(userID)
	return existsQuery(ctx, "SELECT COUNT(*) FROM projects WHERE id = ? AND id IN ("+projectsSQL+")", append([]any{projectID}, projectArgs...)...)
}

// existsQuery runs a SELECT COUNT(*) query and returns true if count > 0.
func existsQuery(ctx context.Context, query string, args ...any) (bool, error) {
	var count int
	if err := DB.QueryRowContext(ctx, query, args...).Scan(&count); err != nil {
		return false, fmt.Errorf("existence check: %w", err)
	}
	return count > 0, nil
}

// checkRowsAffected inspects res and returns notFoundErr when zero rows were affected.
func checkRowsAffected(res sql.Result, caller string, notFoundErr error) error {
	rows, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("%s RowsAffected: %w", caller, err)
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
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("CreateIssue MaxPos: %w", err)
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
			return fmt.Errorf("CreateIssue Marshal Dates: %w", err)
		}
		plannedDatesJSON = string(b)
	}

	res, err := DB.ExecContext(ctx,
		"INSERT INTO issues(title, description, status, position, deadline, planned_dates, priority, label_id, creator_id, assignee_id, updated_by, project_id, release_id, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		i.Title, i.Description, i.Status, i.Position, i.Deadline, plannedDatesJSON, i.Priority, labelID, creatorID, i.AssigneeID, updaterID, i.ProjectID, i.ReleaseID, i.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("CreateIssue: %w", err)
	}

	id, err := res.LastInsertId()
	if err != nil {
		return fmt.Errorf("CreateIssue LastInsertId: %w", err)
	}
	i.ID = int(id)
	return nil
}

// issueSelectBase is the shared SELECT + JOIN used by all project-scoped issue queries.
const issueSelectBase = `
		SELECT i.id, i.title, i.description, i.status, i.position, i.deadline, i.planned_dates, i.priority, i.created_at, i.updated_at,
		       l.id, l.name, l.color,
		       i.creator_id, i.updated_by,
		       a.id, a.email, a.first_name, a.last_name,
		       p.id, p.name, p.description,
		       r.id, r.name, r.status, r.release_date
		FROM issues i
		LEFT JOIN labels l ON i.label_id = l.id
		LEFT JOIN users a ON i.assignee_id = a.id
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
		return nil, fmt.Errorf("%s: %w", caller, err)
	}
	defer rows.Close()

	var issues []Issue
	for rows.Next() {
		i, err := scanIssueRow(rows)
		if err != nil {
			return nil, fmt.Errorf("%s Scan: %w", caller, err)
		}
		issues = append(issues, i)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("%s Rows: %w", caller, err)
	}

	if len(issues) > 0 {
		tasksByIssue, err := getTasksForIssues(ctx, issues)
		if err != nil {
			return nil, fmt.Errorf("%s GetTasks: %w", caller, err)
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

// accessibleProjects returns a subquery selecting the IDs of the projects userID may see,
// plus its arguments. ProjectAccessible (all project-scoped routes) and GetMyActiveIssues use it.
// The paths that do not are listed in docs/backend-architecture.md ("checkProjectAccess — the
// future-membership hook").
//
// TODO(per-project-membership): When the project_users table is introduced, select the
// user's projects here, e.g. "SELECT project_id FROM project_users WHERE user_id = ?".
//
//nolint:unparam // userID and the arguments are unused until per-project membership exists.
func accessibleProjects(userID int) (string, []any) {
	_ = userID
	return "SELECT id FROM projects", nil
}

// GetMyActiveIssues returns the issues assigned to userID in the active board statuses
// (To-do, Stage1–4, Done) of all projects the user may see, each with the name of its
// board column. Three queries regardless of the number of issues: issues, their tasks,
// the status configs of their projects.
func GetMyActiveIssues(ctx context.Context, userID int) ([]MyIssue, error) {
	projectsSQL, projectArgs := accessibleProjects(userID)
	query := issueSelectBase + ` WHERE i.assignee_id = ? AND i.status NOT IN (?, ?) AND i.project_id IN (` + projectsSQL + `) ORDER BY i.position ASC`
	args := append([]any{userID, StatusArchive, StatusOpen}, projectArgs...)
	issues, err := queryIssuesByProject(ctx, "GetMyActiveIssues", query, args...)
	if err != nil {
		return nil, err
	}
	configs, err := getStatusConfigsForIssues(ctx, issues)
	if err != nil {
		return nil, err
	}
	result := make([]MyIssue, len(issues))
	for idx, iss := range issues {
		cfg, ok := configs[iss.ProjectID]
		if !ok {
			cfg = defaultStatusConfig(iss.ProjectID)
		}
		result[idx] = MyIssue{Issue: iss, StatusName: cfg.DisplayName(iss.Status)}
	}
	return result, nil
}

// getStatusConfigsForIssues fetches the status config rows of the issues' projects, keyed
// by project ID. Projects without a row are missing from the map (they use the defaults).
func getStatusConfigsForIssues(ctx context.Context, issues []Issue) (map[int]StatusConfig, error) {
	ids := make([]int, len(issues))
	for i, iss := range issues {
		ids[i] = iss.ProjectID
	}
	jsonIDs, err := json.Marshal(ids)
	if err != nil {
		return nil, err
	}
	rows, err := DB.QueryContext(ctx,
		"SELECT project_id, stage1_name, stage2_name, stage3_name, stage4_name FROM project_status_config WHERE project_id IN (SELECT value FROM json_each(?))",
		string(jsonIDs),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[int]StatusConfig)
	for rows.Next() {
		var c StatusConfig
		if err := rows.Scan(&c.ProjectID, &c.Stage1Name, &c.Stage2Name, &c.Stage3Name, &c.Stage4Name); err != nil {
			return nil, err
		}
		result[c.ProjectID] = c
	}
	return result, rows.Err()
}

// GetIssueByID retrieves a single issue by ID, including its associated tasks.
func GetIssueByID(ctx context.Context, id int) (*Issue, error) {
	row := DB.QueryRowContext(ctx, queryIssueByID, id) //NOSONAR, query is a compile-time constant; id is a bound parameter
	issue, err := scanIssueRow(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetIssueByID: %w", err)
	}

	tasks, err := GetTasksByIssueID(ctx, issue.ID)
	if err != nil {
		return nil, fmt.Errorf("GetIssueByID GetTasksByIssueID: %w", err)
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
			return fmt.Errorf("UpdateIssue Marshal Dates: %w", err)
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
		return fmt.Errorf("UpdateIssue: %w", err)
	}

	return checkRowsAffected(res, "UpdateIssue", ErrIssueNotFound)
}

// UpdateIssuePosition updates only the position of an issue without modifying
// updated_at or updated_by — used when a drag reorder shifts cards cosmetically.
func UpdateIssuePosition(ctx context.Context, id, position int) error {
	res, err := DB.ExecContext(ctx, "UPDATE issues SET position = ? WHERE id = ?", position, id)
	if err != nil {
		return fmt.Errorf("UpdateIssuePosition: %w", err)
	}
	return checkRowsAffected(res, "UpdateIssuePosition", ErrIssueNotFound)
}

// UpdateIssuePositions applies a whole reorder in one transaction: either all
// positions are saved or none. Like UpdateIssuePosition it leaves updated_at and
// updated_by untouched. Every issue must belong to the project and must not be
// archived; otherwise the transaction is rolled back and ErrIssueNotFound returned.
func UpdateIssuePositions(ctx context.Context, projectID int, updates []PositionUpdate) error {
	return applyPositionUpdates(ctx, "UpdateIssuePositions",
		"UPDATE issues SET position = ? WHERE id = ? AND project_id = ? AND status != ?",
		updates, ErrIssueNotFound, projectID, StatusArchive)
}

// UpdateTaskPositions applies a task reorder in one transaction. Every task must
// belong to the given issue; otherwise the transaction is rolled back and
// ErrTaskNotFound returned. updated_at is left untouched, as for issue positions.
func UpdateTaskPositions(ctx context.Context, issueID int, updates []PositionUpdate) error {
	return applyPositionUpdates(ctx, "UpdateTaskPositions",
		"UPDATE tasks SET position = ? WHERE id = ? AND issue_id = ?",
		updates, ErrTaskNotFound, issueID)
}

// applyPositionUpdates runs query once per update inside a single transaction.
// query takes (position, id, scopeArgs...). A statement that matches no row
// rolls back the whole transaction and returns notFoundErr.
func applyPositionUpdates(ctx context.Context, caller, query string, updates []PositionUpdate, notFoundErr error, scopeArgs ...any) error {
	tx, err := DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("%s BeginTx: %w", caller, err)
	}
	// Undoes all writes if the function returns before Commit, e.g. on an error.
	// After a successful Commit there is nothing left to undo, so this changes nothing.
	defer func() { _ = tx.Rollback() }()

	stmt, err := tx.PrepareContext(ctx, query)
	if err != nil {
		return fmt.Errorf("%s Prepare: %w", caller, err)
	}
	defer func() { _ = stmt.Close() }()

	for _, u := range updates {
		args := append([]any{u.Position, u.ID}, scopeArgs...)
		res, err := stmt.ExecContext(ctx, args...)
		if err != nil {
			return fmt.Errorf("%s id=%d: %w", caller, u.ID, err)
		}
		if err := checkRowsAffected(res, caller, notFoundErr); err != nil {
			return err
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("%s Commit: %w", caller, err)
	}
	return nil
}

// DeleteIssue removes an issue from the database by its ID.
func DeleteIssue(ctx context.Context, id int) error {
	res, err := DB.ExecContext(ctx, "DELETE FROM issues WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("DeleteIssue: %w", err)
	}

	return checkRowsAffected(res, "DeleteIssue", ErrIssueNotFound)
}

// CreateTask inserts a new task into the database.
func CreateTask(ctx context.Context, t *Task) error {
	exists, err := existsQuery(ctx, "SELECT COUNT(*) FROM issues WHERE id = ?", t.IssueID)
	if err != nil {
		return fmt.Errorf("CreateTask CheckIssue: %w", err)
	}
	if !exists {
		return ErrIssueNotFound
	}

	// Get max position
	var maxPos sql.NullInt64
	err = DB.QueryRowContext(ctx, "SELECT MAX(position) FROM tasks WHERE issue_id = ?", t.IssueID).Scan(&maxPos)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("CreateTask MaxPos: %w", err)
	}
	t.Position = int(maxPos.Int64) + 1
	t.UpdatedAt = time.Now().UTC()

	res, err := DB.ExecContext(ctx,
		"INSERT INTO tasks(issue_id, title, done, position, deadline, updated_at) VALUES(?, ?, ?, ?, ?, ?)",
		t.IssueID, t.Title, t.Done, t.Position, t.Deadline, t.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("CreateTask: %w", err)
	}

	id, err := res.LastInsertId()
	if err != nil {
		return fmt.Errorf("CreateTask LastInsertId: %w", err)
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
	t.Deadline = calendarDate(deadline)
	return t, nil
}

// GetTasksByIssueID retrieves all tasks associated with a specific issue.
func GetTasksByIssueID(ctx context.Context, issueID int) ([]Task, error) {
	rows, err := DB.QueryContext(ctx, "SELECT id, issue_id, title, done, position, deadline, created_at, updated_at FROM tasks WHERE issue_id = ? ORDER BY position ASC", issueID)
	if err != nil {
		return nil, fmt.Errorf("GetTasksByIssueID: %w", err)
	}
	defer rows.Close()

	var tasks []Task
	for rows.Next() {
		t, err := scanTaskRow(rows)
		if err != nil {
			return nil, fmt.Errorf("GetTasksByIssueID Scan: %w", err)
		}
		tasks = append(tasks, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("GetTasksByIssueID Rows: %w", err)
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
		return fmt.Errorf("UpdateTask: %w", err)
	}
	return checkRowsAffected(res, "UpdateTask", ErrTaskNotFound)
}

// DeleteTask removes a task that must belong to the given issue. Ownership is
// enforced in the WHERE clause; see UpdateTask for the rationale.
func DeleteTask(ctx context.Context, id, issueID int) error {
	res, err := DB.ExecContext(ctx, "DELETE FROM tasks WHERE id = ? AND issue_id = ?", id, issueID)
	if err != nil {
		return fmt.Errorf("DeleteTask: %w", err)
	}

	return checkRowsAffected(res, "DeleteTask", ErrTaskNotFound)
}

// createActivityTables creates the issue_history and issue_comments tables and
// their indexes. Both are children of issues (ON DELETE CASCADE) and reference
// users with ON DELETE SET NULL so history/comments survive user deletion.
func createActivityTables(ctx context.Context) error {
	createIssueHistoryTable := `
	CREATE TABLE IF NOT EXISTS issue_history (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		issue_id INTEGER NOT NULL,
		user_id INTEGER,
		event TEXT NOT NULL,
		data TEXT NOT NULL DEFAULT '{}',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
	);`
	if _, err := DB.ExecContext(ctx, createIssueHistoryTable); err != nil {
		return fmt.Errorf("failed to create issue_history table: %w", err)
	}
	if _, err := DB.ExecContext(ctx, "CREATE INDEX IF NOT EXISTS idx_issue_history_issue ON issue_history(issue_id, created_at, id);"); err != nil {
		return fmt.Errorf("failed to create index on issue_history(issue_id): %w", err)
	}

	createIssueCommentsTable := `
	CREATE TABLE IF NOT EXISTS issue_comments (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		issue_id INTEGER NOT NULL,
		user_id INTEGER,
		body TEXT NOT NULL,
		edited BOOLEAN NOT NULL DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
	);`
	if _, err := DB.ExecContext(ctx, createIssueCommentsTable); err != nil {
		return fmt.Errorf("failed to create issue_comments table: %w", err)
	}
	if _, err := DB.ExecContext(ctx, "CREATE INDEX IF NOT EXISTS idx_issue_comments_issue ON issue_comments(issue_id, created_at, id);"); err != nil {
		return fmt.Errorf("failed to create index on issue_comments(issue_id): %w", err)
	}
	return nil
}

// nullableUserID converts a *int user id into a value suitable for a nullable FK
// column: a nil pointer or a zero id becomes SQL NULL (mirrors CreateIssue's
// handling of creator_id so an unauthenticated/zero id never violates the users FK).
func nullableUserID(id *int) any {
	if id == nil || *id == 0 {
		return nil
	}
	return *id
}

// CreateHistoryEntry inserts an immutable audit-trail record for an issue.
func CreateHistoryEntry(ctx context.Context, h *HistoryEntry) error {
	dataJSON, err := json.Marshal(h.Data)
	if err != nil {
		return fmt.Errorf("CreateHistoryEntry Marshal: %w", err)
	}
	res, err := DB.ExecContext(ctx,
		"INSERT INTO issue_history(issue_id, user_id, event, data) VALUES(?, ?, ?, ?)",
		h.IssueID, nullableUserID(h.UserID), h.Event, string(dataJSON),
	)
	if err != nil {
		return fmt.Errorf("CreateHistoryEntry: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return fmt.Errorf("CreateHistoryEntry LastInsertId: %w", err)
	}
	h.ID = int(id)
	return nil
}

// activityUserCols / activityUserJoin hydrate the actor/author from a LEFT JOIN
// on users, so a deleted user (NULL user_id) yields a nil User rather than an error.
const activityUserCols = "usr.id, usr.email, usr.first_name, usr.last_name"
const activityUserJoin = "LEFT JOIN users usr ON t.user_id = usr.id"

// GetHistoryByIssueID returns an issue's history oldest-first, with the actor hydrated.
func GetHistoryByIssueID(ctx context.Context, issueID int) ([]HistoryEntry, error) {
	rows, err := DB.QueryContext(ctx,
		"SELECT t.id, t.issue_id, t.user_id, t.event, t.data, t.created_at, "+activityUserCols+
			" FROM issue_history t "+activityUserJoin+
			" WHERE t.issue_id = ? ORDER BY t.created_at ASC, t.id ASC", issueID)
	if err != nil {
		return nil, fmt.Errorf("GetHistoryByIssueID: %w", err)
	}
	defer rows.Close()

	history := []HistoryEntry{}
	for rows.Next() {
		var h HistoryEntry
		var dataJSON string
		dest, finish := activityActorScanDest()
		if err := rows.Scan(&h.ID, &h.IssueID, dest[0], &h.Event, &dataJSON, &h.CreatedAt, dest[1], dest[2], dest[3], dest[4]); err != nil {
			return nil, fmt.Errorf("GetHistoryByIssueID Scan: %w", err)
		}
		h.UserID, h.User = finish()
		if err := json.Unmarshal([]byte(dataJSON), &h.Data); err != nil {
			return nil, fmt.Errorf("GetHistoryByIssueID Unmarshal: %w", err)
		}
		history = append(history, h)
	}
	return history, rows.Err()
}

// hydrateActivityUser builds a *User from the joined nullable user columns, or nil
// when the user_id was NULL (deleted user).
func hydrateActivityUser(id sql.NullInt64, email, first, last sql.NullString) *User {
	if !id.Valid {
		return nil
	}
	return &User{
		ID:        int(id.Int64),
		Email:     email.String,
		FirstName: first.String,
		LastName:  last.String,
	}
}

// activityActorScanDest returns scan destinations for a row's own user_id column
// plus the joined activityUserCols, and a finish func that resolves them into a
// *int (own user_id, nil when NULL) and a hydrated *User (nil for a deleted user).
func activityActorScanDest() (dest []any, finish func() (*int, *User)) {
	u, uid, uEmail, uFirst, uLast := sql.NullInt64{}, sql.NullInt64{}, sql.NullString{}, sql.NullString{}, sql.NullString{}
	dest = []any{&u, &uid, &uEmail, &uFirst, &uLast}
	finish = func() (*int, *User) {
		var userID *int
		if u.Valid {
			id := int(u.Int64)
			userID = &id
		}
		return userID, hydrateActivityUser(uid, uEmail, uFirst, uLast)
	}
	return dest, finish
}

// CreateComment inserts a new user comment on an issue.
func CreateComment(ctx context.Context, c *Comment) error {
	c.CreatedAt = time.Now().UTC()
	c.UpdatedAt = c.CreatedAt
	res, err := DB.ExecContext(ctx,
		"INSERT INTO issue_comments(issue_id, user_id, body, edited, created_at, updated_at) VALUES(?, ?, ?, 0, ?, ?)",
		c.IssueID, nullableUserID(c.UserID), c.Body, c.CreatedAt, c.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("CreateComment: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return fmt.Errorf("CreateComment LastInsertId: %w", err)
	}
	c.ID = int(id)
	return nil
}

// GetCommentsByIssueID returns an issue's comments oldest-first, with the author hydrated.
func GetCommentsByIssueID(ctx context.Context, issueID int) ([]Comment, error) {
	rows, err := DB.QueryContext(ctx,
		"SELECT t.id, t.issue_id, t.user_id, t.body, t.edited, t.created_at, t.updated_at, "+activityUserCols+
			" FROM issue_comments t "+activityUserJoin+
			" WHERE t.issue_id = ? ORDER BY t.created_at ASC, t.id ASC", issueID)
	if err != nil {
		return nil, fmt.Errorf("GetCommentsByIssueID: %w", err)
	}
	defer rows.Close()

	comments := []Comment{}
	for rows.Next() {
		var c Comment
		dest, finish := activityActorScanDest()
		if err := rows.Scan(&c.ID, &c.IssueID, dest[0], &c.Body, &c.Edited, &c.CreatedAt, &c.UpdatedAt, dest[1], dest[2], dest[3], dest[4]); err != nil {
			return nil, fmt.Errorf("GetCommentsByIssueID Scan: %w", err)
		}
		c.UserID, c.User = finish()
		comments = append(comments, c)
	}
	return comments, rows.Err()
}

// GetCommentByID returns a single comment scoped to its issue, with the author
// hydrated. Returns ErrCommentNotFound when no matching row exists.
func GetCommentByID(ctx context.Context, id, issueID int) (*Comment, error) {
	row := DB.QueryRowContext(ctx,
		"SELECT t.id, t.issue_id, t.user_id, t.body, t.edited, t.created_at, t.updated_at, "+activityUserCols+
			" FROM issue_comments t "+activityUserJoin+
			" WHERE t.id = ? AND t.issue_id = ?", id, issueID)
	var c Comment
	dest, finish := activityActorScanDest()
	err := row.Scan(&c.ID, &c.IssueID, dest[0], &c.Body, &c.Edited, &c.CreatedAt, &c.UpdatedAt, dest[1], dest[2], dest[3], dest[4])
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrCommentNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("GetCommentByID: %w", err)
	}
	c.UserID, c.User = finish()
	return &c, nil
}

// UpdateComment edits a comment's body. Scope is enforced in SQL: when authorID is
// non-nil the update is restricted to that author (regular user editing own); a nil
// authorID (admin) may edit any comment. Zero rows affected → ErrCommentNotFound.
func UpdateComment(ctx context.Context, id, issueID int, authorID *int, body string) error {
	now := time.Now().UTC()
	query := "UPDATE issue_comments SET body = ?, edited = 1, updated_at = ? WHERE id = ? AND issue_id = ?"
	args := []any{body, now, id, issueID}
	if authorID != nil {
		query += " AND user_id = ?"
		args = append(args, *authorID)
	}
	res, err := DB.ExecContext(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("UpdateComment: %w", err)
	}
	return checkRowsAffected(res, "UpdateComment", ErrCommentNotFound)
}

// DeleteComment removes a comment. Scope is enforced in SQL exactly as UpdateComment.
func DeleteComment(ctx context.Context, id, issueID int, authorID *int) error {
	query := "DELETE FROM issue_comments WHERE id = ? AND issue_id = ?"
	args := []any{id, issueID}
	if authorID != nil {
		query += " AND user_id = ?"
		args = append(args, *authorID)
	}
	res, err := DB.ExecContext(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("DeleteComment: %w", err)
	}
	return checkRowsAffected(res, "DeleteComment", ErrCommentNotFound)
}

// CreateLabel inserts a new label into the database.
func CreateLabel(ctx context.Context, l *Label) error {
	res, err := DB.ExecContext(ctx, "INSERT INTO labels(name, color, project_id) VALUES(?, ?, ?)", l.Name, l.Color, l.ProjectID)
	if err != nil {
		return fmt.Errorf("CreateLabel: %w", err)
	}

	id, err := res.LastInsertId()
	if err != nil {
		return fmt.Errorf("CreateLabel LastInsertId: %w", err)
	}
	l.ID = int(id)
	return nil
}

// GetLabelsByProject retrieves all labels belonging to a specific project.
func GetLabelsByProject(ctx context.Context, projectID int) ([]Label, error) {
	rows, err := DB.QueryContext(ctx, "SELECT id, name, color, project_id FROM labels WHERE project_id = ? ORDER BY name ASC", projectID)
	if err != nil {
		return nil, fmt.Errorf("GetLabelsByProject: %w", err)
	}
	defer rows.Close()

	labels := []Label{}
	for rows.Next() {
		var l Label
		if err := rows.Scan(&l.ID, &l.Name, &l.Color, &l.ProjectID); err != nil {
			return nil, fmt.Errorf("GetLabelsByProject Scan: %w", err)
		}
		labels = append(labels, l)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("GetLabelsByProject Rows: %w", err)
	}
	return labels, nil
}

// DeleteLabel removes a label from the database, verifying it belongs to the given project.
func DeleteLabel(ctx context.Context, labelID, projectID int) error {
	res, err := DB.ExecContext(ctx, "DELETE FROM labels WHERE id = ? AND project_id = ?", labelID, projectID)
	if err != nil {
		return fmt.Errorf("DeleteLabel: %w", err)
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
		return fmt.Errorf("CreateProject: %w", err)
	}

	id, err := res.LastInsertId()
	if err != nil {
		return fmt.Errorf("CreateProject LastInsertId: %w", err)
	}
	p.ID = int(id)

	// Seed default column/status config for the new project.
	if _, err := DB.ExecContext(ctx, `INSERT OR IGNORE INTO project_status_config (project_id) VALUES (?)`, p.ID); err != nil {
		return fmt.Errorf("CreateProject seed status config: %w", err)
	}
	return nil
}

// GetAllProjects retrieves all projects from the database.
func GetAllProjects(ctx context.Context) ([]Project, error) {
	rows, err := DB.QueryContext(ctx, "SELECT id, name, description FROM projects ORDER BY id ASC")
	if err != nil {
		return nil, fmt.Errorf("GetAllProjects: %w", err)
	}
	defer rows.Close()

	projects := []Project{} // Initialize as empty slice to ensure JSON [] instead of null
	for rows.Next() {
		var p Project
		if err := rows.Scan(&p.ID, &p.Name, &p.Description); err != nil {
			return nil, fmt.Errorf("GetAllProjects Scan: %w", err)
		}
		projects = append(projects, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("GetAllProjects Rows: %w", err)
	}
	return projects, nil
}

// GetProjectByID retrieves a single project by its ID.
func GetProjectByID(ctx context.Context, id int) (*Project, error) {
	row := DB.QueryRowContext(ctx, "SELECT id, name, description FROM projects WHERE id = ?", id)

	var p Project
	err := row.Scan(&p.ID, &p.Name, &p.Description)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetProjectByID: %w", err)
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
		return fmt.Errorf("UpdateProject: %w", err)
	}

	return checkRowsAffected(res, "UpdateProject", ErrProjectNotFound)
}

// DeleteProject removes a project from the database by its ID.
func DeleteProject(ctx context.Context, id int) error {
	res, err := DB.ExecContext(ctx, "DELETE FROM projects WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("DeleteProject: %w", err)
	}

	return checkRowsAffected(res, "DeleteProject", ErrProjectNotFound)
}

// CountIssuesByProject counts how many issues reference a given project.
func CountIssuesByProject(ctx context.Context, projectID int) (int, error) {
	var count int
	err := DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM issues WHERE project_id = ?", projectID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("CountIssuesByProject: %w", err)
	}
	return count, nil
}

// issueScanner is satisfied by both *sql.Row and *sql.Rows, allowing a single
// scan implementation to be shared between single-row and multi-row queries.
type issueScanner interface {
	Scan(dest ...any) error
}

// calendarDate turns a scanned calendar-date column (deadline, release dates) into YYYY-MM-DD.
// The columns are declared DATETIME, so the driver hands the stored text over as time.Time:
// YYYY-MM-DD becomes midnight UTC, whose UTC date is the stored date.
func calendarDate(n sql.NullTime) *CalendarDate {
	if !n.Valid {
		return nil
	}
	d := CalendarDate(n.Time.UTC().Format(time.DateOnly))
	return &d
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
	var aID sql.NullInt64
	var aEmail, aFirstName, aLastName sql.NullString
	var uID sql.NullInt64
	var pID sql.NullInt64
	var pName, pDesc sql.NullString
	var rID sql.NullInt64
	var rName, rStatus sql.NullString
	var rReleaseDate sql.NullTime

	if err := s.Scan(&i.ID, &i.Title, &desc, &i.Status, &i.Position, &deadline, &plannedDatesStr, &priority, &i.CreatedAt, &i.UpdatedAt,
		&lID, &lName, &lColor,
		&cID, &uID,
		&aID, &aEmail, &aFirstName, &aLastName,
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
	i.Deadline = calendarDate(deadline)
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
	}
	if aID.Valid {
		id := int(aID.Int64)
		i.AssigneeID = &id
		i.Assignee = &User{ID: id, Email: aEmail.String, FirstName: aFirstName.String, LastName: aLastName.String}
	}
	if uID.Valid {
		id := int(uID.Int64)
		i.UpdaterID = &id
	}
	if pID.Valid {
		i.ProjectID = int(pID.Int64)
		i.Project = &Project{ID: int(pID.Int64), Name: pName.String, Description: pDesc.String}
	}
	if rID.Valid {
		id := int(rID.Int64)
		i.ReleaseID = &id
		i.Release = &Release{ID: id, Name: rName.String, Status: ReleaseStatus(rStatus.String), ReleaseDate: calendarDate(rReleaseDate)}
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
		return fmt.Errorf("CreateUser: %w", err)
	}

	id, err := res.LastInsertId()
	if err != nil {
		return fmt.Errorf("CreateUser LastInsertId: %w", err)
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
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetUserByEmail: %w", err)
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
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetUserByID: %w", err)
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
		return nil, fmt.Errorf("GetAllUsers: %w", err)
	}
	defer rows.Close()

	users := []User{}
	for rows.Next() {
		var u User
		var lastLogin sql.NullTime
		if err := rows.Scan(&u.ID, &u.Email, &u.FirstName, &u.LastName, &u.Role, &u.Active, &u.CreatedAt, &u.UpdatedAt, &lastLogin); err != nil {
			return nil, fmt.Errorf("GetAllUsers Scan: %w", err)
		}
		if lastLogin.Valid {
			u.LastLogin = &lastLogin.Time
		}
		users = append(users, u)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("GetAllUsers Rows: %w", err)
	}
	return users, nil
}

// UpdateUserLastLogin records the current time as the user's last successful login.
func UpdateUserLastLogin(ctx context.Context, userID int) error {
	_, err := DB.ExecContext(ctx, "UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?", userID)
	if err != nil {
		return fmt.Errorf("UpdateUserLastLogin: %w", err)
	}
	return nil
}

// lastActiveSysAdminCond matches a users row that is the last active sysadmin. It is
// part of the WHERE clause of every write that can take sysadmin rights away, so the
// check and the write are one atomic statement. Parameters: RoleSysAdmin twice.
const lastActiveSysAdminCond = "(role = ? AND active = 1 AND (SELECT COUNT(*) FROM users WHERE role = ? AND active = 1) <= 1)"

// userWriteErr explains a guarded user write that changed no row: the user is gone
// (ErrUserNotFound) or is the last active sysadmin (ErrLastSysAdmin).
func userWriteErr(res sql.Result, caller string, userExists func() (bool, error)) error {
	err := checkRowsAffected(res, caller, ErrUserNotFound)
	if !errors.Is(err, ErrUserNotFound) {
		return err
	}
	exists, err := userExists()
	if err != nil {
		return err
	}
	if exists {
		return ErrLastSysAdmin
	}
	return ErrUserNotFound
}

// UpdateUser updates an existing user in the database. Returns ErrLastSysAdmin if
// the update would demote or deactivate the last active sysadmin.
func UpdateUser(ctx context.Context, u *User) error {
	u.UpdatedAt = time.Now().UTC()
	removesSysAdmin := u.Role != RoleSysAdmin || !u.Active
	res, err := DB.ExecContext(ctx,
		"UPDATE users SET email = ?, first_name = ?, last_name = ?, password_hash = ?, role = ?, active = ?, updated_at = ? WHERE id = ? AND NOT (? AND "+lastActiveSysAdminCond+")",
		u.Email, u.FirstName, u.LastName, u.PasswordHash, u.Role, u.Active, u.UpdatedAt, u.ID, removesSysAdmin, RoleSysAdmin, RoleSysAdmin,
	)
	if err != nil {
		if strings.Contains(err.Error(), errUniqueConstraintFailed) {
			return ErrDuplicateEmail
		}
		return fmt.Errorf("UpdateUser: %w", err)
	}

	return userWriteErr(res, "UpdateUser", func() (bool, error) { return UserExists(ctx, u.ID) })
}

// DeleteUser removes a user in one transaction. Issues assigned to the user are
// unassigned first, each with an EventUpdated history entry authored by actorID
// (assignee changed from "<userName> (user deleted)", the same JSON shape as a
// ChangeData) and a new updated_at so open editors get a conflict. All other user
// references are cleared by the schema (ON DELETE SET NULL / CASCADE).
// Returns the number of unassigned issues, or ErrLastSysAdmin for the last active
// sysadmin.
func DeleteUser(ctx context.Context, id, actorID int, userName string) (int64, error) {
	tx, err := DB.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("DeleteUser BeginTx: %w", err)
	}
	// Undoes all writes if the function returns before Commit.
	defer func() { _ = tx.Rollback() }()

	actor := nullableUserID(&actorID)
	if _, err := tx.ExecContext(ctx,
		"INSERT INTO issue_history(issue_id, user_id, event, data) SELECT id, ?, ?, json_object('field', 'assignee', 'from', ?) FROM issues WHERE assignee_id = ?",
		actor, EventUpdated, userName+" (user deleted)", id,
	); err != nil {
		return 0, fmt.Errorf("DeleteUser history: %w", err)
	}

	unassign, err := tx.ExecContext(ctx,
		"UPDATE issues SET assignee_id = NULL, updated_by = ?, updated_at = ? WHERE assignee_id = ?",
		actor, time.Now().UTC(), id,
	)
	if err != nil {
		return 0, fmt.Errorf("DeleteUser unassign: %w", err)
	}
	unassigned, err := unassign.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("DeleteUser unassign: %w", err)
	}

	res, err := tx.ExecContext(ctx, "DELETE FROM users WHERE id = ? AND NOT "+lastActiveSysAdminCond, id, RoleSysAdmin, RoleSysAdmin)
	if err != nil {
		return 0, fmt.Errorf("DeleteUser: %w", err)
	}
	userExists := func() (bool, error) {
		var count int
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM users WHERE id = ?", id).Scan(&count); err != nil {
			return false, fmt.Errorf("DeleteUser existence check: %w", err)
		}
		return count > 0, nil
	}
	if err := userWriteErr(res, "DeleteUser", userExists); err != nil {
		return 0, err
	}

	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("DeleteUser Commit: %w", err)
	}
	return unassigned, nil
}

// CountUsers returns the total number of users in the database.
func CountUsers(ctx context.Context) (int, error) {
	var count int
	err := DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM users").Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("CountUsers: %w", err)
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
		return fmt.Errorf("CreateSession: %w", err)
	}

	id, err := res.LastInsertId()
	if err != nil {
		return fmt.Errorf("CreateSession LastInsertId: %w", err)
	}
	s.ID = int(id)
	return nil
}

// GetSessionByID retrieves a session by its integer primary key.
func GetSessionByID(ctx context.Context, id int) (*Session, error) {
	row := DB.QueryRowContext(ctx, "SELECT id, user_id, session_token, token_hash, expires_at, created_at FROM sessions WHERE id = ?", id)

	var s Session
	err := row.Scan(&s.ID, &s.UserID, &s.SessionToken, &s.TokenHash, &s.ExpiresAt, &s.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetSessionByID: %w", err)
	}
	return &s, nil
}

// GetSessionByToken retrieves a session by its unguessable session_token lookup key.
func GetSessionByToken(ctx context.Context, token string) (*Session, error) {
	row := DB.QueryRowContext(ctx, "SELECT id, user_id, session_token, token_hash, expires_at, created_at FROM sessions WHERE session_token = ?", token)

	var s Session
	err := row.Scan(&s.ID, &s.UserID, &s.SessionToken, &s.TokenHash, &s.ExpiresAt, &s.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetSessionByToken: %w", err)
	}
	return &s, nil
}

// UpdateSession updates the token hash and expiration of an existing session (Rotation).
func UpdateSession(ctx context.Context, s *Session) error {
	res, err := DB.ExecContext(ctx, "UPDATE sessions SET token_hash = ?, expires_at = ? WHERE id = ?", s.TokenHash, s.ExpiresAt, s.ID)
	if err != nil {
		return fmt.Errorf("UpdateSession: %w", err)
	}

	return checkRowsAffected(res, "UpdateSession", ErrSessionNotFound)
}

// DeleteSession removes a session from the database by its ID.
func DeleteSession(ctx context.Context, id int) error {
	res, err := DB.ExecContext(ctx, "DELETE FROM sessions WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("DeleteSession: %w", err)
	}

	return checkRowsAffected(res, "DeleteSession", ErrSessionNotFound)
}

// DeleteSessionsByUserID removes all sessions for a specific user.
func DeleteSessionsByUserID(ctx context.Context, userID int) error {
	_, err := DB.ExecContext(ctx, "DELETE FROM sessions WHERE user_id = ?", userID)
	if err != nil {
		return fmt.Errorf("DeleteSessionsByUserID: %w", err)
	}
	return nil
}

// DeleteExpiredSessions removes all sessions that have expired from the database.
func DeleteExpiredSessions(ctx context.Context) (int64, error) {
	// Use time.Now() so the driver formats it consistently with how sessions were inserted
	res, err := DB.ExecContext(ctx, "DELETE FROM sessions WHERE expires_at < ?", time.Now().UTC())
	if err != nil {
		return 0, fmt.Errorf("DeleteExpiredSessions: %w", err)
	}

	rowsAffected, err := res.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("DeleteExpiredSessions RowsAffected: %w", err)
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
		def := defaultStatusConfig(projectID)
		return &def, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetStatusConfig: %w", err)
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
		return fmt.Errorf("CreateRelease: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return fmt.Errorf("CreateRelease LastInsertId: %w", err)
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
		return nil, fmt.Errorf("GetReleasesByProject: %w", err)
	}
	defer rows.Close()

	releases := []Release{}
	for rows.Next() {
		r, err := scanRelease(rows)
		if err != nil {
			return nil, fmt.Errorf("GetReleasesByProject Scan: %w", err)
		}
		releases = append(releases, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("GetReleasesByProject Rows: %w", err)
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
	r.StartDate = calendarDate(f.startDate)
	r.ReleaseDate = calendarDate(f.releaseDate)
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
		return nil, fmt.Errorf("GetReleaseByID: %w", err)
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
		return fmt.Errorf("UpdateRelease: %w", err)
	}
	return checkRowsAffected(res, "UpdateRelease", ErrReleaseNotFound)
}

// DeleteRelease removes a release. The FK ON DELETE SET NULL clears release_id on issues.
func DeleteRelease(ctx context.Context, id int) error {
	res, err := DB.ExecContext(ctx, `DELETE FROM releases WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("DeleteRelease: %w", err)
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
		return fmt.Errorf("ReopenRelease: %w", err)
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
		return fmt.Errorf("TriggerRelease: %w", err)
	}
	if err := checkRowsAffected(res, "TriggerRelease", ErrReleaseNotFound); err != nil {
		return err
	}
	if archiveDone {
		if _, err := DB.ExecContext(ctx,
			`UPDATE issues SET status = ?, updated_at = ? WHERE release_id = ? AND status = ?`,
			StatusArchive, now, id, StatusDone,
		); err != nil {
			return fmt.Errorf("TriggerRelease archive done issues: %w", err)
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
		return nil, fmt.Errorf("GetReleaseByIDInProject: %w", err)
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
		return fmt.Errorf("UpsertStatusConfig: %w", err)
	}
	return nil
}
