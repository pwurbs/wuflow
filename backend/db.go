package backend

import (
	"database/sql"
	"log"
	"time"

	// Import sqlite3 driver for side effects (registration)
	_ "github.com/mattn/go-sqlite3"
)

// DB is the global database connection pool.
var DB *sql.DB

// InitDB initializes the database connection and creates tables if they don't exist.
func InitDB(dataSourceName string) {
	var err error
	DB, err = sql.Open("sqlite3", dataSourceName)
	if err != nil {
		log.Fatal(err)
	}

	if err = DB.Ping(); err != nil {
		log.Fatal(err)
	}

	if _, err := DB.Exec("PRAGMA journal_mode=WAL"); err != nil {
		log.Fatal(err)
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
		planned_date DATETIME,
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
		log.Fatal(err)
	}
	if _, err := DB.Exec(createTasksTable); err != nil {
		log.Fatal(err)
	}

	createLabelsTable := `
	CREATE TABLE IF NOT EXISTS labels (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		color TEXT NOT NULL
	);`
	if _, err := DB.Exec(createLabelsTable); err != nil {
		log.Fatal(err)
	}
}

// Helper functions for DB operations

// GetAllIssues retrieves all issues from the database, including their associated tasks.
func GetAllIssues() ([]Issue, error) {
	rows, err := DB.Query(`
		SELECT i.id, i.title, i.description, i.status, i.position, i.deadline, i.planned_date, i.priority, i.created_at, i.updated_at, 
		       l.id, l.name, l.color 
		FROM issues i 
		LEFT JOIN labels l ON i.label_id = l.id 
		ORDER BY i.position ASC`)
	if err != nil {
		log.Printf("Database Error: GetAllIssues: %v", err)
		return nil, err
	}
	defer rows.Close()

	var issues []Issue
	for rows.Next() {
		var i Issue
		var deadline sql.NullTime
		var plannedDate sql.NullTime
		var lID sql.NullInt64
		var lName sql.NullString

		var lColor sql.NullString
		var priority sql.NullString

		if err := rows.Scan(&i.ID, &i.Title, &i.Description, &i.Status, &i.Position, &deadline, &plannedDate, &priority, &i.CreatedAt, &i.UpdatedAt, &lID, &lName, &lColor); err != nil {
			log.Printf("Database Error: GetAllIssues Scan: %v", err)
			return nil, err
		}
		if priority.Valid {
			i.Priority = IssuePriority(priority.String)
		} else {
			i.Priority = PriorityNormal
		}
		if deadline.Valid {
			i.Deadline = &deadline.Time
		}
		if plannedDate.Valid {
			i.PlannedDate = &plannedDate.Time
		}
		if lID.Valid {
			i.Label = &Label{
				ID:    int(lID.Int64),
				Name:  lName.String,
				Color: lColor.String,
			}
		}

		tasks, err := GetTasksByIssueID(i.ID)
		if err != nil {
			log.Printf("Database Error: GetAllIssues GetTasksByIssueID: %v", err)
			return nil, err
		}
		i.Tasks = tasks
		issues = append(issues, i)
	}
	return issues, nil
}

// GetTasksByIssueID retrieves all tasks associated with a specific issue.
func GetTasksByIssueID(issueID int) ([]Task, error) {
	rows, err := DB.Query("SELECT id, issue_id, title, done, position, deadline, created_at, updated_at FROM tasks WHERE issue_id = ? ORDER BY position ASC", issueID)
	if err != nil {
		log.Printf("Database Error: GetTasksByIssueID: %v", err)
		return nil, err
	}
	defer rows.Close()

	var tasks []Task
	for rows.Next() {
		var t Task
		var deadline sql.NullTime
		if err := rows.Scan(&t.ID, &t.IssueID, &t.Title, &t.Done, &t.Position, &deadline, &t.CreatedAt, &t.UpdatedAt); err != nil {
			log.Printf("Database Error: GetTasksByIssueID Scan: %v", err)
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
	stmt, err := DB.Prepare("INSERT INTO issues(title, description, status, position, deadline, planned_date, priority, label_id, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)")
	if err != nil {
		log.Printf("Database Error: CreateIssue Prepare: %v", err)
		return err
	}
	defer stmt.Close()

	// Get max position for the status to append to the end
	var maxPos sql.NullInt64
	err = DB.QueryRow("SELECT MAX(position) FROM issues WHERE status = ?", i.Status).Scan(&maxPos)
	if err != nil && err != sql.ErrNoRows {
		log.Printf("Database Error: CreateIssue MaxPos: %v", err)
		return err
	}
	i.Position = int(maxPos.Int64) + 1
	i.UpdatedAt = time.Now()

	var labelID *int
	if i.Label != nil {
		id := i.Label.ID
		labelID = &id
	}

	res, err := stmt.Exec(i.Title, i.Description, i.Status, i.Position, i.Deadline, i.PlannedDate, i.Priority, labelID, i.UpdatedAt)
	if err != nil {
		log.Printf("Database Error: CreateIssue Exec: %v", err)
		return err
	}

	id, err := res.LastInsertId()
	if err != nil {
		log.Printf("Database Error: CreateIssue LastInsertId: %v", err)
		return err
	}
	i.ID = int(id)
	return nil
}

// UpdateIssue updates an existing issue in the database.
func UpdateIssue(i *Issue) error {

	stmt, err := DB.Prepare("UPDATE issues SET title = ?, description = ?, status = ?, position = ?, deadline = ?, planned_date = ?, priority = ?, label_id = ?, updated_at = ? WHERE id = ?")
	if err != nil {
		log.Printf("Database Error: UpdateIssue Prepare: %v", err)
		return err
	}
	defer stmt.Close()

	i.UpdatedAt = time.Now()

	var labelID *int
	if i.Label != nil {
		id := i.Label.ID
		labelID = &id
	}

	_, err = stmt.Exec(i.Title, i.Description, i.Status, i.Position, i.Deadline, i.PlannedDate, i.Priority, labelID, i.UpdatedAt, i.ID)
	if err != nil {
		log.Printf("Database Error: UpdateIssue Exec: %v", err)
	}
	return err
}

// DeleteIssue removes an issue from the database by its ID.
func DeleteIssue(id int) error {
	_, err := DB.Exec("DELETE FROM issues WHERE id = ?", id)
	if err != nil {
		log.Printf("Database Error: DeleteIssue: %v", err)
	}
	return err
}

// CreateTask inserts a new task into the database.
func CreateTask(t *Task) error {
	stmt, err := DB.Prepare("INSERT INTO tasks(issue_id, title, done, position, deadline, updated_at) VALUES(?, ?, ?, ?, ?, ?)")
	if err != nil {
		log.Printf("Database Error: CreateTask Prepare: %v", err)
		return err
	}
	defer stmt.Close()

	// Get max position
	var maxPos sql.NullInt64
	err = DB.QueryRow("SELECT MAX(position) FROM tasks WHERE issue_id = ?", t.IssueID).Scan(&maxPos)
	if err != nil && err != sql.ErrNoRows {
		log.Printf("Database Error: CreateTask MaxPos: %v", err)
		return err
	}
	t.Position = int(maxPos.Int64) + 1
	t.UpdatedAt = time.Now()

	res, err := stmt.Exec(t.IssueID, t.Title, t.Done, t.Position, t.Deadline, t.UpdatedAt)
	if err != nil {
		log.Printf("Database Error: CreateTask Exec: %v", err)
		return err
	}

	id, err := res.LastInsertId()
	if err != nil {
		log.Printf("Database Error: CreateTask LastInsertId: %v", err)
		return err
	}
	t.ID = int(id)
	return nil
}

// UpdateTask updates an existing task in the database.
func UpdateTask(t *Task) error {
	stmt, err := DB.Prepare("UPDATE tasks SET title = ?, done = ?, position = ?, deadline = ?, updated_at = ? WHERE id = ?")
	if err != nil {
		log.Printf("Database Error: UpdateTask Prepare: %v", err)
		return err
	}
	defer stmt.Close()

	t.UpdatedAt = time.Now()
	_, err = stmt.Exec(t.Title, t.Done, t.Position, t.Deadline, t.UpdatedAt, t.ID)
	if err != nil {
		log.Printf("Database Error: UpdateTask Exec: %v", err)
	}
	return err
}

// DeleteTask removes a task from the database by its ID.
func DeleteTask(id int) error {
	_, err := DB.Exec("DELETE FROM tasks WHERE id = ?", id)
	if err != nil {
		log.Printf("Database Error: DeleteTask: %v", err)
	}
	return err
}

// GetAllLabels retrieves all labels from the database.
func GetAllLabels() ([]Label, error) {
	rows, err := DB.Query("SELECT id, name, color FROM labels ORDER BY name ASC")
	if err != nil {
		log.Printf("Database Error: GetAllLabels: %v", err)
		return nil, err
	}
	defer rows.Close()

	labels := []Label{} // Initialize as empty slice to ensure JSON [] instead of null
	for rows.Next() {
		var l Label
		if err := rows.Scan(&l.ID, &l.Name, &l.Color); err != nil {
			log.Printf("Database Error: GetAllLabels Scan: %v", err)
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
		log.Printf("Database Error: CreateLabel Prepare: %v", err)
		return err
	}
	defer stmt.Close()

	res, err := stmt.Exec(l.Name, l.Color)
	if err != nil {
		log.Printf("Database Error: CreateLabel Exec: %v", err)
		return err
	}

	id, err := res.LastInsertId()
	if err != nil {
		log.Printf("Database Error: CreateLabel LastInsertId: %v", err)
		return err
	}
	l.ID = int(id)
	return nil
}

// DeleteLabel removes a label from the database by its ID.
func DeleteLabel(id int) error {
	_, err := DB.Exec("DELETE FROM labels WHERE id = ?", id)
	if err != nil {
		log.Printf("Database Error: DeleteLabel: %v", err)
	}
	return err
}
