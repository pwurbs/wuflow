package backend

import (
	"database/sql"
	"log"
	"time"

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
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
}

// Helper functions for DB operations

// GetAllIssues retrieves all issues from the database, including their associated tasks.
func GetAllIssues() ([]Issue, error) {
	rows, err := DB.Query("SELECT id, title, description, status, position, deadline, planned_date, created_at, updated_at FROM issues ORDER BY position ASC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var issues []Issue
	for rows.Next() {
		var i Issue
		var deadline sql.NullTime
		var plannedDate sql.NullTime
		if err := rows.Scan(&i.ID, &i.Title, &i.Description, &i.Status, &i.Position, &deadline, &plannedDate, &i.CreatedAt, &i.UpdatedAt); err != nil {
			return nil, err
		}
		if deadline.Valid {
			i.Deadline = &deadline.Time
		}
		if plannedDate.Valid {
			i.PlannedDate = &plannedDate.Time
		}

		tasks, err := GetTasksByIssueID(i.ID)
		if err != nil {
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
		return nil, err
	}
	defer rows.Close()

	var tasks []Task
	for rows.Next() {
		var t Task
		var deadline sql.NullTime
		if err := rows.Scan(&t.ID, &t.IssueID, &t.Title, &t.Done, &t.Position, &deadline, &t.CreatedAt, &t.UpdatedAt); err != nil {
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
	stmt, err := DB.Prepare("INSERT INTO issues(title, description, status, position, deadline, planned_date, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?)")
	if err != nil {
		return err
	}
	defer stmt.Close()

	// Get max position for the status to append to the end
	var maxPos sql.NullInt64
	err = DB.QueryRow("SELECT MAX(position) FROM issues WHERE status = ?", i.Status).Scan(&maxPos)
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	i.Position = int(maxPos.Int64) + 1
	i.UpdatedAt = time.Now()

	res, err := stmt.Exec(i.Title, i.Description, i.Status, i.Position, i.Deadline, i.PlannedDate, i.UpdatedAt)
	if err != nil {
		return err
	}

	id, err := res.LastInsertId()
	if err != nil {
		return err
	}
	i.ID = int(id)
	return nil
}

// UpdateIssue updates an existing issue in the database.
func UpdateIssue(i *Issue) error {
	stmt, err := DB.Prepare("UPDATE issues SET title = ?, description = ?, status = ?, position = ?, deadline = ?, planned_date = ?, updated_at = ? WHERE id = ?")
	if err != nil {
		return err
	}
	defer stmt.Close()

	i.UpdatedAt = time.Now()
	_, err = stmt.Exec(i.Title, i.Description, i.Status, i.Position, i.Deadline, i.PlannedDate, i.UpdatedAt, i.ID)
	return err
}

// DeleteIssue removes an issue from the database by its ID.
func DeleteIssue(id int) error {
	_, err := DB.Exec("DELETE FROM issues WHERE id = ?", id)
	return err
}

// CreateTask inserts a new task into the database.
func CreateTask(t *Task) error {
	stmt, err := DB.Prepare("INSERT INTO tasks(issue_id, title, done, position, deadline, updated_at) VALUES(?, ?, ?, ?, ?, ?)")
	if err != nil {
		return err
	}
	defer stmt.Close()

	// Get max position
	var maxPos sql.NullInt64
	err = DB.QueryRow("SELECT MAX(position) FROM tasks WHERE issue_id = ?", t.IssueID).Scan(&maxPos)
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	t.Position = int(maxPos.Int64) + 1
	t.UpdatedAt = time.Now()

	res, err := stmt.Exec(t.IssueID, t.Title, t.Done, t.Position, t.Deadline, t.UpdatedAt)
	if err != nil {
		return err
	}

	id, err := res.LastInsertId()
	if err != nil {
		return err
	}
	t.ID = int(id)
	return nil
}

// UpdateTask updates an existing task in the database.
func UpdateTask(t *Task) error {
	stmt, err := DB.Prepare("UPDATE tasks SET title = ?, done = ?, position = ?, deadline = ?, updated_at = ? WHERE id = ?")
	if err != nil {
		return err
	}
	defer stmt.Close()

	t.UpdatedAt = time.Now()
	_, err = stmt.Exec(t.Title, t.Done, t.Position, t.Deadline, t.UpdatedAt, t.ID)
	return err
}

// DeleteTask removes a task from the database by its ID.
func DeleteTask(id int) error {
	_, err := DB.Exec("DELETE FROM tasks WHERE id = ?", id)
	return err
}
