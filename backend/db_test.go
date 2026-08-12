package backend

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	// Import sqlite3 driver for side effects (registration)
	_ "github.com/mattn/go-sqlite3"
)

var testDBCounter int

const (
	testDBURI                   = "file:memdb%d?mode=memory&cache=shared"
	expectedScanError           = "expected scan error, got nil"
	testDate                    = "2023-10-27"
	unexpectedGetAllIssuesError = "Failed to get all issues: %v"
	initDBErrorMsg              = "InitDB failed: %v"
	testIssueTitle              = "Test Issue"
	testTaskTitle               = "Test Task"
	dropTasksTable              = "DROP TABLE tasks"
	failedToCreateIssueError    = "Failed to create issue: %v"
	failedToUpdateIssueError    = "Failed to update issue: %v"
	expectedOneIssueMsg         = "Expected 1 issue, got %d"
)

func setupTestDB() {
	testDBCounter++
	// Use a unique name for each test database to avoid pollution,
	// while still using cache=shared to support the connection pool.
	dataSourceName := fmt.Sprintf(testDBURI, testDBCounter)
	if err := InitDB(context.Background(), dataSourceName); err != nil {
		panic(err)
	}
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
		Title:       testIssueTitle,
		Description: "Test Description",
		Status:      StatusOpen,
		ProjectID:   1,
		Deadline:    &deadline,
	}

	err := CreateIssue(context.Background(), issue)
	if err != nil {
		t.Fatalf(failedToCreateIssueError, err)
	}

	if issue.ID == 0 {
		t.Errorf("Expected issue ID to be set, got 0")
	}
	if issue.Position != 1 {
		t.Errorf("Expected position to be 1, got %d", issue.Position)
	}
}

func TestIssuePlannedDates(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// 1. Create with multiple dates
	dates := []string{testDate, "2023-10-28"}
	issue := &Issue{
		Title:        "Planned Issue",
		Status:       StatusOpen,
		ProjectID:    1,
		PlannedDates: dates,
	}

	err := CreateIssue(context.Background(), issue)
	if err != nil {
		t.Fatalf(failedToCreateIssueError, err)
	}

	// 2. Verify retrieval
	issues, err := GetAllActiveIssues()
	if err != nil {
		t.Fatalf("Failed to get issues: %v", err)
	}
	if len(issues) != 1 {
		t.Fatalf("Expected 1 issue")
	}
	retrieved := issues[0]
	if len(retrieved.PlannedDates) != 2 {
		t.Errorf("Expected 2 planned dates, got %d", len(retrieved.PlannedDates))
	}
	if retrieved.PlannedDates[0] != "2023-10-27" || retrieved.PlannedDates[1] != "2023-10-28" {
		t.Errorf("Planned dates mismatch: got %v", retrieved.PlannedDates)
	}

	// 3. Update dates
	retrieved.PlannedDates = []string{"2023-10-29"}
	err = UpdateIssue(context.Background(), &retrieved)
	if err != nil {
		t.Fatalf(failedToUpdateIssueError, err)
	}

	issues, _ = GetAllActiveIssues()
	if len(issues[0].PlannedDates) != 1 || issues[0].PlannedDates[0] != "2023-10-29" {
		t.Errorf("Expected updated date 2023-10-29, got %v", issues[0].PlannedDates)
	}
}

func TestGetAllActiveIssues(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue1 := &Issue{Title: "Issue 1", Status: StatusOpen, ProjectID: 1}
	issue2 := &Issue{Title: "Issue 2", Status: StatusOpen, ProjectID: 1}

	CreateIssue(context.Background(), issue1)
	CreateIssue(context.Background(), issue2)

	issues, err := GetAllActiveIssues()
	if err != nil {
		t.Fatalf(unexpectedGetAllIssuesError, err)
	}

	if len(issues) != 2 {
		t.Errorf("Expected 2 issues, got %d", len(issues))
	}
}

func TestUpdateIssue(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: "Original Title", Status: StatusOpen, ProjectID: 1}
	CreateIssue(context.Background(), issue)

	issue.Title = "Updated Title"
	err := UpdateIssue(context.Background(), issue)
	if err != nil {
		t.Fatalf(failedToUpdateIssueError, err)
	}

	issues, err := GetAllActiveIssues()
	if err != nil {
		t.Fatalf(unexpectedGetAllIssuesError, err)
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

	issue := &Issue{Title: "To Delete", Status: StatusOpen, ProjectID: 1}
	CreateIssue(context.Background(), issue)

	err := DeleteIssue(context.Background(), issue.ID)
	if err != nil {
		t.Fatalf("Failed to delete issue: %v", err)
	}

	issues, _ := GetAllActiveIssues()
	if len(issues) != 0 {
		t.Errorf("Expected 0 issues, got %d", len(issues))
	}
}

func TestGetArchivedIssues(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue1 := &Issue{Title: "Active Issue", Status: StatusOpen, ProjectID: 1}
	issue2 := &Issue{Title: "Archived Issue", Status: StatusArchive, ProjectID: 1}
	issue3 := &Issue{Title: "Another Archived", Status: StatusArchive, ProjectID: 1}
	CreateIssue(context.Background(), issue1)
	CreateIssue(context.Background(), issue2)
	CreateIssue(context.Background(), issue3)

	archived, err := GetAllArchivedIssues()
	if err != nil {
		t.Fatalf("Failed to get archived issues: %v", err)
	}

	if len(archived) != 2 {
		t.Errorf("Expected 2 archived issues, got %d", len(archived))
	}

	// Verify GetAllActiveIssues excludes archived
	active, err := GetAllActiveIssues()
	if err != nil {
		t.Fatalf(unexpectedGetAllIssuesError, err)
	}
	if len(active) != 1 {
		t.Errorf("Expected 1 active issue, got %d", len(active))
	}
}

func TestCreateTask(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	issue := &Issue{Title: "Issue for Task", Status: StatusOpen, ProjectID: 1}
	CreateIssue(context.Background(), issue)

	task := &Task{
		IssueID: issue.ID,
		Title:   testTaskTitle,
		Done:    false,
	}

	err := CreateTask(context.Background(), task)
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

	issue := &Issue{Title: "Issue with Tasks", Status: StatusOpen, ProjectID: 1}
	CreateIssue(context.Background(), issue)

	task1 := &Task{IssueID: issue.ID, Title: "Task 1"}
	task2 := &Task{IssueID: issue.ID, Title: "Task 2"}

	CreateTask(context.Background(), task1)
	CreateTask(context.Background(), task2)

	tasks, err := GetTasksByIssueID(context.Background(), issue.ID)
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

	issue := &Issue{Title: "Issue", Status: StatusOpen, ProjectID: 1}
	CreateIssue(context.Background(), issue)

	task := &Task{IssueID: issue.ID, Title: "Original Task"}
	CreateTask(context.Background(), task)

	task.Title = "Updated Task"
	task.Done = true
	err := UpdateTask(context.Background(), task, issue.ID)
	if err != nil {
		t.Fatalf("Failed to update task: %v", err)
	}

	tasks, _ := GetTasksByIssueID(context.Background(), issue.ID)
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

	issue := &Issue{Title: "Issue", Status: StatusOpen, ProjectID: 1}
	CreateIssue(context.Background(), issue)

	task := &Task{IssueID: issue.ID, Title: "To Delete"}
	CreateTask(context.Background(), task)

	err := DeleteTask(context.Background(), task.ID, issue.ID)
	if err != nil {
		t.Fatalf("Failed to delete task: %v", err)
	}

	tasks, _ := GetTasksByIssueID(context.Background(), issue.ID)
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
		{"GetAllActiveIssues", func() error { _, err := GetAllActiveIssues(); return err }},
		{"GetTasksByIssueID", func() error { _, err := GetTasksByIssueID(context.Background(), 1); return err }},
		{"CreateIssue", func() error { return CreateIssue(context.Background(), &Issue{Title: "T", ProjectID: 1}) }},
		{"UpdateIssue", func() error { return UpdateIssue(context.Background(), &Issue{ID: 1, Title: "T", ProjectID: 1}) }},
		{"DeleteIssue", func() error { return DeleteIssue(context.Background(), 1) }},
		{"CreateTask", func() error { return CreateTask(context.Background(), &Task{IssueID: 1, Title: "T"}) }},
		{"UpdateTask", func() error { return UpdateTask(context.Background(), &Task{ID: 1, Title: "T"}, 1) }},
		{"DeleteTask", func() error { return DeleteTask(context.Background(), 1, 1) }},
		{"CreateHistoryEntry", func() error {
			return CreateHistoryEntry(context.Background(), &HistoryEntry{IssueID: 1, Event: EventCreated})
		}},
		{"GetHistoryByIssueID", func() error { _, err := GetHistoryByIssueID(context.Background(), 1); return err }},
		{"CreateComment", func() error { return CreateComment(context.Background(), &Comment{IssueID: 1, Body: "T"}) }},
		{"GetCommentsByIssueID", func() error { _, err := GetCommentsByIssueID(context.Background(), 1); return err }},
		{"GetCommentByID", func() error { _, err := GetCommentByID(context.Background(), 1, 1); return err }},
		{"UpdateComment", func() error { return UpdateComment(context.Background(), 1, 1, nil, "T") }},
		{"DeleteComment", func() error { return DeleteComment(context.Background(), 1, 1, nil) }},
		{"GetLabelsByProject", func() error { _, err := GetLabelsByProject(context.Background(), 1); return err }},
		{"CreateLabel", func() error { return CreateLabel(context.Background(), &Label{Name: "L", ProjectID: 1}) }},
		{"DeleteLabel", func() error { return DeleteLabel(context.Background(), 1, 1) }},
		{"GetIssueByID", func() error { _, err := GetIssueByID(context.Background(), 1); return err }},
		{"GetAllArchivedIssues", func() error { _, err := GetAllArchivedIssues(); return err }},
		{"GetAllProjects", func() error { _, err := GetAllProjects(context.Background()); return err }},
		{"CreateProject", func() error { return CreateProject(context.Background(), &Project{Name: "P"}) }},
		{"UpdateProject", func() error { return UpdateProject(context.Background(), &Project{ID: 1, Name: "P"}) }},
		{"DeleteProject", func() error { return DeleteProject(context.Background(), 1) }},
		{"GetProjectByID", func() error { _, err := GetProjectByID(context.Background(), 1); return err }},
		{"CountIssuesByProject", func() error { _, err := CountIssuesByProject(context.Background(), 1); return err }},
		{"GetIssueByIDInProject", func() error { _, err := GetIssueByIDInProject(context.Background(), 1, 1); return err }},
		{"GetReleaseByIDInProject", func() error { _, err := GetReleaseByIDInProject(context.Background(), 1, 1); return err }},
		{"UserExists", func() error { _, err := UserExists(context.Background(), 1); return err }},
		{"UserExistsAndActive", func() error { _, err := UserExistsAndActive(context.Background(), 1); return err }},
		{"LabelExistsInProject", func() error { _, err := LabelExistsInProject(context.Background(), 1, 1); return err }},
		{"ProjectExists", func() error { _, err := ProjectExists(context.Background(), 1); return err }},
		{"ReleaseExistsInProject", func() error { _, err := ReleaseExistsInProject(context.Background(), 1, 1); return err }},
		{"CreateUser", func() error {
			return CreateUser(context.Background(), &User{Email: "x@y.z", FirstName: "F", LastName: "L", PasswordHash: "h", Role: RoleUser})
		}},
		{"GetUserByEmail", func() error { _, err := GetUserByEmail(context.Background(), "x@y.z"); return err }},
		{"GetUserByID", func() error { _, err := GetUserByID(context.Background(), 1); return err }},
		{"GetAllUsers", func() error { _, err := GetAllUsers(context.Background()); return err }},
		{"UpdateUser", func() error {
			return UpdateUser(context.Background(), &User{ID: 1, Email: "x@y.z", FirstName: "F", LastName: "L", PasswordHash: "h", Role: RoleUser})
		}},
		{"CountUsers", func() error { _, err := CountUsers(context.Background()); return err }},
		{"CountActiveSysAdmins", func() error { _, err := CountActiveSysAdmins(context.Background()); return err }},
		{"CreateSession", func() error {
			return CreateSession(context.Background(), &Session{UserID: 1, TokenHash: "h", ExpiresAt: time.Now().Add(time.Hour)})
		}},
		{"GetSessionByID", func() error { _, err := GetSessionByID(context.Background(), 1); return err }},
		{"UpdateSession", func() error {
			return UpdateSession(context.Background(), &Session{ID: 1, TokenHash: "h", ExpiresAt: time.Now().Add(time.Hour)})
		}},
		{"DeleteSession", func() error { return DeleteSession(context.Background(), 1) }},
		{"DeleteSessionsByUserID", func() error { return DeleteSessionsByUserID(context.Background(), 1) }},
		{"DeleteExpiredSessions", func() error { _, err := DeleteExpiredSessions(context.Background()); return err }},
		{"CreateRelease", func() error { return CreateRelease(context.Background(), &Release{ProjectID: 1, Name: "R"}) }},
		{"GetReleasesByProject", func() error { _, err := GetReleasesByProject(context.Background(), 1); return err }},
		{"GetReleaseByID", func() error { _, err := GetReleaseByID(context.Background(), 1); return err }},
		{"UpdateRelease", func() error { return UpdateRelease(context.Background(), &Release{ID: 1, Name: "R"}) }},
		{"DeleteRelease", func() error { return DeleteRelease(context.Background(), 1) }},
		{"ReopenRelease", func() error { return ReopenRelease(context.Background(), 1) }},
		{"TriggerRelease", func() error { return TriggerRelease(context.Background(), 1, false) }},
	}

	for _, tt := range tests {
		t.Run(tt.name+"_Error", func(t *testing.T) {
			if tt.f() == nil {
				t.Error("expected error, got nil")
			}
		})
	}
}

const notAnInt = "not-an-int"

func TestDBScanErrors(t *testing.T) {
	// Use a private, non-shared in-memory DB for these tests to avoid polluting other tests
	oldDB := DB
	defer func() { DB = oldDB }()

	tests := []struct {
		name string
		fn   func(*testing.T) error
	}{
		{"GetAllActiveIssues_ScanError", scanErrorGetAllActiveIssues},
		{"GetTasksByIssueID_ScanError", scanErrorGetTasksByIssueID},
		{"GetAllLabels_ScanError", scanErrorGetAllLabels},
		{"GetArchivedIssues_ScanError", scanErrorGetArchivedIssues},
		{"GetIssueByID_ScanError", scanErrorGetIssueByID},
		{"GetAllProjects_ScanError", scanErrorGetAllProjects},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Reset DB for each subtest
			testDBCounter++
			if err := InitDB(context.Background(), fmt.Sprintf(testDBURI, testDBCounter)); err != nil {
				t.Fatalf(initDBErrorMsg, err)
			}
			defer DB.Close()
			if err := tt.fn(t); err != nil {
				t.Fatalf("Setup failed: %v", err)
			}
		})
	}
}

const (
	insertMockIssueQuery = "INSERT INTO issues(id, title, status, position, project_id) VALUES(1, 'T', 'todo', 1, 1)"
)

func scanErrorGetAllActiveIssues(t *testing.T) error {
	if _, err := DB.Exec("INSERT INTO issues(title, status, position, project_id) VALUES(?, ?, ?, ?)", "T", "todo", notAnInt, 1); err != nil {
		return err
	}
	if _, err := GetAllActiveIssues(); err == nil {
		t.Error(expectedScanError)
	}
	return nil
}

func scanErrorGetTasksByIssueID(t *testing.T) error {
	if _, err := DB.Exec(insertMockIssueQuery); err != nil {
		return err
	}
	// Tasks schema expects integer/real for position, but we force text.
	// However, sqlite might coerce. Let's drop and recreate to be sure we have a TEXT column which allows "not-an-int"
	// and still is scanned into int struct field.
	if _, err := DB.Exec(dropTasksTable); err != nil {
		return err
	}
	if _, err := DB.Exec("CREATE TABLE tasks (id INTEGER PRIMARY KEY, issue_id INTEGER, title TEXT, done BOOLEAN, position TEXT, deadline DATETIME, created_at DATETIME, updated_at DATETIME)"); err != nil {
		return err
	}

	if _, err := DB.Exec("INSERT INTO tasks(issue_id, title, position) VALUES(1, 'T', ?)", notAnInt); err != nil {
		return err
	}
	if _, err := GetTasksByIssueID(context.Background(), 1); err == nil {
		t.Error(expectedScanError)
	}
	return nil
}

func scanErrorGetAllLabels(t *testing.T) error {
	if _, err := DB.Exec("INSERT INTO labels(name, color, project_id) VALUES(?, ?, ?)", "L", "#000", 1); err != nil {
		return err
	}
	if _, err := DB.Exec("DROP TABLE labels"); err != nil {
		return err
	}
	if _, err := DB.Exec("CREATE TABLE labels (id TEXT, name TEXT, color TEXT, project_id INTEGER)"); err != nil {
		return err
	}
	if _, err := DB.Exec("INSERT INTO labels(id, name, color, project_id) VALUES(?, ?, ?, ?)", notAnInt, "L", "#000", 1); err != nil {
		return err
	}
	if _, err := GetLabelsByProject(context.Background(), 1); err == nil {
		t.Error(expectedScanError)
	}
	return nil
}

func scanErrorGetArchivedIssues(t *testing.T) error {
	if _, err := DB.Exec("INSERT INTO issues(title, status, position, project_id) VALUES(?, ?, ?, ?)", "T", "Archive", 1, 1); err != nil {
		return err
	}
	if _, err := DB.Exec("DROP TABLE issues"); err != nil {
		return err
	}
	if _, err := DB.Exec("CREATE TABLE issues (id TEXT, title TEXT, description TEXT, status TEXT, position INTEGER, deadline DATETIME, planned_dates TEXT, label_id INTEGER, priority TEXT, creator_id INTEGER, assignee_id INTEGER, updated_by INTEGER, project_id INTEGER, created_at DATETIME, updated_at DATETIME)"); err != nil {
		return err
	}
	if _, err := DB.Exec("INSERT INTO issues(id, title, status) VALUES(?, ?, ?)", notAnInt, "T", "Archive"); err != nil {
		return err
	}

	if _, err := GetAllArchivedIssues(); err == nil {
		t.Error(expectedScanError)
	}
	return nil
}

func scanErrorGetIssueByID(t *testing.T) error {
	if _, err := DB.Exec("DROP TABLE issues"); err != nil {
		return err
	}
	// id must be INTEGER or compatible for lookup to find it easily, but we want to break scan.
	// Let's break position scan.
	if _, err := DB.Exec("CREATE TABLE issues (id INTEGER PRIMARY KEY, title TEXT, description TEXT, status TEXT, position TEXT, deadline DATETIME, planned_dates TEXT, label_id INTEGER, priority TEXT, creator_id INTEGER, assignee_id INTEGER, updated_by INTEGER, project_id INTEGER, created_at DATETIME, updated_at DATETIME)"); err != nil {
		return err
	}
	if _, err := DB.Exec("INSERT INTO issues(id, title, position, project_id) VALUES(1, 'T', ?, 1)", notAnInt); err != nil {
		return err
	}

	if _, err := GetIssueByID(context.Background(), 1); err == nil {
		t.Error(expectedScanError)
	}
	return nil
}

func TestDBConstraintErrors(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	const foreignKeyConst = "PRAGMA foreign_keys = ON"
	const expectedErr = "expected constraint error, got nil"

	t.Run("CreateIssue_ExecError", func(t *testing.T) {
		_, _ = DB.Exec(foreignKeyConst)
		if CreateIssue(context.Background(), &Issue{Title: "T", Status: "todo", ProjectID: 1, Label: &Label{ID: 999}}) == nil {
			t.Error(expectedErr)
		}
	})

	t.Run("UpdateIssue_ExecError", func(t *testing.T) {
		setupTestDB()
		_, _ = DB.Exec(foreignKeyConst)
		CreateIssue(context.Background(), &Issue{Title: "T", Status: "todo", ProjectID: 1})
		if UpdateIssue(context.Background(), &Issue{ID: 1, Title: "T", Status: "todo", ProjectID: 1, Label: &Label{ID: 999}}) == nil {
			t.Error(expectedErr)
		}
	})

	t.Run("CreateTask_ExecError", func(t *testing.T) {
		setupTestDB()
		_, _ = DB.Exec(foreignKeyConst)
		if CreateTask(context.Background(), &Task{IssueID: 999, Title: "T"}) == nil {
			t.Error(expectedErr)
		}
	})

	t.Run("CreateLabel_ExecError", func(t *testing.T) {
		// name is NOT NULL. In sqlite3 driver, we can trigger this by passing nil?
		// Actually, let's try something else. Duplicate ID?
		setupTestDB()
		_, _ = DB.Exec("INSERT INTO labels(id, name, color) VALUES(1, 'L', '#000')")
		_ = CreateLabel(context.Background(), &Label{ID: 1, Name: "L2", Color: "#111"})

		// Let's force it to fail by making it too long? No SQLite doesn't care.
		// How about a unique constraint?
		_, _ = DB.Exec("CREATE UNIQUE INDEX idx_labels_name ON labels(name)")
		if CreateLabel(context.Background(), &Label{Name: "L", Color: "#000"}) == nil {
			t.Error(expectedErr)
		}
	})
}

func TestDBNotFoundErrors(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	const expectedErr = "expected not found error, got nil"

	t.Run("UpdateIssue_NotFound", func(t *testing.T) {
		if UpdateIssue(context.Background(), &Issue{ID: 999, Title: "T"}) == nil {
			t.Error(expectedErr)
		}
	})

	t.Run("DeleteIssue_NotFound", func(t *testing.T) {
		if DeleteIssue(context.Background(), 999) == nil {
			t.Error(expectedErr)
		}
	})

	t.Run("CreateTask_IssueNotFound", func(t *testing.T) {
		if CreateTask(context.Background(), &Task{IssueID: 999, Title: "T"}) == nil {
			t.Error(expectedErr)
		}
	})

	t.Run("UpdateTask_NotFound", func(t *testing.T) {
		if UpdateTask(context.Background(), &Task{ID: 999, Title: "T"}, 1) == nil {
			t.Error(expectedErr)
		}
	})

	t.Run("DeleteTask_NotFound", func(t *testing.T) {
		if DeleteTask(context.Background(), 999, 1) == nil {
			t.Error(expectedErr)
		}
	})

	t.Run("DeleteLabel_NotFound", func(t *testing.T) {
		if DeleteLabel(context.Background(), 999, 1) == nil {
			t.Error(expectedErr)
		}
	})
}

func TestScanIssueInvalidJSON(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// Manually insert invalid JSON into planned_dates
	_, err := DB.Exec("INSERT INTO issues (title, description, status, position, planned_dates, project_id) VALUES (?, ?, ?, ?, ?, ?)", "Invalid JSON Issue", "", "todo", 1, "{invalid-json}", 1)
	if err != nil {
		t.Fatal(err)
	}

	// Should not crash and should return issue with empty dates
	issues, err := GetAllActiveIssues()
	if err != nil {
		t.Fatal(err)
	}

	if len(issues) != 1 {
		t.Fatalf("Expected 1 issue")
	}

	if len(issues[0].PlannedDates) != 0 {
		t.Errorf("Expected 0 planned dates due to parse error, got %d", len(issues[0].PlannedDates))
	}

	// Also test GetIssueByID with invalid JSON
	issue, err := GetIssueByID(context.Background(), 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(issue.PlannedDates) != 0 {
		t.Errorf("Expected 0 planned dates due to parse error, got %d", len(issue.PlannedDates))
	}
}

func TestInitDBFileCreation(t *testing.T) {
	tempFile := "test_init_db.db"
	defer os.Remove(tempFile)

	// InitDB might call os.Exit(1) on failure, which is hard to test in-process.
	// But we can test the "new database" logging branch and file creation.
	if err := InitDB(context.Background(), tempFile); err != nil {
		t.Fatalf(initDBErrorMsg, err)
	}
	defer DB.Close()

	if _, err := os.Stat(tempFile); os.IsNotExist(err) {
		t.Error("Expected database file to be created")
	}
}

func TestInitDBError(t *testing.T) {
	// Attempt to init DB in a read-only directory or invalid path
	// For example, trying to open a directory as a file
	dir := "test_dir_db"
	os.Mkdir(dir, 0755)
	defer os.Remove(dir)

	// Attempts to open directory as DB file should fail on most OSs or at least fail to create tables if it somehow opens?
	// Actually sqlite3 might open it?
	// Let's use an invalid path, like a file inside a non-existent directory?
	// No, sqlite3 might fail to create it.

	// Let's try opening a file where we don't have write permissions?
	// Or simply an invalid DSN that sqlite3 rejects?
	// "file::memory:?mode=ro" implies read-only, so createTables should fail!

	err := InitDB(context.Background(), "file::memory:?mode=ro")
	if err == nil {
		t.Error("Expected error when initializing read-only DB (create tables should fail), got nil")
	}
}

func TestGetIssueByID(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// 1. Not Found
	issue, err := GetIssueByID(context.Background(), 999)
	if err != nil {
		t.Fatalf("Expected nil error for not found, got %v", err)
	}
	if issue != nil {
		t.Errorf("Expected nil issue for not found, got %v", issue)
	}

	// 2. Success
	newIssue := &Issue{Title: testIssueTitle, Status: StatusOpen, ProjectID: 1}
	if err := CreateIssue(context.Background(), newIssue); err != nil {
		t.Fatalf("Failed to create issue: %v", err)
	}

	storedIssue, err := GetIssueByID(context.Background(), newIssue.ID)
	if err != nil {
		t.Fatalf("Failed to get issue: %v", err) // Covered by TestDBErrors
	}
	if storedIssue.Title != testIssueTitle {
		t.Errorf("Expected title '%s', got '%s'", testIssueTitle, storedIssue.Title)
	}
}

// --- Session DB Tests ---

func TestSessionCRUD(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	userID := 1
	// Need a user for FK constraint
	hash, _ := HashPassword("pass")
	CreateUser(context.Background(), &User{Email: "s@test.com", FirstName: "S", LastName: "U", PasswordHash: hash, Role: RoleUser, Active: true})

	session := &Session{
		UserID:    userID,
		TokenHash: "hash123",
		ExpiresAt: time.Now().Add(1 * time.Hour),
	}

	// 1. Create
	if err := CreateSession(context.Background(), session); err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}
	if session.ID == 0 {
		t.Error("expected session ID to be set")
	}

	// 2. Get
	retrieved, err := GetSessionByID(context.Background(), session.ID)
	if err != nil {
		t.Fatalf("GetSessionByID failed: %v", err)
	}
	if retrieved.TokenHash != "hash123" {
		t.Errorf("expected hash 'hash123', got '%s'", retrieved.TokenHash)
	}

	// 3. Update
	session.TokenHash = "newhash"
	if err := UpdateSession(context.Background(), session); err != nil {
		t.Fatalf("UpdateSession failed: %v", err)
	}
	updated, _ := GetSessionByID(context.Background(), session.ID)
	if updated.TokenHash != "newhash" {
		t.Errorf("expected updated hash 'newhash', got '%s'", updated.TokenHash)
	}

	// 4. Delete
	if err := DeleteSession(context.Background(), session.ID); err != nil {
		t.Fatalf("DeleteSession failed: %v", err)
	}
	deleted, _ := GetSessionByID(context.Background(), session.ID)
	if deleted != nil {
		t.Error("expected session to be deleted")
	}
}

func TestSessionNotFound(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// Update non-existent
	err := UpdateSession(context.Background(), &Session{ID: 999, TokenHash: "h", ExpiresAt: time.Now()})
	if !errors.Is(err, ErrSessionNotFound) {
		t.Errorf("expected ErrSessionNotFound, got %v", err)
	}

	// Delete non-existent
	err = DeleteSession(context.Background(), 999)
	if !errors.Is(err, ErrSessionNotFound) {
		t.Errorf("expected ErrSessionNotFound, got %v", err)
	}
}

func TestDeleteSessionsByUserID(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	hash, _ := HashPassword("pass")
	CreateUser(context.Background(), &User{Email: "u@test.com", FirstName: "U", LastName: "1", PasswordHash: hash, Role: RoleUser, Active: true})
	userID := 1

	// Create 2 sessions
	CreateSession(context.Background(), &Session{UserID: userID, TokenHash: "1", ExpiresAt: time.Now()})
	CreateSession(context.Background(), &Session{UserID: userID, TokenHash: "2", ExpiresAt: time.Now()})

	if err := DeleteSessionsByUserID(context.Background(), userID); err != nil {
		t.Fatalf("DeleteSessionsByUserID failed: %v", err)
	}

	// Verify emptiness (using raw query since we don't have GetAllSessions)
	var count int
	DB.QueryRow("SELECT COUNT(*) FROM sessions WHERE user_id = ?", userID).Scan(&count)
	if count != 0 {
		t.Errorf("expected 0 sessions, got %d", count)
	}
}

func TestDeleteExpiredSessions(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	hash, _ := HashPassword("pass")
	CreateUser(context.Background(), &User{Email: "e@test.com", FirstName: "E", LastName: "X", PasswordHash: hash, Role: RoleUser, Active: true})

	// 1 expired, 1 active
	CreateSession(context.Background(), &Session{UserID: 1, TokenHash: "exp", ExpiresAt: time.Now().Add(-1 * time.Hour)})
	CreateSession(context.Background(), &Session{UserID: 1, TokenHash: "act", ExpiresAt: time.Now().Add(1 * time.Hour)})

	deletedCount, err := DeleteExpiredSessions(context.Background())
	if err != nil {
		t.Fatalf("DeleteExpiredSessions failed: %v", err)
	}
	if deletedCount != 1 {
		t.Errorf("expected 1 deleted session, got %d", deletedCount)
	}

	var count int
	DB.QueryRow("SELECT COUNT(*) FROM sessions").Scan(&count)
	if count != 1 {
		t.Errorf("expected 1 remaining session, got %d", count)
	}
}

// --- User Assignment & Label DB Tests ---

func TestCreateIssueWithCreatorAndAssignee(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// Create users
	creator := &User{Email: "creator@test.com", FirstName: "Creator", LastName: "User", Role: RoleUser}
	assignee := &User{Email: "assignee@test.com", FirstName: "Assignee", LastName: "User", Role: RoleUser}
	CreateUser(context.Background(), creator)
	CreateUser(context.Background(), assignee)

	issue := &Issue{
		Title:      "Assigned Issue",
		Status:     StatusOpen,
		ProjectID:  1,
		CreatorID:  creator.ID,
		AssigneeID: &assignee.ID,
	}

	if err := CreateIssue(context.Background(), issue); err != nil {
		t.Fatalf(failedToCreateIssueError, err)
	}

	// Verify DB values
	stored, err := GetIssueByID(context.Background(), issue.ID)
	if err != nil {
		t.Fatalf("Failed to get issue: %v", err)
	}

	if stored.CreatorID != creator.ID {
		t.Errorf("Expected CreatorID %d, got %d", creator.ID, stored.CreatorID)
	}
	if stored.AssigneeID == nil || *stored.AssigneeID != assignee.ID {
		t.Errorf("Expected AssigneeID %d, got %v", assignee.ID, stored.AssigneeID)
	}

	// Verify User Struct populated
	if stored.Assignee == nil || stored.Assignee.Email != assignee.Email {
		t.Error("Expected Assignee struct to be populated")
	}
}

func TestUpdateIssueAssignee(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// Create users
	user1 := &User{Email: "u1@test.com", FirstName: "User", LastName: "One", Role: RoleUser}
	user2 := &User{Email: "u2@test.com", FirstName: "User", LastName: "Two", Role: RoleUser}
	CreateUser(context.Background(), user1)
	CreateUser(context.Background(), user2)

	// Create issue assigned to user1
	issue := &Issue{
		Title:      "Transfer Issue",
		Status:     StatusOpen,
		ProjectID:  1,
		AssigneeID: &user1.ID,
	}
	CreateIssue(context.Background(), issue)

	// Update assignee to user2
	issue.AssigneeID = &user2.ID
	if err := UpdateIssue(context.Background(), issue); err != nil {
		t.Fatalf(failedToUpdateIssueError, err)
	}

	stored, _ := GetIssueByID(context.Background(), issue.ID)
	if stored.AssigneeID == nil || *stored.AssigneeID != user2.ID {
		t.Errorf("Expected AssigneeID to be %d, got %v", user2.ID, stored.AssigneeID)
	}
	if stored.Assignee.Email != user2.Email {
		t.Errorf("Expected Assignee email %s, got %s", user2.Email, stored.Assignee.Email)
	}
}

func TestUpdateIssueUnassign(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	user1 := &User{Email: "u1@test.com", FirstName: "User", LastName: "One", Role: RoleUser}
	CreateUser(context.Background(), user1)

	issue := &Issue{Title: "Unassign Issue", Status: StatusOpen, ProjectID: 1, AssigneeID: &user1.ID}
	CreateIssue(context.Background(), issue)

	// Unassign
	issue.AssigneeID = nil
	if err := UpdateIssue(context.Background(), issue); err != nil {
		t.Fatalf(failedToUpdateIssueError, err)
	}

	stored, _ := GetIssueByID(context.Background(), issue.ID)
	if stored.AssigneeID != nil {
		t.Errorf("Expected AssigneeID to be nil, got %d", *stored.AssigneeID)
	}
	if stored.Assignee != nil {
		t.Errorf("Expected Assignee struct to be nil, got %v", stored.Assignee)
	}
}

func TestLabelsCRUD(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// 1. Test CreateLabel
	l := &Label{Name: "Bug", Color: "#ff0000", ProjectID: 1}
	err := CreateLabel(context.Background(), l)
	if err != nil {
		t.Fatalf("Failed to create label: %v", err)
	}
	if l.ID == 0 {
		t.Errorf("Expected Label ID to be set, got 0")
	}

	// 2. Test GetLabelsByProject
	labels, err := GetLabelsByProject(context.Background(), 1)
	if err != nil {
		t.Fatalf("Failed to get labels: %v", err)
	}
	if len(labels) != 1 {
		t.Errorf("Expected 1 label, got %d", len(labels))
	}
	if labels[0].Name != "Bug" {
		t.Errorf("Expected label name 'Bug', got '%s'", labels[0].Name)
	}

	// 3. Test DeleteLabel
	err = DeleteLabel(context.Background(), l.ID, 1)
	if err != nil {
		t.Fatalf("Failed to delete label: %v", err)
	}

	labels, err = GetLabelsByProject(context.Background(), 1)
	if err != nil {
		t.Fatalf("Failed to get labels after delete: %v", err)
	}
	if len(labels) != 0 {
		t.Errorf("Expected 0 labels, got %d", len(labels))
	}
}

func TestLabelAssociation(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// Create Label
	lbl := &Label{Name: "Feature", Color: "#00ff00", ProjectID: 1}
	if err := CreateLabel(context.Background(), lbl); err != nil {
		t.Fatalf("Failed to create label: %v", err)
	}

	// Create Issue with Label
	issue := &Issue{
		Title:     "Issue with Label",
		Status:    StatusOpen,
		ProjectID: 1,
		Label:     lbl,
	}
	if err := CreateIssue(context.Background(), issue); err != nil {
		t.Fatalf(failedToCreateIssueError, err)
	}

	// Verify Association
	fetchedIssues, err := GetAllActiveIssues()
	if err != nil {
		t.Fatalf("Failed to fetch issues: %v", err)
	}
	if len(fetchedIssues) != 1 {
		t.Fatalf(expectedOneIssueMsg, len(fetchedIssues))
	}
	if fetchedIssues[0].Label == nil {
		t.Errorf("Expected issue to have label, got nil")
	} else if fetchedIssues[0].Label.ID != lbl.ID {
		t.Errorf("Expected label ID %d, got %d", lbl.ID, fetchedIssues[0].Label.ID)
	}

	// Delete Label and verify ON DELETE SET NULL
	if err := DeleteLabel(context.Background(), lbl.ID, 1); err != nil {
		t.Fatalf("Failed to delete label: %v", err)
	}

	fetchedIssues, err = GetAllActiveIssues()
	if err != nil {
		t.Fatalf("Failed to fetch issues: %v", err)
	}
	if len(fetchedIssues) != 1 {
		t.Fatalf(expectedOneIssueMsg, len(fetchedIssues))
	}

	// The label pointer itself might be nil or the struct might be empty depending on implementation?
	// In db.go GetAllActiveIssues, we check `if lID.Valid`. If label deleted -> lID is NULL -> i.Label is nil.
	if fetchedIssues[0].Label != nil {
		t.Errorf("Expected issue label to be nil after label deletion (SET NULL), got %v", fetchedIssues[0].Label)
	}
}

func TestProjectsCRUD(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// 0. Ensure default project exists (seeded in InitDB)
	projects, _ := GetAllProjects(context.Background())
	if len(projects) != 1 {
		t.Errorf("Expected 1 project (default) at start, got %d", len(projects))
	}

	// 1. CreateProject
	p := &Project{Name: "Project A", Description: "Desc A"}
	err := CreateProject(context.Background(), p)
	if err != nil {
		t.Fatalf("Failed to create project: %v", err)
	}
	if p.ID == 0 {
		t.Errorf("Expected project ID to be set, got 0")
	}

	// 2. GetProjectByID
	retrieved, err := GetProjectByID(context.Background(), p.ID)
	if err != nil {
		t.Fatalf("GetProjectByID failed: %v", err)
	}
	if retrieved == nil || retrieved.Name != "Project A" {
		t.Errorf("Expected project 'Project A', got %v", retrieved)
	}

	// 3. GetAllProjects
	projects, err = GetAllProjects(context.Background())
	if err != nil {
		t.Fatalf("GetAllProjects failed: %v", err)
	}
	if len(projects) != 2 {
		t.Errorf("Expected 2 projects, got %d", len(projects))
	}

	// 4. UpdateProject
	p.Name = "Updated Project"
	err = UpdateProject(context.Background(), p)
	if err != nil {
		t.Fatalf("UpdateProject failed: %v", err)
	}
	updated, _ := GetProjectByID(context.Background(), p.ID)
	if updated.Name != "Updated Project" {
		t.Errorf("Expected name 'Updated Project', got '%s'", updated.Name)
	}

	// 5. CountIssuesByProject
	count, _ := CountIssuesByProject(context.Background(), p.ID)
	if count != 0 {
		t.Errorf("Expected 0 issues for new project, got %d", count)
	}

	// Create an issue for this project
	issue := &Issue{Title: "P Issue", Status: StatusOpen, ProjectID: p.ID}
	CreateIssue(context.Background(), issue)
	count, _ = CountIssuesByProject(context.Background(), p.ID)
	if count != 1 {
		t.Errorf(expectedOneIssueMsg, count)
	}

	// Attempt to delete project with issue (should fail due to FK)
	err = DeleteProject(context.Background(), p.ID)
	if err == nil {
		t.Errorf("Expected FK error when deleting project with issues, got nil")
	}

	// Delete issue first
	DeleteIssue(context.Background(), issue.ID)

	// 6. DeleteProject
	err = DeleteProject(context.Background(), p.ID)
	if err != nil {
		t.Fatalf("DeleteProject failed: %v", err)
	}
	deleted, _ := GetProjectByID(context.Background(), p.ID)
	if deleted != nil {
		t.Errorf("Expected nil after deletion, got %v", deleted)
	}
}

// assertLastLoginNilEverywhere checks that a user's LastLogin is nil across
// every read path: GetUserByEmail, GetUserByID, and GetAllUsers.
func assertLastLoginNilEverywhere(t *testing.T, email string, userID int) {
	t.Helper()

	byEmail, err := GetUserByEmail(context.Background(), email)
	if err != nil {
		t.Fatalf("GetUserByEmail failed: %v", err)
	}
	if byEmail.LastLogin != nil {
		t.Errorf("Expected nil LastLogin for new user, got %v", byEmail.LastLogin)
	}

	byID, err := GetUserByID(context.Background(), userID)
	if err != nil {
		t.Fatalf("GetUserByID failed: %v", err)
	}
	if byID.LastLogin != nil {
		t.Errorf("Expected nil LastLogin for new user, got %v", byID.LastLogin)
	}

	listed := findUserByEmail(t, email)
	if listed.LastLogin != nil {
		t.Errorf("Expected nil LastLogin for new user in GetAllUsers, got %v", listed.LastLogin)
	}
}

// assertLastLoginSetEverywhere checks that a user's LastLogin is non-nil across
// every read path, and that the value from GetUserByEmail falls within [before, after].
func assertLastLoginSetEverywhere(t *testing.T, email string, userID int, before, after time.Time) {
	t.Helper()

	byEmail, err := GetUserByEmail(context.Background(), email)
	if err != nil {
		t.Fatalf("GetUserByEmail failed: %v", err)
	}
	if byEmail.LastLogin == nil {
		t.Fatal("Expected non-nil LastLogin after UpdateUserLastLogin")
	}
	if byEmail.LastLogin.Before(before) || byEmail.LastLogin.After(after) {
		t.Errorf("LastLogin %v not within expected window [%v, %v]", byEmail.LastLogin, before, after)
	}

	byID, err := GetUserByID(context.Background(), userID)
	if err != nil {
		t.Fatalf("GetUserByID failed: %v", err)
	}
	if byID.LastLogin == nil {
		t.Error("Expected non-nil LastLogin from GetUserByID after UpdateUserLastLogin")
	}

	listed := findUserByEmail(t, email)
	if listed.LastLogin == nil {
		t.Error("Expected non-nil LastLogin from GetAllUsers after UpdateUserLastLogin")
	}
}

// findUserByEmail returns the user with the given email from GetAllUsers,
// failing the test if the user isn't listed.
func findUserByEmail(t *testing.T, email string) User {
	t.Helper()

	all, err := GetAllUsers(context.Background())
	if err != nil {
		t.Fatalf("GetAllUsers failed: %v", err)
	}
	for _, listed := range all {
		if listed.Email == email {
			return listed
		}
	}
	t.Fatalf("Test user %q not found in GetAllUsers", email)
	return User{}
}

func TestUpdateUserLastLogin(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	hash, _ := HashPassword(testPassword)
	u := &User{Email: testEmail, FirstName: "Test", LastName: "User", PasswordHash: hash, Role: RoleUser, Active: true}
	if err := CreateUser(context.Background(), u); err != nil {
		t.Fatalf("Failed to create user: %v", err)
	}

	// 1. Newly created users have no last_login, across every read path.
	assertLastLoginNilEverywhere(t, testEmail, u.ID)

	// 2. UpdateUserLastLogin stamps the current time, reflected everywhere.
	before := time.Now().UTC().Add(-time.Second)
	if err := UpdateUserLastLogin(context.Background(), u.ID); err != nil {
		t.Fatalf("UpdateUserLastLogin failed: %v", err)
	}
	after := time.Now().UTC().Add(time.Second)
	assertLastLoginSetEverywhere(t, testEmail, u.ID, before, after)

	// 3. Updating a non-existent user is a no-op, not an error.
	if err := UpdateUserLastLogin(context.Background(), 999999); err != nil {
		t.Errorf("UpdateUserLastLogin for nonexistent user should not error, got %v", err)
	}
}

func TestMigrateUsersAddLastLogin(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// Simulate a pre-1.3.2 database: drop the last_login column that InitDB
	// already created, matching the state runMigrations must upgrade from.
	if _, err := DB.Exec("ALTER TABLE users DROP COLUMN last_login"); err != nil {
		t.Fatalf("Failed to drop last_login column for test setup: %v", err)
	}

	var count int
	if err := DB.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('users') WHERE name='last_login'`).Scan(&count); err != nil {
		t.Fatalf("Failed to check column: %v", err)
	}
	if count != 0 {
		t.Fatalf("Expected last_login column to be absent before migration, found %d", count)
	}

	// 1. Migration adds the column.
	if err := migrateUsersAddLastLogin(context.Background()); err != nil {
		t.Fatalf("migrateUsersAddLastLogin failed: %v", err)
	}
	if err := DB.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('users') WHERE name='last_login'`).Scan(&count); err != nil {
		t.Fatalf("Failed to check column: %v", err)
	}
	if count != 1 {
		t.Errorf("Expected last_login column to exist after migration, found %d", count)
	}

	// 2. Migration is idempotent — running it again on an already-migrated DB is a no-op.
	if err := migrateUsersAddLastLogin(context.Background()); err != nil {
		t.Errorf("Second migrateUsersAddLastLogin call should be a no-op, got error: %v", err)
	}
}

func TestProjectErrors(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// 1. Create duplicate project name
	p1 := &Project{Name: "Dup", Description: "D1"}
	CreateProject(context.Background(), p1)
	p2 := &Project{Name: "Dup", Description: "D2"}
	err := CreateProject(context.Background(), p2)
	if !errors.Is(err, ErrDuplicateProjectName) {
		t.Errorf("Expected ErrDuplicateProjectName for duplicate project name, got %v", err)
	}

	// 2. Update to duplicate name
	p3 := &Project{Name: "Project 3", Description: "D3"}
	CreateProject(context.Background(), p3)
	p3.Name = "Dup"
	err = UpdateProject(context.Background(), p3)
	if !errors.Is(err, ErrDuplicateProjectName) {
		t.Errorf("Expected ErrDuplicateProjectName for duplicate project name on update, got %v", err)
	}

	// 3. Update non-existent
	err = UpdateProject(context.Background(), &Project{ID: 999, Name: "Non-existent"})
	if !errors.Is(err, ErrProjectNotFound) {
		t.Errorf("Expected ErrProjectNotFound for updating non-existent project, got %v", err)
	}

	// 4. Delete non-existent
	err = DeleteProject(context.Background(), 999)
	if !errors.Is(err, ErrProjectNotFound) {
		t.Errorf("Expected ErrProjectNotFound for deleting non-existent project, got %v", err)
	}

	// 5. Get non-existent
	ret, err := GetProjectByID(context.Background(), 9999)
	if err != nil {
		t.Errorf("Expected nil error for non-existent ID, got %v", err)
	}
	if ret != nil {
		t.Errorf("Expected nil project, got %v", ret)
	}
}

func scanErrorGetAllProjects(t *testing.T) error {
	if _, err := DB.Exec("INSERT INTO projects(name) VALUES(?)", "P"); err != nil {
		return err
	}
	if _, err := DB.Exec("DROP TABLE projects"); err != nil {
		return err
	}
	if _, err := DB.Exec("CREATE TABLE projects (id TEXT, name TEXT, description TEXT)"); err != nil {
		return err
	}
	if _, err := DB.Exec("INSERT INTO projects(id, name) VALUES(?, ?)", notAnInt, "P"); err != nil {
		return err
	}
	if _, err := GetAllProjects(context.Background()); err == nil {
		t.Error(expectedScanError)
	}
	return nil
}

func TestScanIssueNulls(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// Create issue with all optional fields null (project_id defaults to 1)
	_, err := DB.Exec(`INSERT INTO issues (title, status, position, project_id) VALUES (?, ?, ?, ?)`, "Null fields", StatusOpen, 1, 1)
	if err != nil {
		t.Fatal(err)
	}

	issues, err := GetAllActiveIssues()
	if err != nil {
		t.Fatal(err)
	}
	if len(issues) == 0 {
		t.Fatalf("Expected issues")
	}
	// Find our issue
	var found bool
	for _, i := range issues {
		if i.Title == "Null fields" {
			found = true
			if i.Label != nil || i.Assignee != nil {
				t.Errorf("Expected nil for optional fields, got Label:%v, Assignee:%v", i.Label, i.Assignee)
			}
			break
		}
	}
	if !found {
		t.Error("Did not find the issue with null fields")
	}
}

// ---------------------------------------------------------------------------
// GetStatusConfig / UpsertStatusConfig
// ---------------------------------------------------------------------------

func TestGetStatusConfigReturnsDefaultsWhenNoRow(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// Delete the seeded row so no row exists for project 1.
	if _, err := DB.Exec("DELETE FROM project_status_config WHERE project_id = 1"); err != nil {
		t.Fatalf("failed to delete seeded row: %v", err)
	}

	cfg, err := GetStatusConfig(context.Background(), 1)
	if err != nil {
		t.Fatalf(errUnexpected, err)
	}
	if cfg.ProjectID != 1 {
		t.Errorf("expected ProjectID 1, got %d", cfg.ProjectID)
	}
	if cfg.Stage1Name != "Pending" || cfg.Stage2Name != "Working" {
		t.Errorf("expected default names, got %+v", cfg)
	}
	if cfg.Stage3Name != "" || cfg.Stage4Name != "" {
		t.Errorf("expected empty stage 3/4, got %+v", cfg)
	}
}

func TestGetStatusConfigReturnsStoredValues(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	stored := &StatusConfig{ProjectID: 1, Stage1Name: "Review", Stage2Name: "QA", Stage3Name: "Staging", Stage4Name: "Prod"}
	if err := UpsertStatusConfig(context.Background(), stored); err != nil {
		t.Fatalf(errUnexpected, err)
	}

	cfg, err := GetStatusConfig(context.Background(), 1)
	if err != nil {
		t.Fatalf(errUnexpected, err)
	}
	if cfg.Stage1Name != "Review" || cfg.Stage2Name != "QA" || cfg.Stage3Name != "Staging" || cfg.Stage4Name != "Prod" {
		t.Errorf("unexpected stored config: %+v", cfg)
	}
}

func TestGetStatusConfigDBError(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	if _, err := DB.Exec("DROP TABLE project_status_config"); err != nil {
		t.Fatalf("failed to drop table: %v", err)
	}

	if _, err := GetStatusConfig(context.Background(), 1); err == nil {
		t.Error("expected error after table drop, got nil")
	}
}

func TestUpsertStatusConfigPersists(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	cfg := &StatusConfig{ProjectID: 1, Stage1Name: "Todo", Stage2Name: "Doing", Stage3Name: "", Stage4Name: ""}
	if err := UpsertStatusConfig(context.Background(), cfg); err != nil {
		t.Fatalf(errUnexpected, err)
	}

	got, err := GetStatusConfig(context.Background(), 1)
	if err != nil {
		t.Fatalf(errUnexpected, err)
	}
	if got.Stage1Name != "Todo" || got.Stage2Name != "Doing" {
		t.Errorf("expected persisted values, got %+v", got)
	}
}

func TestUpsertStatusConfigReplacesExisting(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	if err := UpsertStatusConfig(context.Background(), &StatusConfig{ProjectID: 1, Stage1Name: "Pending", Stage2Name: "Working"}); err != nil {
		t.Fatalf(errUnexpected, err)
	}
	if err := UpsertStatusConfig(context.Background(), &StatusConfig{ProjectID: 1, Stage1Name: "Review", Stage2Name: "QA"}); err != nil {
		t.Fatalf(errUnexpected, err)
	}

	got, err := GetStatusConfig(context.Background(), 1)
	if err != nil {
		t.Fatalf(errUnexpected, err)
	}
	if got.Stage1Name != "Review" || got.Stage2Name != "QA" {
		t.Errorf("expected replaced values, got %+v", got)
	}
}

func TestUpsertStatusConfigDBError(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	if _, err := DB.Exec("DROP TABLE project_status_config"); err != nil {
		t.Fatalf("failed to drop table: %v", err)
	}

	if err := UpsertStatusConfig(context.Background(), &StatusConfig{ProjectID: 1}); err == nil {
		t.Error("expected error after table drop, got nil")
	}
}

// ---------------------------------------------------------------------------
// Release CRUD
// ---------------------------------------------------------------------------

func TestCreateRelease(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	r := &Release{ProjectID: 1, Name: "v1.0"}
	if err := CreateRelease(context.Background(), r); err != nil {
		t.Fatalf("CreateRelease failed: %v", err)
	}
	if r.ID == 0 {
		t.Error("expected release ID to be set")
	}
	if r.Status != ReleaseStatusOpen {
		t.Errorf("expected status open, got %s", r.Status)
	}
}

func TestCreateReleaseDuplicate(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	r1 := &Release{ProjectID: 1, Name: "v1.0"}
	if err := CreateRelease(context.Background(), r1); err != nil {
		t.Fatalf("first CreateRelease failed: %v", err)
	}
	r2 := &Release{ProjectID: 1, Name: "v1.0"}
	if err := CreateRelease(context.Background(), r2); !errors.Is(err, ErrDuplicateReleaseName) {
		t.Errorf("expected ErrDuplicateReleaseName, got %v", err)
	}
}

func TestGetReleasesByProject(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	if err := CreateRelease(context.Background(), &Release{ProjectID: 1, Name: "v1.0"}); err != nil {
		t.Fatalf("CreateRelease failed: %v", err)
	}
	if err := CreateRelease(context.Background(), &Release{ProjectID: 1, Name: "v2.0"}); err != nil {
		t.Fatalf("CreateRelease failed: %v", err)
	}

	releases, err := GetReleasesByProject(context.Background(), 1)
	if err != nil {
		t.Fatalf("GetReleasesByProject failed: %v", err)
	}
	if len(releases) != 2 {
		t.Errorf("expected 2 releases, got %d", len(releases))
	}
}

func TestGetReleaseByID(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	rel := &Release{ProjectID: 1, Name: "v1.0"}
	if err := CreateRelease(context.Background(), rel); err != nil {
		t.Fatalf("CreateRelease failed: %v", err)
	}

	got, err := GetReleaseByID(context.Background(), rel.ID)
	if err != nil {
		t.Fatalf("GetReleaseByID failed: %v", err)
	}
	if got == nil {
		t.Fatal("expected release, got nil")
	}
	if got.Name != "v1.0" {
		t.Errorf("expected name 'v1.0', got '%s'", got.Name)
	}
}

func TestGetReleaseByIDNotFound(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	got, err := GetReleaseByID(context.Background(), 9999)
	if err != nil {
		t.Fatalf("expected nil error for missing release, got %v", err)
	}
	if got != nil {
		t.Errorf("expected nil release, got %+v", got)
	}
}

func TestGetReleaseByIDWithDates(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	rel := &Release{ProjectID: 1, Name: "v1.0", StartDate: &start, ReleaseDate: &end}
	if err := CreateRelease(context.Background(), rel); err != nil {
		t.Fatalf("CreateRelease failed: %v", err)
	}

	got, err := GetReleaseByID(context.Background(), rel.ID)
	if err != nil {
		t.Fatalf("GetReleaseByID failed: %v", err)
	}
	if got.StartDate == nil || got.ReleaseDate == nil {
		t.Error("expected start and release dates to be set")
	}
}

func TestUpdateRelease(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	rel := &Release{ProjectID: 1, Name: "v1.0"}
	if err := CreateRelease(context.Background(), rel); err != nil {
		t.Fatalf("CreateRelease failed: %v", err)
	}

	rel.Name = "v1.1"
	if err := UpdateRelease(context.Background(), rel); err != nil {
		t.Fatalf("UpdateRelease failed: %v", err)
	}

	got, _ := GetReleaseByID(context.Background(), rel.ID)
	if got.Name != "v1.1" {
		t.Errorf("expected name 'v1.1', got '%s'", got.Name)
	}
}

func TestUpdateReleaseNotFound(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	rel := &Release{ID: 9999, ProjectID: 1, Name: "ghost"}
	if err := UpdateRelease(context.Background(), rel); !errors.Is(err, ErrReleaseNotFound) {
		t.Errorf("expected ErrReleaseNotFound, got %v", err)
	}
}

func TestUpdateReleaseDuplicate(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	r1 := &Release{ProjectID: 1, Name: "v1.0"}
	r2 := &Release{ProjectID: 1, Name: "v2.0"}
	if err := CreateRelease(context.Background(), r1); err != nil {
		t.Fatalf("CreateRelease r1 failed: %v", err)
	}
	if err := CreateRelease(context.Background(), r2); err != nil {
		t.Fatalf("CreateRelease r2 failed: %v", err)
	}

	r2.Name = "v1.0"
	if err := UpdateRelease(context.Background(), r2); !errors.Is(err, ErrDuplicateReleaseName) {
		t.Errorf("expected ErrDuplicateReleaseName, got %v", err)
	}
}

func TestDeleteRelease(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	rel := &Release{ProjectID: 1, Name: "v1.0"}
	if err := CreateRelease(context.Background(), rel); err != nil {
		t.Fatalf("CreateRelease failed: %v", err)
	}

	if err := DeleteRelease(context.Background(), rel.ID); err != nil {
		t.Fatalf("DeleteRelease failed: %v", err)
	}

	got, _ := GetReleaseByID(context.Background(), rel.ID)
	if got != nil {
		t.Error("expected release to be deleted")
	}
}

func TestDeleteReleaseNotFound(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	if err := DeleteRelease(context.Background(), 9999); !errors.Is(err, ErrReleaseNotFound) {
		t.Errorf("expected ErrReleaseNotFound, got %v", err)
	}
}

func TestTriggerRelease(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	rel := &Release{ProjectID: 1, Name: "v1.0"}
	if err := CreateRelease(context.Background(), rel); err != nil {
		t.Fatalf("CreateRelease failed: %v", err)
	}

	if err := TriggerRelease(context.Background(), rel.ID, false); err != nil {
		t.Fatalf("TriggerRelease failed: %v", err)
	}

	got, _ := GetReleaseByID(context.Background(), rel.ID)
	if got.Status != ReleaseStatusClosed {
		t.Errorf("expected status closed, got %s", got.Status)
	}
	if got.ClosedAt == nil {
		t.Error("expected ClosedAt to be set")
	}
}

func TestTriggerReleaseArchivesDoneIssues(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	rel := &Release{ProjectID: 1, Name: "v1.0"}
	if err := CreateRelease(context.Background(), rel); err != nil {
		t.Fatalf("CreateRelease failed: %v", err)
	}
	issue := &Issue{Title: "Done issue", Status: StatusDone, ProjectID: 1, ReleaseID: &rel.ID}
	if err := CreateIssue(context.Background(), issue); err != nil {
		t.Fatalf("CreateIssue failed: %v", err)
	}

	if err := TriggerRelease(context.Background(), rel.ID, true); err != nil {
		t.Fatalf("TriggerRelease failed: %v", err)
	}

	got, _ := GetIssueByID(context.Background(), issue.ID)
	if got.Status != StatusArchive {
		t.Errorf("expected issue status archive, got %s", got.Status)
	}
}

func TestTriggerReleaseNotFound(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	if err := TriggerRelease(context.Background(), 9999, false); !errors.Is(err, ErrReleaseNotFound) {
		t.Errorf("expected ErrReleaseNotFound, got %v", err)
	}
}

func TestReopenRelease(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	rel := &Release{ProjectID: 1, Name: "v1.0"}
	if err := CreateRelease(context.Background(), rel); err != nil {
		t.Fatalf("CreateRelease failed: %v", err)
	}
	if err := TriggerRelease(context.Background(), rel.ID, false); err != nil {
		t.Fatalf("TriggerRelease failed: %v", err)
	}

	if err := ReopenRelease(context.Background(), rel.ID); err != nil {
		t.Fatalf("ReopenRelease failed: %v", err)
	}

	got, _ := GetReleaseByID(context.Background(), rel.ID)
	if got.Status != ReleaseStatusOpen {
		t.Errorf("expected status open, got %s", got.Status)
	}
	if got.ClosedAt != nil {
		t.Error("expected ClosedAt to be nil after reopen")
	}
}

func TestReopenReleaseNotFound(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	if err := ReopenRelease(context.Background(), 9999); !errors.Is(err, ErrReleaseNotFound) {
		t.Errorf("expected ErrReleaseNotFound, got %v", err)
	}
}

func TestReleaseExistsInProject(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	rel := &Release{ProjectID: 1, Name: "v1.0"}
	if err := CreateRelease(context.Background(), rel); err != nil {
		t.Fatalf("CreateRelease failed: %v", err)
	}

	exists, err := ReleaseExistsInProject(context.Background(), rel.ID, 1)
	if err != nil {
		t.Fatalf("ReleaseExistsInProject failed: %v", err)
	}
	if !exists {
		t.Error("expected release to exist in project")
	}

	notExists, err := ReleaseExistsInProject(context.Background(), rel.ID, 999)
	if err != nil {
		t.Fatalf("ReleaseExistsInProject (wrong project) failed: %v", err)
	}
	if notExists {
		t.Error("expected release NOT to exist in wrong project")
	}
}

func TestGetIssueByIDWithRelease(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	rel := &Release{ProjectID: 1, Name: "v1.0"}
	if err := CreateRelease(context.Background(), rel); err != nil {
		t.Fatalf("CreateRelease failed: %v", err)
	}
	issue := &Issue{Title: "Issue with release", Status: StatusOpen, ProjectID: 1, ReleaseID: &rel.ID}
	if err := CreateIssue(context.Background(), issue); err != nil {
		t.Fatalf("CreateIssue failed: %v", err)
	}

	got, err := GetIssueByID(context.Background(), issue.ID)
	if err != nil {
		t.Fatalf("GetIssueByID failed: %v", err)
	}
	if got.ReleaseID == nil || *got.ReleaseID != rel.ID {
		t.Errorf("expected ReleaseID %d, got %v", rel.ID, got.ReleaseID)
	}
	if got.Release == nil || got.Release.Name != "v1.0" {
		t.Error("expected Release to be hydrated with name 'v1.0'")
	}
}

func TestGetIssuesByProjectWithRelease(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	rel := &Release{ProjectID: 1, Name: "v1.0"}
	if err := CreateRelease(context.Background(), rel); err != nil {
		t.Fatalf("CreateRelease failed: %v", err)
	}
	issue := &Issue{Title: "Issue with release", Status: StatusTodo, ProjectID: 1, ReleaseID: &rel.ID}
	if err := CreateIssue(context.Background(), issue); err != nil {
		t.Fatalf("CreateIssue failed: %v", err)
	}

	issues, err := GetActiveIssuesByProject(context.Background(), 1)
	if err != nil {
		t.Fatalf("GetActiveIssuesByProject failed: %v", err)
	}
	if len(issues) == 0 {
		t.Fatal("expected at least one issue")
	}
	if issues[0].ReleaseID == nil || *issues[0].ReleaseID != rel.ID {
		t.Errorf("expected ReleaseID %d on project issue, got %v", rel.ID, issues[0].ReleaseID)
	}
	if issues[0].Release == nil || issues[0].Release.Name != "v1.0" {
		t.Error("expected Release to be hydrated with name 'v1.0'")
	}
}
