package backend

import (
	"database/sql"
	"encoding/json"
	"log/slog"
	"os"
	"time"

	// Import sqlite3 driver for side effects (registration)
	_ "github.com/mattn/go-sqlite3"
)

// DB is the global database connection pool.
var DB *sql.DB

// InitDB initializes the database connection and creates tables if they don't exist.
func InitDB(dataSourceName string) {
	if _, err := os.Stat(dataSourceName); os.IsNotExist(err) {
		slog.Info("Creating new database", "path", dataSourceName)
	}

	var err error
	DB, err = sql.Open("sqlite3", dataSourceName)
	if err != nil {
		slog.Error("Failed to open database", "error", err)
		os.Exit(1)
	}

	if err = DB.Ping(); err != nil {
		slog.Error("Failed to ping database", "error", err)
		os.Exit(1)
	}

	if _, err := DB.Exec("PRAGMA journal_mode=WAL"); err != nil {
		slog.Error("Failed to set WAL mode", "error", err)
		os.Exit(1)
	}

	createTables()
}

// createTables creates the necessary tables for the application.
func createTables() {
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
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE SET NULL
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
		os.Exit(1)
	}
	if _, err := DB.Exec(createTasksTable); err != nil {
		slog.Error("Failed to create tasks table", "error", err)
		os.Exit(1)
	}

	createLabelsTable := `
	CREATE TABLE IF NOT EXISTS labels (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		color TEXT NOT NULL
	);`
	if _, err := DB.Exec(createLabelsTable); err != nil {
		slog.Error("Failed to create labels table", "error", err)
		os.Exit(1)
	}

}

// Helper functions for DB operations

// GetAllIssues retrieves all issues from the database, including their associated tasks.
func GetAllIssues() ([]Issue, error) {
	rows, err := DB.Query(`
		SELECT i.id, i.title, i.description, i.status, i.position, i.deadline, i.planned_dates, i.priority, i.created_at, i.updated_at, 
		       l.id, l.name, l.color 
		FROM issues i 
		LEFT JOIN labels l ON i.label_id = l.id 
		ORDER BY i.position ASC`)
	if err != nil {
		slog.Error("Database Error: GetAllIssues", "error", err)
		return nil, err
	}
	defer rows.Close()

	var issues []Issue
	for rows.Next() {
		i, err := scanIssue(rows)
		if err != nil {
			slog.Error("Database Error: GetAllIssues Scan", "error", err)
			return nil, err
		}

		tasks, err := GetTasksByIssueID(i.ID)
		if err != nil {
			slog.Error("Database Error: GetAllIssues GetTasksByIssueID", "error", err)
			return nil, err
		}
		i.Tasks = tasks
		issues = append(issues, i)
	}
	return issues, nil
}

// GetIssueByID retrieves a single issue by ID, including its associated tasks.
func GetIssueByID(id int) (*Issue, error) {
	row := DB.QueryRow(`
		SELECT i.id, i.title, i.description, i.status, i.position, i.deadline, i.planned_dates, i.priority, i.created_at, i.updated_at, 
		       l.id, l.name, l.color 
		FROM issues i 
		LEFT JOIN labels l ON i.label_id = l.id 
		WHERE i.id = ?`, id)

	var issue Issue
	var deadline sql.NullTime
	var plannedDatesStr sql.NullString
	var lID sql.NullInt64
	var lName sql.NullString
	var lColor sql.NullString
	var priority sql.NullString

	err := row.Scan(&issue.ID, &issue.Title, &issue.Description, &issue.Status, &issue.Position, &deadline, &plannedDatesStr, &priority, &issue.CreatedAt, &issue.UpdatedAt, &lID, &lName, &lColor)
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

	tasks, err := GetTasksByIssueID(issue.ID)
	if err != nil {
		slog.Error("Database Error: GetIssueByID GetTasksByIssueID", "error", err)
		return nil, err
	}
	issue.Tasks = tasks

	return &issue, nil
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
	return tasks, nil
}

// CreateIssue inserts a new issue into the database.
func CreateIssue(i *Issue) error {
	if i.Priority == "" {
		i.Priority = PriorityNormal
	}
	stmt, err := DB.Prepare("INSERT INTO issues(title, description, status, position, deadline, planned_dates, priority, label_id, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)")
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
	i.UpdatedAt = time.Now()

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

	res, err := stmt.Exec(i.Title, i.Description, i.Status, i.Position, i.Deadline, plannedDatesJSON, i.Priority, labelID, i.UpdatedAt)
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

// UpdateIssue updates an existing issue in the database.
func UpdateIssue(i *Issue) error {

	stmt, err := DB.Prepare("UPDATE issues SET title = ?, description = ?, status = ?, position = ?, deadline = ?, planned_dates = ?, priority = ?, label_id = ?, updated_at = ? WHERE id = ?")
	if err != nil {
		slog.Error("Database Error: UpdateIssue Prepare", "error", err)
		return err
	}
	defer stmt.Close()

	i.UpdatedAt = time.Now()

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

	_, err = stmt.Exec(i.Title, i.Description, i.Status, i.Position, i.Deadline, plannedDatesJSON, i.Priority, labelID, i.UpdatedAt, i.ID)
	if err != nil {
		slog.Error("Database Error: UpdateIssue Exec", "error", err)
	}
	return err
}

// DeleteIssue removes an issue from the database by its ID.
func DeleteIssue(id int) error {
	_, err := DB.Exec("DELETE FROM issues WHERE id = ?", id)
	if err != nil {
		slog.Error("Database Error: DeleteIssue", "error", err)
	}
	return err
}

// CreateTask inserts a new task into the database.
func CreateTask(t *Task) error {
	stmt, err := DB.Prepare("INSERT INTO tasks(issue_id, title, done, position, deadline, updated_at) VALUES(?, ?, ?, ?, ?, ?)")
	if err != nil {
		slog.Error("Database Error: CreateTask Prepare", "error", err)
		return err
	}
	defer stmt.Close()

	// Get max position
	var maxPos sql.NullInt64
	err = DB.QueryRow("SELECT MAX(position) FROM tasks WHERE issue_id = ?", t.IssueID).Scan(&maxPos)
	if err != nil && err != sql.ErrNoRows {
		slog.Error("Database Error: CreateTask MaxPos", "error", err)
		return err
	}
	t.Position = int(maxPos.Int64) + 1
	t.UpdatedAt = time.Now()

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

// UpdateTask updates an existing task in the database.
func UpdateTask(t *Task) error {
	stmt, err := DB.Prepare("UPDATE tasks SET title = ?, done = ?, position = ?, deadline = ?, updated_at = ? WHERE id = ?")
	if err != nil {
		slog.Error("Database Error: UpdateTask Prepare", "error", err)
		return err
	}
	defer stmt.Close()

	t.UpdatedAt = time.Now()
	_, err = stmt.Exec(t.Title, t.Done, t.Position, t.Deadline, t.UpdatedAt, t.ID)
	if err != nil {
		slog.Error("Database Error: UpdateTask Exec", "error", err)
	}
	return err
}

// DeleteTask removes a task from the database by its ID.
func DeleteTask(id int) error {
	_, err := DB.Exec("DELETE FROM tasks WHERE id = ?", id)
	if err != nil {
		slog.Error("Database Error: DeleteTask", "error", err)
	}
	return err
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
	return labels, nil
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

// DeleteLabel removes a label from the database by its ID.
func DeleteLabel(id int) error {
	_, err := DB.Exec("DELETE FROM labels WHERE id = ?", id)
	if err != nil {
		slog.Error("Database Error: DeleteLabel", "error", err)
	}
	return err
}

func scanIssue(rows *sql.Rows) (Issue, error) {
	var i Issue
	var deadline sql.NullTime
	var plannedDatesStr sql.NullString
	var lID sql.NullInt64
	var lName sql.NullString
	var lColor sql.NullString
	var priority sql.NullString

	if err := rows.Scan(&i.ID, &i.Title, &i.Description, &i.Status, &i.Position, &deadline, &plannedDatesStr, &priority, &i.CreatedAt, &i.UpdatedAt, &lID, &lName, &lColor); err != nil {
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
	return i, nil
}
