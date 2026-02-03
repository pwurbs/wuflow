package backend

import (
	"database/sql"
	"fmt"
	"testing"
	"time"

	// Import sqlite3 driver for side effects (registration)
	_ "github.com/mattn/go-sqlite3"
)

var testDBCounter int

const (
	testDBURI         = "file:memdb%d?mode=memory&cache=shared"
	expectedScanError = "expected scan error, got nil"
)

func setupTestDB() {
	testDBCounter++
	// Use a unique name for each test database to avoid pollution,
	// while still using cache=shared to support the connection pool.
	dataSourceName := fmt.Sprintf(testDBURI, testDBCounter)
	InitDB(dataSourceName)
}

func teardownTestDB() {
	if DB != nil {
		DB.Close()
	}
}

func TestCreateIssue(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	deadline := time.Now().Add(24 * time.Hour)
	issue := &Issue{
		Title:       "Test Issue",
		Description: "Test Description",
		Status:      StatusOpen,
		Deadline:    &deadline,
	}

	err := CreateIssue(issue)
	if err != nil {
		t.Fatalf("Failed to create issue: %v", err)
	}

	if issue.ID == 0 {
		t.Errorf("Expected issue ID to be set, got 0")
	}
	if issue.Position != 1 {
		t.Errorf("Expected position to be 1, got %d", issue.Position)
	}
}

func TestGetAllIssues(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue1 := &Issue{Title: "Issue 1", Status: StatusOpen}
	issue2 := &Issue{Title: "Issue 2", Status: StatusOpen}

	CreateIssue(issue1)
	CreateIssue(issue2)

	issues, err := GetAllIssues()
	if err != nil {
		t.Fatalf("Failed to get all issues: %v", err)
	}

	if len(issues) != 2 {
		t.Errorf("Expected 2 issues, got %d", len(issues))
	}
}

func TestUpdateIssue(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: "Original Title", Status: StatusOpen}
	CreateIssue(issue)

	issue.Title = "Updated Title"
	err := UpdateIssue(issue)
	if err != nil {
		t.Fatalf("Failed to update issue: %v", err)
	}

	issues, err := GetAllIssues()
	if err != nil {
		t.Fatalf("Failed to get all issues: %v", err)
	}
	if len(issues) == 0 {
		t.Fatalf("Expected at least one issue")
	}
	if issues[0].Title != "Updated Title" {
		t.Errorf("Expected title to be 'Updated Title', got '%s'", issues[0].Title)
	}
}

func TestDeleteIssue(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: "To Delete", Status: StatusOpen}
	CreateIssue(issue)

	err := DeleteIssue(issue.ID)
	if err != nil {
		t.Fatalf("Failed to delete issue: %v", err)
	}

	issues, _ := GetAllIssues()
	if len(issues) != 0 {
		t.Errorf("Expected 0 issues, got %d", len(issues))
	}
}

func TestCreateTask(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: "Issue for Task", Status: StatusOpen}
	CreateIssue(issue)

	task := &Task{
		IssueID: issue.ID,
		Title:   "Test Task",
		Done:    false,
	}

	err := CreateTask(task)
	if err != nil {
		t.Fatalf("Failed to create task: %v", err)
	}

	if task.ID == 0 {
		t.Errorf("Expected task ID to be set, got 0")
	}
}

func TestGetTasksByIssueID(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: "Issue with Tasks", Status: StatusOpen}
	CreateIssue(issue)

	task1 := &Task{IssueID: issue.ID, Title: "Task 1"}
	task2 := &Task{IssueID: issue.ID, Title: "Task 2"}

	CreateTask(task1)
	CreateTask(task2)

	tasks, err := GetTasksByIssueID(issue.ID)
	if err != nil {
		t.Fatalf("Failed to get tasks: %v", err)
	}

	if len(tasks) != 2 {
		t.Errorf("Expected 2 tasks, got %d", len(tasks))
	}
}

func TestUpdateTask(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: "Issue", Status: StatusOpen}
	CreateIssue(issue)

	task := &Task{IssueID: issue.ID, Title: "Original Task"}
	CreateTask(task)

	task.Title = "Updated Task"
	task.Done = true
	err := UpdateTask(task)
	if err != nil {
		t.Fatalf("Failed to update task: %v", err)
	}

	tasks, _ := GetTasksByIssueID(issue.ID)
	if tasks[0].Title != "Updated Task" {
		t.Errorf("Expected title to be 'Updated Task', got '%s'", tasks[0].Title)
	}
	if !tasks[0].Done {
		t.Errorf("Expected task to be done")
	}
}

func TestDeleteTask(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: "Issue", Status: StatusOpen}
	CreateIssue(issue)

	task := &Task{IssueID: issue.ID, Title: "To Delete"}
	CreateTask(task)

	err := DeleteTask(task.ID)
	if err != nil {
		t.Fatalf("Failed to delete task: %v", err)
	}

	tasks, _ := GetTasksByIssueID(issue.ID)
	if len(tasks) != 0 {
		t.Errorf("Expected 0 tasks, got %d", len(tasks))
	}
}

func TestDBErrors(t *testing.T) {
	// Save original DB
	oldDB := DB
	defer func() {
		DB = oldDB
	}()

	// Create a closed DB to force errors
	closedDB, _ := sql.Open("sqlite3", ":memory:")
	closedDB.Close()

	// Swap global DB
	DB = closedDB

	tests := []struct {
		name string
		f    func() error
	}{
		{"GetAllIssues", func() error { _, err := GetAllIssues(); return err }},
		{"GetTasksByIssueID", func() error { _, err := GetTasksByIssueID(1); return err }},
		{"CreateIssue", func() error { return CreateIssue(&Issue{Title: "T"}) }},
		{"UpdateIssue", func() error { return UpdateIssue(&Issue{ID: 1, Title: "T"}) }},
		{"DeleteIssue", func() error { return DeleteIssue(1) }},
		{"CreateTask", func() error { return CreateTask(&Task{IssueID: 1, Title: "T"}) }},
		{"UpdateTask", func() error { return UpdateTask(&Task{ID: 1, Title: "T"}) }},
		{"DeleteTask", func() error { return DeleteTask(1) }},
		{"GetAllLabels", func() error { _, err := GetAllLabels(); return err }},
		{"CreateLabel", func() error { return CreateLabel(&Label{Name: "L"}) }},
		{"DeleteLabel", func() error { return DeleteLabel(1) }},
	}

	for _, tt := range tests {
		t.Run(tt.name+"_Error", func(t *testing.T) {
			if tt.f() == nil {
				t.Error("expected error, got nil")
			}
		})
	}
}

func TestDBScanErrors(t *testing.T) {
	// Use a private, non-shared in-memory DB for these tests to avoid polluting other tests
	oldDB := DB
	defer func() { DB = oldDB }()

	// We use a different name for the shared cache to isolate from other tests
	InitDB("file:scanerr?mode=memory&cache=shared")
	defer DB.Close()

	t.Run("GetAllIssues_ScanError", func(t *testing.T) {
		_, _ = DB.Exec("INSERT INTO issues(title, status, position) VALUES(?, ?, ?)", "T", "todo", "not-an-int")
		if _, err := GetAllIssues(); err == nil {
			t.Error(expectedScanError)
		}
	})

	t.Run("GetTasksByIssueID_ScanError", func(t *testing.T) {
		// Reset for this subtest
		testDBCounter++
		InitDB(fmt.Sprintf(testDBURI, testDBCounter))
		_, _ = DB.Exec("INSERT INTO issues(id, title, status, position) VALUES(1, 'T', 'todo', 1)")
		_, _ = DB.Exec("INSERT INTO tasks(issue_id, title, position) VALUES(1, 'T', 'not-an-int')")
		if _, err := GetTasksByIssueID(1); err == nil {
			t.Error(expectedScanError)
		}
	})

	t.Run("GetAllLabels_ScanError", func(t *testing.T) {
		testDBCounter++
		InitDB(fmt.Sprintf(testDBURI, testDBCounter))
		// name is TEXT, but we can't easily force Scan to fail on string unless we change the struct or use invalid data
		// Let's use ID which is int
		_, _ = DB.Exec("INSERT INTO labels(name, color) VALUES(?, ?)", "L", "#000")
		// Mess with the table? No, SQLite is flexible.
		// How about we drop the table and create it with different types
		_, _ = DB.Exec("DROP TABLE labels")
		_, _ = DB.Exec("CREATE TABLE labels (id TEXT, name TEXT, color TEXT)")
		_, _ = DB.Exec("INSERT INTO labels(id, name, color) VALUES(?, ?, ?)", "not-an-int", "L", "#000")
		if _, err := GetAllLabels(); err == nil {
			t.Error(expectedScanError)
		}
	})
}

func TestDBConstraintErrors(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	const foreignKeyConst = "PRAGMA foreign_keys = ON"
	const expectedErr = "expected constraint error, got nil"

	t.Run("CreateIssue_ExecError", func(t *testing.T) {
		_, _ = DB.Exec(foreignKeyConst)
		if CreateIssue(&Issue{Title: "T", Status: "todo", Label: &Label{ID: 999}}) == nil {
			t.Error(expectedErr)
		}
	})

	t.Run("UpdateIssue_ExecError", func(t *testing.T) {
		setupTestDB()
		_, _ = DB.Exec(foreignKeyConst)
		CreateIssue(&Issue{Title: "T", Status: "todo"})
		if UpdateIssue(&Issue{ID: 1, Title: "T", Status: "todo", Label: &Label{ID: 999}}) == nil {
			t.Error(expectedErr)
		}
	})

	t.Run("CreateTask_ExecError", func(t *testing.T) {
		setupTestDB()
		_, _ = DB.Exec(foreignKeyConst)
		if CreateTask(&Task{IssueID: 999, Title: "T"}) == nil {
			t.Error(expectedErr)
		}
	})

	t.Run("CreateLabel_ExecError", func(t *testing.T) {
		// name is NOT NULL. In sqlite3 driver, we can trigger this by passing nil?
		// Actually, let's try something else. Duplicate ID?
		setupTestDB()
		_, _ = DB.Exec("INSERT INTO labels(id, name, color) VALUES(1, 'L', '#000')")
		_ = CreateLabel(&Label{ID: 1, Name: "L2", Color: "#111"})

		// Let's force it to fail by making it too long? No SQLite doesn't care.
		// How about a unique constraint?
		_, _ = DB.Exec("CREATE UNIQUE INDEX idx_labels_name ON labels(name)")
		if CreateLabel(&Label{Name: "L", Color: "#000"}) == nil {
			t.Error(expectedErr)
		}
	})
}
