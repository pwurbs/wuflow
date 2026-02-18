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

// ErrDuplicateEmail is returned when a user with the same email already exists.
var ErrDuplicateEmail = errors.New("email already exists")

// InitDB initializes the database connection and creates tables if they don't exist.
func InitDB(dataSourceName string) error {
	if _, err := os.Stat(dataSourceName); os.IsNotExist(err) {
		slog.Info("Creating new database", "path", dataSourceName)
	}

	var err error
	DB, err = sql.Open("sqlite3", dataSourceName)
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
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE SET NULL,
		FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE SET NULL,
		FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL,
		FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
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

	return nil
}

// Helper functions for DB operations

// CreateIssue inserts a new issue into the database.
func CreateIssue(i *Issue) error {
	if i.Priority == "" {
		i.Priority = PriorityNormal
	}
	stmt, err := DB.Prepare("INSERT INTO issues(title, description, status, position, deadline, planned_dates, priority, label_id, creator_id, assignee_id, updated_by, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
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

	var plannedDatesJSON interface{}
	if i.PlannedDates != nil {
		b, err := json.Marshal(i.PlannedDates)
		if err != nil {
			slog.Error("Database Error: CreateIssue Marshal Dates", "error", err)
			return err
		}
		plannedDatesJSON = string(b)
	}

	res, err := stmt.Exec(i.Title, i.Description, i.Status, i.Position, i.Deadline, plannedDatesJSON, i.Priority, labelID, i.CreatorID, i.AssigneeID, i.UpdaterID, i.UpdatedAt)
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

// GetAllActiveIssues retrieves all active (non-archived) issues from the database, including their associated tasks.
func GetAllActiveIssues() ([]Issue, error) {
	rows, err := DB.Query(`
		SELECT i.id, i.title, i.description, i.status, i.position, i.deadline, i.planned_dates, i.priority, i.created_at, i.updated_at, 
		       l.id, l.name, l.color,
		       c.id, c.email, c.first_name, c.last_name,
		       a.id, a.email, a.first_name, a.last_name,
		       u.id, u.email, u.first_name, u.last_name
		FROM issues i 
		LEFT JOIN labels l ON i.label_id = l.id 
		LEFT JOIN users c ON i.creator_id = c.id
		LEFT JOIN users a ON i.assignee_id = a.id
		LEFT JOIN users u ON i.updated_by = u.id
		WHERE i.status != ?
		ORDER BY i.position ASC`, StatusArchive)
	if err != nil {
		slog.Error("Database Error: GetAllActiveIssues", "error", err)
		return nil, err
	}
	defer rows.Close()

	var issues []Issue
	for rows.Next() {
		i, err := scanIssue(rows)
		if err != nil {
			slog.Error("Database Error: GetAllActiveIssues Scan", "error", err)
			return nil, err
		}
		issues = append(issues, i)
	}
	if err := rows.Err(); err != nil {
		slog.Error("Database Error: GetAllActiveIssues Rows", "error", err)
		return nil, err
	}

	// Batch fetch all tasks and assign to issues
	tasksByIssue, err := GetAllTasks()
	if err != nil {
		slog.Error("Database Error: GetAllActiveIssues GetAllTasks", "error", err)
		return nil, err
	}
	for idx := range issues {
		issues[idx].Tasks = tasksByIssue[issues[idx].ID]
	}

	return issues, nil
}

// GetAllArchivedIssues retrieves all archived issues from the database, including their associated tasks.
func GetAllArchivedIssues() ([]Issue, error) {
	rows, err := DB.Query(`
		SELECT i.id, i.title, i.description, i.status, i.position, i.deadline, i.planned_dates, i.priority, i.created_at, i.updated_at, 
		       l.id, l.name, l.color,
		       c.id, c.email, c.first_name, c.last_name,
		       a.id, a.email, a.first_name, a.last_name,
		       u.id, u.email, u.first_name, u.last_name
		FROM issues i 
		LEFT JOIN labels l ON i.label_id = l.id 
		LEFT JOIN users c ON i.creator_id = c.id
		LEFT JOIN users a ON i.assignee_id = a.id
		LEFT JOIN users u ON i.updated_by = u.id
		WHERE i.status = ?
		ORDER BY i.position ASC`, StatusArchive)
	if err != nil {
		slog.Error("Database Error: GetArchivedIssues", "error", err)
		return nil, err
	}
	defer rows.Close()

	var issues []Issue
	for rows.Next() {
		i, err := scanIssue(rows)
		if err != nil {
			slog.Error("Database Error: GetArchivedIssues Scan", "error", err)
			return nil, err
		}
		issues = append(issues, i)
	}
	if err := rows.Err(); err != nil {
		slog.Error("Database Error: GetArchivedIssues Rows", "error", err)
		return nil, err
	}

	// Batch fetch all tasks and assign to issues
	tasksByIssue, err := GetAllTasks()
	if err != nil {
		slog.Error("Database Error: GetArchivedIssues GetAllTasks", "error", err)
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
		       u.id, u.email, u.first_name, u.last_name
		FROM issues i 
		LEFT JOIN labels l ON i.label_id = l.id 
		LEFT JOIN users c ON i.creator_id = c.id
		LEFT JOIN users a ON i.assignee_id = a.id
		LEFT JOIN users u ON i.updated_by = u.id
		WHERE i.id = ?`, id)

	var issue Issue
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

	err := row.Scan(&issue.ID, &issue.Title, &issue.Description, &issue.Status, &issue.Position, &deadline, &plannedDatesStr, &priority, &issue.CreatedAt, &issue.UpdatedAt,
		&lID, &lName, &lColor,
		&cID, &cEmail, &cFirstName, &cLastName,
		&aID, &aEmail, &aFirstName, &aLastName,
		&uID, &uEmail, &uFirstName, &uLastName)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		slog.Error("Database Error: GetIssueByID", "error", err)
		return nil, err
	}

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

	stmt, err := DB.Prepare("UPDATE issues SET title = ?, description = ?, status = ?, position = ?, deadline = ?, planned_dates = ?, priority = ?, label_id = ?, assignee_id = ?, updated_by = ?, updated_at = ? WHERE id = ?")
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

	var plannedDatesJSON interface{}
	if i.PlannedDates != nil {
		b, err := json.Marshal(i.PlannedDates)
		if err != nil {
			slog.Error("Database Error: UpdateIssue Marshal Dates", "error", err)
			return err
		}
		plannedDatesJSON = string(b)
	}

	res, err := stmt.Exec(i.Title, i.Description, i.Status, i.Position, i.Deadline, plannedDatesJSON, i.Priority, labelID, i.AssigneeID, i.UpdaterID, i.UpdatedAt, i.ID)
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

func scanIssue(rows *sql.Rows) (Issue, error) {
	var i Issue
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

	if err := rows.Scan(&i.ID, &i.Title, &i.Description, &i.Status, &i.Position, &deadline, &plannedDatesStr, &priority, &i.CreatedAt, &i.UpdatedAt,
		&lID, &lName, &lColor,
		&cID, &cEmail, &cFirstName, &cLastName,
		&aID, &aEmail, &aFirstName, &aLastName,
		&uID, &uEmail, &uFirstName, &uLastName); err != nil {
		return Issue{}, err
	}
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
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
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
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
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

// CountActiveAdmins returns the number of active users with admin role.
func CountActiveAdmins() (int, error) {
	var count int
	err := DB.QueryRow("SELECT COUNT(*) FROM users WHERE role = ? AND active = 1", RoleAdmin).Scan(&count)
	if err != nil {
		slog.Error("Database Error: CountActiveAdmins", "error", err)
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
		return errors.New("session not found")
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
		return errors.New("session not found")
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
