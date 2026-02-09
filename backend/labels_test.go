package backend

import (
	"testing"
)

func TestLabelsCRUD(t *testing.T) {
	setupTestDB()
	defer teardownTestDB()

	// 1. Test CreateLabel
	l := &Label{Name: "Bug", Color: "#ff0000"}
	err := CreateLabel(l)
	if err != nil {
		t.Fatalf("Failed to create label: %v", err)
	}
	if l.ID == 0 {
		t.Errorf("Expected Label ID to be set, got 0")
	}

	// 2. Test GetLabels
	labels, err := GetAllLabels()
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
	err = DeleteLabel(l.ID)
	if err != nil {
		t.Fatalf("Failed to delete label: %v", err)
	}

	labels, err = GetAllLabels()
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
	lbl := &Label{Name: "Feature", Color: "#00ff00"}
	if err := CreateLabel(lbl); err != nil {
		t.Fatalf("Failed to create label: %v", err)
	}

	// Create Issue with Label
	issue := &Issue{
		Title:  "Issue with Label",
		Status: StatusOpen,
		Label:  lbl,
	}
	if err := CreateIssue(issue); err != nil {
		t.Fatalf("Failed to create issue: %v", err)
	}

	// Verify Association
	fetchedIssues, err := GetAllActiveIssues()
	if err != nil {
		t.Fatalf("Failed to fetch issues: %v", err)
	}
	if len(fetchedIssues) != 1 {
		t.Fatalf("Expected 1 issue, got %d", len(fetchedIssues))
	}
	if fetchedIssues[0].Label == nil {
		t.Errorf("Expected issue to have label, got nil")
	} else if fetchedIssues[0].Label.ID != lbl.ID {
		t.Errorf("Expected label ID %d, got %d", lbl.ID, fetchedIssues[0].Label.ID)
	}

	// Delete Label and verify ON DELETE SET NULL
	if err := DeleteLabel(lbl.ID); err != nil {
		t.Fatalf("Failed to delete label: %v", err)
	}

	fetchedIssues, err = GetAllActiveIssues()
	if err != nil {
		t.Fatalf("Failed to fetch issues: %v", err)
	}
	if len(fetchedIssues) != 1 {
		t.Fatalf("Expected 1 issue, got %d", len(fetchedIssues))
	}

	// The label pointer itself might be nil or the struct might be empty depending on implementation?
	// In db.go GetAllActiveIssues, we check `if lID.Valid`. If label deleted -> lID is NULL -> i.Label is nil.
	if fetchedIssues[0].Label != nil {
		t.Errorf("Expected issue label to be nil after label deletion (SET NULL), got %v", fetchedIssues[0].Label)
	}
}
