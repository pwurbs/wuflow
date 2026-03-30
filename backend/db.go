package backend

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
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

// ErrDuplicateProjectName is returned when a project with the same name already exists.
var ErrDuplicateProjectName = errors.New("project name already exists")

// errUniqueConstraintFailed is the SQLite error text for UNIQUE constraint violations.
const errUniqueConstraintFailed = "UNIQUE constraint failed"

// InitDB initializes the database connection and creates tables if they don't exist.
func InitDB(dataSourceName string) error {
	if _, err := os.Stat(dataSourceName); os.IsNotExist(err) {
		slog.Info("Creating new database", "path", dataSourceName)
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
		slog.Error("Failed to open database", "error", err)
		return err
	}

	if err = DB.Ping(); err != nil {
		slog.Error("Failed to ping database", "error", err)
		return err
	}

	if _, err := DB.Exec("PRAGMA journal_mode=WAL"); err != nil {
		slog.Error("Failed to set WAL mode", "error", err)
		return err
	}

	if err := createTables(); err != nil {
		return err
	}

	return nil
}

// createTables creates the necessary tables for the application.
func createTables() error {
	// Projects table must be created before issues if we want to reference it
	createProjectsTable := `
	CREATE TABLE IF NOT EXISTS projects (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE,
		description TEXT NOT NULL DEFAULT ''
	);`
	if _, err := DB.Exec(createProjectsTable); err != nil {
		slog.Error("Failed to create projects table", "error", err)
		return err
	}

	// Seed the default project (id=1)
	if _, err := DB.Exec(`INSERT OR IGNORE INTO projects(id, name, description) VALUES(1, 'default', 'Default project')`); err != nil {
		slog.Error("Failed to seed default project", "error", err)
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
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE SET NULL,
		FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE SET NULL,
		FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL,
		FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
		FOREIGN KEY (project_id) REFERENCES projects(id)
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

	if _, err := DB.Exec(createIssuesTable); err != nil {
		slog.Error("Failed to create issues table", "error", err)
		return err
	}

	if _, err := DB.Exec(createTasksTable); err != nil {
		slog.Error("Failed to create tasks table", "error", err)
		return err
	}

	createLabelsTable := `
	CREATE TABLE IF NOT EXISTS labels (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		color TEXT NOT NULL
	);`
	if _, err := DB.Exec(createLabelsTable); err != nil {
		slog.Error("Failed to create labels table", "error", err)
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
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);`
	if _, err := DB.Exec(createUsersTable); err != nil {
		slog.Error("Failed to create users table", "error", err)
		return err
	}

	createSessionsTable := `
	CREATE TABLE IF NOT EXISTS sessions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		token_hash TEXT NOT NULL,
		expires_at DATETIME NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	);`
	if _, err := DB.Exec(createSessionsTable); err != nil {
		slog.Error("Failed to create sessions table", "error", err)
		return err
	}
	// Create index on user_id to speed up session revocation by user (e.g., logout all devices)
	if _, err := DB.Exec("CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);"); err != nil {
		slog.Error("Failed to create index on sessions(user_id)", "error", err)
		return err
	}

	// Migration Code, can be removed in a later version (TODO)
	// Add project_id column to issues if it doesn't exist (migration for existing DBs)
	// SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we check column existence first.
	// NOTE: We cannot add a REFERENCES column with a non-NULL default value in SQLite
	// when foreign keys are enabled. For existing databases, we add the column without
	// the DB-enforced foreign key constraint to avoid the migration error.
	var colCount int
	if err := DB.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('issues') WHERE name='project_id'`).Scan(&colCount); err != nil {
		slog.Error("Failed to check for project_id column", "error", err)
		return err
	}
	if colCount == 0 {
		if _, err := DB.Exec(`ALTER TABLE issues ADD COLUMN project_id INTEGER NOT NULL DEFAULT 1`); err != nil {
			slog.Error("Failed to add project_id column to issues", "error", err)
			return err
		}
		slog.Info("Migrated issues table: added project_id column")
	}

	// Migration: promote the first user (id=1) from admin to sysadmin. Remove in later version (TODO)
	// The sysadmin role was introduced to separate system administration (users, projects,
	// labels) from issue-level admin operations. Existing installations have user id=1 as
	// the initial admin; we upgrade them automatically so they retain full access.
	if result, err := DB.Exec(`UPDATE users SET role = 'sysadmin' WHERE id = 1 AND role = 'admin'`); err != nil {
		slog.Error("Failed to migrate initial admin to sysadmin", "error", err)
		return err
	} else if n, _ := result.RowsAffected(); n > 0 {
		slog.Info("Migrated initial admin user to sysadmin role", "user_id", 1)
	}

	return nil
}

// UserExistsAndActive checks if a user exists and is active.
func UserExistsAndActive(id int) (bool, error) {
	var count int
	err := DB.QueryRow("SELECT COUNT(*) FROM users WHERE id = ? AND active = 1", id).Scan(&count)
	if err != nil {
		slog.Error("Database Error: UserExistsAndActive", "id", id, "error", err)
		return false, err
	}
	return count > 0, nil
}

// UserExists checks if a user exists, regardless of active status.
func UserExists(id int) (bool, error) {
	var count int
	err := DB.QueryRow("SELECT COUNT(*) FROM users WHERE id = ?", id).Scan(&count)
	if err != nil {
		slog.Error("Database Error: UserExists", "id", id, "error", err)
		return false, err
	}
	return count > 0, nil
}

// LabelExists checks if a label exists.
func LabelExists(id int) (bool, error) {
	var count int
	err := DB.QueryRow("SELECT COUNT(*) FROM labels WHERE id = ?", id).Scan(&count)
	if err != nil {
		slog.Error("Database Error: LabelExists", "id", id, "error", err)
		return false, err
	}
	return count > 0, nil
}

// ProjectExists checks if a project exists.
func ProjectExists(id int) (bool, error) {
	var count int
	err := DB.QueryRow("SELECT COUNT(*) FROM projects WHERE id = ?", id).Scan(&count)
	if err != nil {
		slog.Error("Database Error: ProjectExists", "id", id, "error", err)
		return false, err
	}
	return count > 0, nil
}

// Helper functions for DB operations

// CreateIssue inserts a new issue into the database.
func CreateIssue(i *Issue) error {
	if i.Priority == "" {
		i.Priority = PriorityNormal
	}
	stmt, err := DB.Prepare("INSERT INTO issues(title, description, status, position, deadline, planned_dates, priority, label_id, creator_id, assignee_id, updated_by, project_id, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
	if err != nil {
		slog.Error("Database Error: CreateIssue Prepare", "error", err)
		return err
	}
	defer stmt.Close()

	// Get max position for the status to append to the end
	var maxPos sql.NullInt64
	err = DB.QueryRow("SELECT MAX(position) FROM issues WHERE status = ?", i.Status).Scan(&maxPos)
	if err != nil && err != sql.ErrNoRows {
		slog.Error("Database Error: CreateIssue MaxPos", "error", err)
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
			slog.Error("Database Error: CreateIssue Marshal Dates", "error", err)
			return err
		}
		plannedDatesJSON = string(b)
	}

	res, err := stmt.Exec(i.Title, i.Description, i.Status, i.Position, i.Deadline, plannedDatesJSON, i.Priority, labelID, creatorID, i.AssigneeID, updaterID, i.ProjectID, i.UpdatedAt)
	if err != nil {
		slog.Error("Database Error: CreateIssue Exec", "error", err)
		return err
	}

	id, err := res.LastInsertId()
	if err != nil {
		slog.Error("Database Error: CreateIssue LastInsertId", "error", err)
		return err
	}
	i.ID = int(id)
	return nil
}

// GetActiveIssuesByProject retrieves all active (non-archived) issues for a specific project.
func GetActiveIssuesByProject(projectID int) ([]Issue, error) {
	rows, err := DB.Query(`
		SELECT i.id, i.title, i.description, i.status, i.position, i.deadline, i.planned_dates, i.priority, i.created_at, i.updated_at,
		       l.id, l.name, l.color,
		       c.id, c.email, c.first_name, c.last_name,
		       a.id, a.email, a.first_name, a.last_name,
		       u.id, u.email, u.first_name, u.last_name,
		       p.id, p.name, p.description
		FROM issues i
		LEFT JOIN labels l ON i.label_id = l.id
		LEFT JOIN users c ON i.creator_id = c.id
		LEFT JOIN users a ON i.assignee_id = a.id
		LEFT JOIN users u ON i.updated_by = u.id
		LEFT JOIN projects p ON i.project_id = p.id
		WHERE i.status != ? AND i.project_id = ?
		ORDER BY i.position ASC`, StatusArchive, projectID)
	if err != nil {
		slog.Error("Database Error: GetActiveIssuesByProject", "error", err)
		return nil, err
	}
	defer rows.Close()

	var issues []Issue
	for rows.Next() {
		i, err := scanIssue(rows)
		if err != nil {
			slog.Error("Database Error: GetActiveIssuesByProject Scan", "error", err)
			return nil, err
		}
		issues = append(issues, i)
	}
	if err := rows.Err(); err != nil {
		slog.Error("Database Error: GetActiveIssuesByProject Rows", "error", err)
		return nil, err
	}

	tasksByIssue, err := GetAllTasks()
	if err != nil {
		slog.Error("Database Error: GetActiveIssuesByProject GetAllTasks", "error", err)
		return nil, err
	}
	for idx := range issues {
		issues[idx].Tasks = tasksByIssue[issues[idx].ID]
	}

	return issues, nil
}

// GetArchivedIssuesByProject retrieves all archived issues for a specific project.
func GetArchivedIssuesByProject(projectID int) ([]Issue, error) {
	rows, err := DB.Query(`
		SELECT i.id, i.title, i.description, i.status, i.position, i.deadline, i.planned_dates, i.priority, i.created_at, i.updated_at,
		       l.id, l.name, l.color,
		       c.id, c.email, c.first_name, c.last_name,
		       a.id, a.email, a.first_name, a.last_name,
		       u.id, u.email, u.first_name, u.last_name,
		       p.id, p.name, p.description
		FROM issues i
		LEFT JOIN labels l ON i.label_id = l.id
		LEFT JOIN users c ON i.creator_id = c.id
		LEFT JOIN users a ON i.assignee_id = a.id
		LEFT JOIN users u ON i.updated_by = u.id
		LEFT JOIN projects p ON i.project_id = p.id
		WHERE i.status = ? AND i.project_id = ?
		ORDER BY i.position ASC`, StatusArchive, projectID)
	if err != nil {
		slog.Error("Database Error: GetArchivedIssuesByProject", "error", err)
		return nil, err
	}
	defer rows.Close()

	var issues []Issue
	for rows.Next() {
		i, err := scanIssue(rows)
		if err != nil {
			slog.Error("Database Error: GetArchivedIssuesByProject Scan", "error", err)
			return nil, err
		}
		issues = append(issues, i)
	}
	if err := rows.Err(); err != nil {
		slog.Error("Database Error: GetArchivedIssuesByProject Rows", "error", err)
		return nil, err
	}

	tasksByIssue, err := GetAllTasks()
	if err != nil {
		slog.Error("Database Error: GetArchivedIssuesByProject GetAllTasks", "error", err)
		return nil, err
	}
	for idx := range issues {
		issues[idx].Tasks = tasksByIssue[issues[idx].ID]
	}

	return issues, nil
}

// GetIssueByID retrieves a single issue by ID, including its associated tasks.
func GetIssueByID(id int) (*Issue, error) {
	row := DB.QueryRow(`
		SELECT i.id, i.title, i.description, i.status, i.position, i.deadline, i.planned_dates, i.priority, i.created_at, i.updated_at, 
		       l.id, l.name, l.color,
		       c.id, c.email, c.first_name, c.last_name,
		       a.id, a.email, a.first_name, a.last_name,
		       u.id, u.email, u.first_name, u.last_name,
		       p.id, p.name, p.description
		FROM issues i 
		LEFT JOIN labels l ON i.label_id = l.id 
		LEFT JOIN users c ON i.creator_id = c.id
		LEFT JOIN users a ON i.assignee_id = a.id
		LEFT JOIN users u ON i.updated_by = u.id
		LEFT JOIN projects p ON i.project_id = p.id
		WHERE i.id = ?`, id)

	var issue Issue
	var desc sql.NullString
	var deadline sql.NullTime
	var plannedDatesStr sql.NullString
	var lID sql.NullInt64
	var lName sql.NullString
	var lColor sql.NullString
	var priority sql.NullString

	// Creator fields
	var cID sql.NullInt64
	var cEmail sql.NullString
	var cFirstName sql.NullString
	var cLastName sql.NullString

	// Assignee fields
	var aID sql.NullInt64
	var aEmail sql.NullString
	var aFirstName sql.NullString
	var aLastName sql.NullString

	// Updater fields
	var uID sql.NullInt64
	var uEmail sql.NullString
	var uFirstName sql.NullString
	var uLastName sql.NullString

	// Project fields
	var pID sql.NullInt64
	var pName sql.NullString
	var pDesc sql.NullString

	err := row.Scan(&issue.ID, &issue.Title, &desc, &issue.Status, &issue.Position, &deadline, &plannedDatesStr, &priority, &issue.CreatedAt, &issue.UpdatedAt,
		&lID, &lName, &lColor,
		&cID, &cEmail, &cFirstName, &cLastName,
		&aID, &aEmail, &aFirstName, &aLastName,
		&uID, &uEmail, &uFirstName, &uLastName,
		&pID, &pName, &pDesc)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		slog.Error("Database Error: GetIssueByID", "error", err)
		return nil, err
	}

	issue.Description = desc.String

	if priority.Valid {
		issue.Priority = IssuePriority(priority.String)
	} else {
		issue.Priority = PriorityNormal
	}
	if deadline.Valid {
		issue.Deadline = &deadline.Time
	}
	if plannedDatesStr.Valid {
		if err := json.Unmarshal([]byte(plannedDatesStr.String), &issue.PlannedDates); err != nil {
			slog.Error("Database Error: GetIssueByID parsing planned_dates", "id", issue.ID, "error", err)
		}
	}
	if lID.Valid {
		issue.Label = &Label{
			ID:    int(lID.Int64),
			Name:  lName.String,
			Color: lColor.String,
		}
	}

	if cID.Valid {
		issue.CreatorID = int(cID.Int64)
		issue.Creator = &User{
			ID:        int(cID.Int64),
			Email:     cEmail.String,
			FirstName: cFirstName.String,
			LastName:  cLastName.String,
		}
	}

	if aID.Valid {
		id := int(aID.Int64)
		issue.AssigneeID = &id
		issue.Assignee = &User{
			ID:        id,
			Email:     aEmail.String,
			FirstName: aFirstName.String,
			LastName:  aLastName.String,
		}
	}

	if uID.Valid {
		id := int(uID.Int64)
		issue.UpdaterID = &id
		issue.Updater = &User{
			ID:        id,
			Email:     uEmail.String,
			FirstName: uFirstName.String,
			LastName:  uLastName.String,
		}
	}

	if pID.Valid {
		issue.ProjectID = int(pID.Int64)
		issue.Project = &Project{
			ID:          int(pID.Int64),
			Name:        pName.String,
			Description: pDesc.String,
		}
	}

	tasks, err := GetTasksByIssueID(issue.ID)
	if err != nil {
		slog.Error("Database Error: GetIssueByID GetTasksByIssueID", "error", err)
		return nil, err
	}
	issue.Tasks = tasks

	return &issue, nil
}

// UpdateIssue updates an existing issue in the database.
func UpdateIssue(i *Issue) error {

	stmt, err := DB.Prepare("UPDATE issues SET title = ?, description = ?, status = ?, position = ?, deadline = ?, planned_dates = ?, priority = ?, label_id = ?, assignee_id = ?, updated_by = ?, project_id = ?, updated_at = ? WHERE id = ?")
	if err != nil {
		slog.Error("Database Error: UpdateIssue Prepare", "error", err)
		return err
	}
	defer stmt.Close()

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
			slog.Error("Database Error: UpdateIssue Marshal Dates", "error", err)
			return err
		}
		plannedDatesJSON = string(b)
	}

	var updaterID *int
	if i.UpdaterID != nil && *i.UpdaterID != 0 {
		updaterID = i.UpdaterID
	}

	res, err := stmt.Exec(i.Title, i.Description, i.Status, i.Position, i.Deadline, plannedDatesJSON, i.Priority, labelID, i.AssigneeID, updaterID, i.ProjectID, i.UpdatedAt, i.ID)
	if err != nil {
		slog.Error("Database Error: UpdateIssue Exec", "error", err)
		return err
	}

	rowsAffected, err := res.RowsAffected()
	if err != nil {
		slog.Error("Database Error: UpdateIssue RowsAffected", "error", err)
		return err
	}
	if rowsAffected == 0 {
		return ErrIssueNotFound
	}
	return nil
}

// DeleteIssue removes an issue from the database by its ID.
func DeleteIssue(id int) error {
	res, err := DB.Exec("DELETE FROM issues WHERE id = ?", id)
	if err != nil {
		slog.Error("Database Error: DeleteIssue", "error", err)
		return err
	}

	rowsAffected, err := res.RowsAffected()
	if err != nil {
		slog.Error("Database Error: DeleteIssue RowsAffected", "error", err)
		return err
	}
	if rowsAffected == 0 {
		return ErrIssueNotFound
	}
	return nil
}

// CreateTask inserts a new task into the database.
func CreateTask(t *Task) error {
	stmt, err := DB.Prepare("INSERT INTO tasks(issue_id, title, done, position, deadline, updated_at) VALUES(?, ?, ?, ?, ?, ?)")
	if err != nil {
		slog.Error("Database Error: CreateTask Prepare", "error", err)
		return err
	}
	defer stmt.Close()

	// Check if issue exists
	var exists bool
	err = DB.QueryRow("SELECT EXISTS(SELECT 1 FROM issues WHERE id = ?)", t.IssueID).Scan(&exists)
	if err != nil {
		slog.Error("Database Error: CreateTask CheckIssue", "error", err)
		return err
	}
	if !exists {
		return ErrIssueNotFound
	}

	// Get max position
	var maxPos sql.NullInt64
	err = DB.QueryRow("SELECT MAX(position) FROM tasks WHERE issue_id = ?", t.IssueID).Scan(&maxPos)
	if err != nil && err != sql.ErrNoRows {
		slog.Error("Database Error: CreateTask MaxPos", "error", err)
		return err
	}
	t.Position = int(maxPos.Int64) + 1
	t.UpdatedAt = time.Now().UTC()

	res, err := stmt.Exec(t.IssueID, t.Title, t.Done, t.Position, t.Deadline, t.UpdatedAt)
	if err != nil {
		slog.Error("Database Error: CreateTask Exec", "error", err)
		return err
	}

	id, err := res.LastInsertId()
	if err != nil {
		slog.Error("Database Error: CreateTask LastInsertId", "error", err)
		return err
	}
	t.ID = int(id)
	return nil
}

// GetAllTasks retrieves all tasks from the database, grouped by issue_id.
// This eliminates the N+1 query problem when fetching issues with their tasks.
func GetAllTasks() (map[int][]Task, error) {
	rows, err := DB.Query("SELECT id, issue_id, title, done, position, deadline, created_at, updated_at FROM tasks ORDER BY issue_id, position ASC")
	if err != nil {
		slog.Error("Database Error: GetAllTasks", "error", err)
		return nil, err
	}
	defer rows.Close()

	result := make(map[int][]Task)
	for rows.Next() {
		var t Task
		var deadline sql.NullTime
		if err := rows.Scan(&t.ID, &t.IssueID, &t.Title, &t.Done, &t.Position, &deadline, &t.CreatedAt, &t.UpdatedAt); err != nil {
			slog.Error("Database Error: GetAllTasks Scan", "error", err)
			return nil, err
		}
		if deadline.Valid {
			t.Deadline = &deadline.Time
		}
		result[t.IssueID] = append(result[t.IssueID], t)
	}
	if err := rows.Err(); err != nil {
		slog.Error("Database Error: GetAllTasks Rows", "error", err)
		return nil, err
	}
	return result, nil
}

// GetTasksByIssueID retrieves all tasks associated with a specific issue.
func GetTasksByIssueID(issueID int) ([]Task, error) {
	rows, err := DB.Query("SELECT id, issue_id, title, done, position, deadline, created_at, updated_at FROM tasks WHERE issue_id = ? ORDER BY position ASC", issueID)
	if err != nil {
		slog.Error("Database Error: GetTasksByIssueID", "error", err)
		return nil, err
	}
	defer rows.Close()

	var tasks []Task
	for rows.Next() {
		var t Task
		var deadline sql.NullTime
		if err := rows.Scan(&t.ID, &t.IssueID, &t.Title, &t.Done, &t.Position, &deadline, &t.CreatedAt, &t.UpdatedAt); err != nil {
			slog.Error("Database Error: GetTasksByIssueID Scan", "error", err)
			return nil, err
		}
		if deadline.Valid {
			t.Deadline = &deadline.Time
		}
		tasks = append(tasks, t)
	}
	if err := rows.Err(); err != nil {
		slog.Error("Database Error: GetTasksByIssueID Rows", "error", err)
		return nil, err
	}
	return tasks, nil
}

// GetTaskByID retrieves a single task by its ID.
func GetTaskByID(id int) (*Task, error) {
	row := DB.QueryRow("SELECT id, issue_id, title, done, position, deadline, created_at, updated_at FROM tasks WHERE id = ?", id)

	var t Task
	var deadline sql.NullTime
	err := row.Scan(&t.ID, &t.IssueID, &t.Title, &t.Done, &t.Position, &deadline, &t.CreatedAt, &t.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		slog.Error("Database Error: GetTaskByID", "error", err)
		return nil, err
	}
	if deadline.Valid {
		t.Deadline = &deadline.Time
	}
	return &t, nil
}

// UpdateTask updates an existing task in the database.
func UpdateTask(t *Task) error {
	stmt, err := DB.Prepare("UPDATE tasks SET title = ?, done = ?, position = ?, deadline = ?, updated_at = ? WHERE id = ?")
	if err != nil {
		slog.Error("Database Error: UpdateTask Prepare", "error", err)
		return err
	}
	defer stmt.Close()

	t.UpdatedAt = time.Now().UTC()
	res, err := stmt.Exec(t.Title, t.Done, t.Position, t.Deadline, t.UpdatedAt, t.ID)
	if err != nil {
		slog.Error("Database Error: UpdateTask Exec", "error", err)
		return err
	}

	rowsAffected, err := res.RowsAffected()
	if err != nil {
		slog.Error("Database Error: UpdateTask RowsAffected", "error", err)
		return err
	}
	if rowsAffected == 0 {
		return ErrTaskNotFound
	}
	return nil
}

// DeleteTask removes a task from the database by its ID.
func DeleteTask(id int) error {
	res, err := DB.Exec("DELETE FROM tasks WHERE id = ?", id)
	if err != nil {
		slog.Error("Database Error: DeleteTask", "error", err)
		return err
	}

	rowsAffected, err := res.RowsAffected()
	if err != nil {
		slog.Error("Database Error: DeleteTask RowsAffected", "error", err)
		return err
	}
	if rowsAffected == 0 {
		return ErrTaskNotFound
	}
	return nil
}

// CreateLabel inserts a new label into the database.
func CreateLabel(l *Label) error {
	stmt, err := DB.Prepare("INSERT INTO labels(name, color) VALUES(?, ?)")
	if err != nil {
		slog.Error("Database Error: CreateLabel Prepare", "error", err)
		return err
	}
	defer stmt.Close()

	res, err := stmt.Exec(l.Name, l.Color)
	if err != nil {
		slog.Error("Database Error: CreateLabel Exec", "error", err)
		return err
	}

	id, err := res.LastInsertId()
	if err != nil {
		slog.Error("Database Error: CreateLabel LastInsertId", "error", err)
		return err
	}
	l.ID = int(id)
	return nil
}

// GetAllLabels retrieves all labels from the database.
func GetAllLabels() ([]Label, error) {
	rows, err := DB.Query("SELECT id, name, color FROM labels ORDER BY name ASC")
	if err != nil {
		slog.Error("Database Error: GetAllLabels", "error", err)
		return nil, err
	}
	defer rows.Close()

	labels := []Label{} // Initialize as empty slice to ensure JSON [] instead of null
	for rows.Next() {
		var l Label
		if err := rows.Scan(&l.ID, &l.Name, &l.Color); err != nil {
			slog.Error("Database Error: GetAllLabels Scan", "error", err)
			return nil, err
		}
		labels = append(labels, l)
	}
	if err := rows.Err(); err != nil {
		slog.Error("Database Error: GetAllLabels Rows", "error", err)
		return nil, err
	}
	return labels, nil
}

// DeleteLabel removes a label from the database by its ID.
func DeleteLabel(id int) error {
	res, err := DB.Exec("DELETE FROM labels WHERE id = ?", id)
	if err != nil {
		slog.Error("Database Error: DeleteLabel", "error", err)
		return err
	}

	rowsAffected, err := res.RowsAffected()
	if err != nil {
		slog.Error("Database Error: DeleteLabel RowsAffected", "error", err)
		return err
	}
	if rowsAffected == 0 {
		return ErrLabelNotFound
	}
	return nil
}

// -----------------------------------------------------------------------------
// Project Management
// -----------------------------------------------------------------------------

// CreateProject inserts a new project into the database.
func CreateProject(p *Project) error {
	stmt, err := DB.Prepare("INSERT INTO projects(name, description) VALUES(?, ?)")
	if err != nil {
		slog.Error("Database Error: CreateProject Prepare", "error", err)
		return err
	}
	defer stmt.Close()

	res, err := stmt.Exec(p.Name, p.Description)
	if err != nil {
		if strings.Contains(err.Error(), errUniqueConstraintFailed) {
			return ErrDuplicateProjectName
		}
		slog.Error("Database Error: CreateProject Exec", "error", err)
		return err
	}

	id, err := res.LastInsertId()
	if err != nil {
		slog.Error("Database Error: CreateProject LastInsertId", "error", err)
		return err
	}
	p.ID = int(id)
	return nil
}

// GetAllProjects retrieves all projects from the database.
func GetAllProjects() ([]Project, error) {
	rows, err := DB.Query("SELECT id, name, description FROM projects ORDER BY id ASC")
	if err != nil {
		slog.Error("Database Error: GetAllProjects", "error", err)
		return nil, err
	}
	defer rows.Close()

	projects := []Project{} // Initialize as empty slice to ensure JSON [] instead of null
	for rows.Next() {
		var p Project
		if err := rows.Scan(&p.ID, &p.Name, &p.Description); err != nil {
			slog.Error("Database Error: GetAllProjects Scan", "error", err)
			return nil, err
		}
		projects = append(projects, p)
	}
	if err := rows.Err(); err != nil {
		slog.Error("Database Error: GetAllProjects Rows", "error", err)
		return nil, err
	}
	return projects, nil
}

// GetProjectByID retrieves a single project by its ID.
func GetProjectByID(id int) (*Project, error) {
	row := DB.QueryRow("SELECT id, name, description FROM projects WHERE id = ?", id)

	var p Project
	err := row.Scan(&p.ID, &p.Name, &p.Description)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		slog.Error("Database Error: GetProjectByID", "error", err)
		return nil, err
	}
	return &p, nil
}

// UpdateProject updates an existing project in the database.
func UpdateProject(p *Project) error {
	stmt, err := DB.Prepare("UPDATE projects SET name = ?, description = ? WHERE id = ?")
	if err != nil {
		slog.Error("Database Error: UpdateProject Prepare", "error", err)
		return err
	}
	defer stmt.Close()

	res, err := stmt.Exec(p.Name, p.Description, p.ID)
	if err != nil {
		if strings.Contains(err.Error(), errUniqueConstraintFailed) {
			return ErrDuplicateProjectName
		}
		slog.Error("Database Error: UpdateProject Exec", "error", err)
		return err
	}

	rowsAffected, err := res.RowsAffected()
	if err != nil {
		slog.Error("Database Error: UpdateProject RowsAffected", "error", err)
		return err
	}
	if rowsAffected == 0 {
		return ErrProjectNotFound
	}
	return nil
}

// DeleteProject removes a project from the database by its ID.
func DeleteProject(id int) error {
	res, err := DB.Exec("DELETE FROM projects WHERE id = ?", id)
	if err != nil {
		slog.Error("Database Error: DeleteProject", "error", err)
		return err
	}

	rowsAffected, err := res.RowsAffected()
	if err != nil {
		slog.Error("Database Error: DeleteProject RowsAffected", "error", err)
		return err
	}
	if rowsAffected == 0 {
		return ErrProjectNotFound
	}
	return nil
}

// CountIssuesByProject counts how many issues reference a given project.
func CountIssuesByProject(projectID int) (int, error) {
	var count int
	err := DB.QueryRow("SELECT COUNT(*) FROM issues WHERE project_id = ?", projectID).Scan(&count)
	if err != nil {
		slog.Error("Database Error: CountIssuesByProject", "project_id", projectID, "error", err)
		return 0, err
	}
	return count, nil
}

func scanIssue(rows *sql.Rows) (Issue, error) {
	var i Issue
	var desc sql.NullString
	var deadline sql.NullTime
	var plannedDatesStr sql.NullString
	var lID sql.NullInt64
	var lName sql.NullString
	var lColor sql.NullString
	var priority sql.NullString

	// Creator fields
	var cID sql.NullInt64
	var cEmail sql.NullString
	var cFirstName sql.NullString
	var cLastName sql.NullString

	// Assignee fields
	var aID sql.NullInt64
	var aEmail sql.NullString
	var aFirstName sql.NullString
	var aLastName sql.NullString

	// Updater fields
	var uID sql.NullInt64
	var uEmail sql.NullString
	var uFirstName sql.NullString
	var uLastName sql.NullString

	// Project fields
	var pID sql.NullInt64
	var pName sql.NullString
	var pDesc sql.NullString

	if err := rows.Scan(&i.ID, &i.Title, &desc, &i.Status, &i.Position, &deadline, &plannedDatesStr, &priority, &i.CreatedAt, &i.UpdatedAt,
		&lID, &lName, &lColor,
		&cID, &cEmail, &cFirstName, &cLastName,
		&aID, &aEmail, &aFirstName, &aLastName,
		&uID, &uEmail, &uFirstName, &uLastName,
		&pID, &pName, &pDesc); err != nil {
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
			slog.Error("Database Error: parsing planned_dates", "id", i.ID, "error", err)
		}
	}
	if lID.Valid {
		i.Label = &Label{
			ID:    int(lID.Int64),
			Name:  lName.String,
			Color: lColor.String,
		}
	}

	if cID.Valid {
		i.CreatorID = int(cID.Int64)
		i.Creator = &User{
			ID:        int(cID.Int64),
			Email:     cEmail.String,
			FirstName: cFirstName.String,
			LastName:  cLastName.String,
		}
	}

	if aID.Valid {
		id := int(aID.Int64)
		i.AssigneeID = &id
		i.Assignee = &User{
			ID:        id,
			Email:     aEmail.String,
			FirstName: aFirstName.String,
			LastName:  aLastName.String,
		}
	}

	if uID.Valid {
		id := int(uID.Int64)
		i.UpdaterID = &id
		i.Updater = &User{
			ID:        id,
			Email:     uEmail.String,
			FirstName: uFirstName.String,
			LastName:  uLastName.String,
		}
	}

	if pID.Valid {
		i.ProjectID = int(pID.Int64)
		i.Project = &Project{
			ID:          int(pID.Int64),
			Name:        pName.String,
			Description: pDesc.String,
		}
	}

	return i, nil
}

// CreateUser inserts a new user into the database.
func CreateUser(u *User) error {
	stmt, err := DB.Prepare("INSERT INTO users(email, first_name, last_name, password_hash, role, active, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?)")
	if err != nil {
		slog.Error("Database Error: CreateUser Prepare", "error", err)
		return err
	}
	defer stmt.Close()

	u.UpdatedAt = time.Now().UTC()
	res, err := stmt.Exec(u.Email, u.FirstName, u.LastName, u.PasswordHash, u.Role, u.Active, u.UpdatedAt)
	if err != nil {
		if strings.Contains(err.Error(), errUniqueConstraintFailed) {
			return ErrDuplicateEmail
		}
		slog.Error("Database Error: CreateUser Exec", "error", err)
		return err
	}

	id, err := res.LastInsertId()
	if err != nil {
		slog.Error("Database Error: CreateUser LastInsertId", "error", err)
		return err
	}
	u.ID = int(id)
	return nil
}

// GetUserByEmail retrieves a user by their email address.
func GetUserByEmail(email string) (*User, error) {
	row := DB.QueryRow("SELECT id, email, first_name, last_name, password_hash, role, active, created_at, updated_at FROM users WHERE email = ?", email)

	var u User
	err := row.Scan(&u.ID, &u.Email, &u.FirstName, &u.LastName, &u.PasswordHash, &u.Role, &u.Active, &u.CreatedAt, &u.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		slog.Error("Database Error: GetUserByEmail", "error", err)
		return nil, err
	}
	return &u, nil
}

// GetUserByID retrieves a user by their ID.
func GetUserByID(id int) (*User, error) {
	row := DB.QueryRow("SELECT id, email, first_name, last_name, password_hash, role, active, created_at, updated_at FROM users WHERE id = ?", id)

	var u User
	err := row.Scan(&u.ID, &u.Email, &u.FirstName, &u.LastName, &u.PasswordHash, &u.Role, &u.Active, &u.CreatedAt, &u.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		slog.Error("Database Error: GetUserByID", "error", err)
		return nil, err
	}
	return &u, nil
}

// GetAllUsers retrieves all users from the database.
func GetAllUsers() ([]User, error) {
	rows, err := DB.Query("SELECT id, email, first_name, last_name, role, active, created_at, updated_at FROM users ORDER BY id ASC")
	if err != nil {
		slog.Error("Database Error: GetAllUsers", "error", err)
		return nil, err
	}
	defer rows.Close()

	users := []User{}
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Email, &u.FirstName, &u.LastName, &u.Role, &u.Active, &u.CreatedAt, &u.UpdatedAt); err != nil {
			slog.Error("Database Error: GetAllUsers Scan", "error", err)
			return nil, err
		}
		users = append(users, u)
	}
	return users, nil
}

// UpdateUser updates an existing user in the database.
func UpdateUser(u *User) error {
	stmt, err := DB.Prepare("UPDATE users SET email = ?, first_name = ?, last_name = ?, password_hash = ?, role = ?, active = ?, updated_at = ? WHERE id = ?")
	if err != nil {
		slog.Error("Database Error: UpdateUser Prepare", "error", err)
		return err
	}
	defer stmt.Close()

	u.UpdatedAt = time.Now().UTC()
	res, err := stmt.Exec(u.Email, u.FirstName, u.LastName, u.PasswordHash, u.Role, u.Active, u.UpdatedAt, u.ID)
	if err != nil {
		if strings.Contains(err.Error(), errUniqueConstraintFailed) {
			return ErrDuplicateEmail
		}
		slog.Error("Database Error: UpdateUser Exec", "error", err)
		return err
	}

	rowsAffected, err := res.RowsAffected()
	if err != nil {
		slog.Error("Database Error: UpdateUser RowsAffected", "error", err)
		return err
	}
	if rowsAffected == 0 {
		return ErrUserNotFound
	}
	return nil
}

// CountUsers returns the total number of users in the database.
func CountUsers() (int, error) {
	var count int
	err := DB.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	if err != nil {
		slog.Error("Database Error: CountUsers", "error", err)
		return 0, err
	}
	return count, nil
}

// CountActiveSysAdmins returns the number of active users with sysadmin role.
func CountActiveSysAdmins() (int, error) {
	var count int
	err := DB.QueryRow("SELECT COUNT(*) FROM users WHERE role = ? AND active = 1", RoleSysAdmin).Scan(&count)
	if err != nil {
		slog.Error("Database Error: CountActiveSysAdmins", "error", err)
		return 0, err
	}
	return count, nil
}

// -----------------------------------------------------------------------------
// Session Management
// -----------------------------------------------------------------------------

// CreateSession inserts a new session into the database.
func CreateSession(s *Session) error {
	stmt, err := DB.Prepare("INSERT INTO sessions(user_id, token_hash, expires_at, created_at) VALUES(?, ?, ?, ?)")
	if err != nil {
		slog.Error("Database Error: CreateSession Prepare", "error", err)
		return err
	}
	defer stmt.Close()

	if s.CreatedAt.IsZero() {
		s.CreatedAt = time.Now().UTC()
	}
	s.ExpiresAt = s.ExpiresAt.UTC()

	res, err := stmt.Exec(s.UserID, s.TokenHash, s.ExpiresAt, s.CreatedAt)
	if err != nil {
		slog.Error("Database Error: CreateSession Exec", "error", err)
		return err
	}

	id, err := res.LastInsertId()
	if err != nil {
		slog.Error("Database Error: CreateSession LastInsertId", "error", err)
		return err
	}
	s.ID = int(id)
	return nil
}

// GetSessionByID retrieves a session by its ID.
func GetSessionByID(id int) (*Session, error) {
	row := DB.QueryRow("SELECT id, user_id, token_hash, expires_at, created_at FROM sessions WHERE id = ?", id)

	var s Session
	err := row.Scan(&s.ID, &s.UserID, &s.TokenHash, &s.ExpiresAt, &s.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		slog.Error("Database Error: GetSessionByID", "error", err)
		return nil, err
	}
	return &s, nil
}

// UpdateSession updates the token hash and expiration of an existing session (Rotation).
func UpdateSession(s *Session) error {
	stmt, err := DB.Prepare("UPDATE sessions SET token_hash = ?, expires_at = ? WHERE id = ?")
	if err != nil {
		slog.Error("Database Error: UpdateSession Prepare", "error", err)
		return err
	}
	defer stmt.Close()

	res, err := stmt.Exec(s.TokenHash, s.ExpiresAt, s.ID)
	if err != nil {
		slog.Error("Database Error: UpdateSession Exec", "error", err)
		return err
	}

	rowsAffected, err := res.RowsAffected()
	if err != nil {
		slog.Error("Database Error: UpdateSession RowsAffected", "error", err)
		return err
	}
	if rowsAffected == 0 {
		return ErrSessionNotFound
	}
	return nil
}

// DeleteSession removes a session from the database by its ID.
func DeleteSession(id int) error {
	res, err := DB.Exec("DELETE FROM sessions WHERE id = ?", id)
	if err != nil {
		slog.Error("Database Error: DeleteSession", "error", err)
		return err
	}

	rowsAffected, err := res.RowsAffected()
	if err != nil {
		slog.Error("Database Error: DeleteSession RowsAffected", "error", err)
		return err
	}
	if rowsAffected == 0 {
		return ErrSessionNotFound
	}
	return nil
}

// DeleteSessionsByUserID removes all sessions for a specific user.
func DeleteSessionsByUserID(userID int) error {
	_, err := DB.Exec("DELETE FROM sessions WHERE user_id = ?", userID)
	if err != nil {
		slog.Error("Database Error: DeleteSessionsByUserID", "error", err)
		return err
	}
	return nil
}

// DeleteExpiredSessions removes all sessions that have expired from the database.
func DeleteExpiredSessions() (int64, error) {
	// Use time.Now() so the driver formats it consistently with how sessions were inserted
	res, err := DB.Exec("DELETE FROM sessions WHERE expires_at < ?", time.Now().UTC())
	if err != nil {
		slog.Error("Database Error: DeleteExpiredSessions", "error", err)
		return 0, err
	}

	rowsAffected, err := res.RowsAffected()
	if err != nil {
		slog.Error("Database Error: DeleteExpiredSessions RowsAffected", "error", err)
		return 0, err
	}
	return rowsAffected, nil
}
