package backend

import (
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

func setupTestDB() {
	// Use shared cache to allow multiple connections (from pool) to see the same in-memory DB
	InitDB("file::memory:?cache=shared")
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
