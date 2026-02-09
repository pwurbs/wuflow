package backend

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	errMsgMethodNotAllowed = "Method not allowed"
	errMsgInvalidID        = "Invalid ID"
	errMsgIssueNotFound    = "Issue not found"
	errMsgTaskNotFound     = "Task not found"
	errMsgArchivedReadOnly = "Archived issues are read-only"
)

// HandleCreateIssue handles POST requests to create a new issue.
func HandleCreateIssue(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "POST":
		var i Issue
		if err := json.NewDecoder(r.Body).Decode(&i); err != nil {
			slog.Warn("Failed to decode issue", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if err := validateIssue(&i); err != nil {
			slog.Warn("Issue validation failed", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if err := CreateIssue(&i); err != nil {
			slog.Error("CreateIssue failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(i)
	default:
		http.Error(w, errMsgMethodNotAllowed, http.StatusMethodNotAllowed)
	}
}

// HandleActiveIssues handles GET requests to get all active issues.
func HandleActiveIssues(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "GET":
		issues, err := GetAllActiveIssues()
		if err != nil {
			slog.Error("GetAllActiveIssues failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(issues)
	default:
		http.Error(w, errMsgMethodNotAllowed, http.StatusMethodNotAllowed)
	}
}

// HandleArchivedIssues handles GET requests to get all archived issues.
func HandleArchivedIssues(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "GET":
		issues, err := GetAllArchivedIssues()
		if err != nil {
			slog.Error("GetAllArchivedIssues failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(issues)
	default:
		http.Error(w, errMsgMethodNotAllowed, http.StatusMethodNotAllowed)
	}
}

// HandleIssue handles GET, PUT and DELETE requests for a single issue.
func HandleIssue(w http.ResponseWriter, r *http.Request) {

	idStr := strings.TrimPrefix(r.URL.Path, "/api/issues/")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		slog.Warn("Invalid issue ID", "id", idStr, "error", err)
		http.Error(w, errMsgInvalidID, http.StatusBadRequest)
		return
	}
	switch r.Method {
	case "GET":
		handleGetIssue(w, id)
	case "PUT":
		handlePutIssue(w, r, id)
	case "DELETE":
		handleDeleteIssue(w, id)
	default:
		http.Error(w, errMsgMethodNotAllowed, http.StatusMethodNotAllowed)
	}
}

// handleGetIssue retrieves a single issue by ID and serves it with an ETag header.
func handleGetIssue(w http.ResponseWriter, id int) {
	issue, err := GetIssueByID(id)
	if err != nil {
		slog.Error("GetIssueByID failed", "id", id, "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if issue == nil {
		http.Error(w, errMsgIssueNotFound, http.StatusNotFound)
		return
	}
	// Set ETag header based on updated_at timestamp
	etag := issue.UpdatedAt.UTC().Format(time.RFC3339Nano)
	w.Header().Set("ETag", `"`+etag+`"`)
	json.NewEncoder(w).Encode(issue)
}

// handlePutIssue updates an existing issue, checking for conflicts via the If-Match header.
func handlePutIssue(w http.ResponseWriter, r *http.Request, id int) {
	// Fetch current issue to check status and for unarchive check
	current, err := GetIssueByID(id)
	if err != nil {
		slog.Error("GetIssueByID failed for edit check", "id", id, "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if current == nil {
		http.Error(w, errMsgIssueNotFound, http.StatusNotFound)
		return
	}

	// Check If-Match header for optimistic locking
	ifMatch := r.Header.Get("If-Match")
	if ifMatch != "" {
		if checkIfMatchConflict(w, id, ifMatch) {
			return
		}
	}

	var i Issue
	if err := json.NewDecoder(r.Body).Decode(&i); err != nil {
		slog.Warn("Failed to decode issue for update", "error", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if err := validateIssue(&i); err != nil {
		slog.Warn("Issue update validation failed", "error", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Block edits if archived and status NOT being changed to Done
	if current.Status == StatusArchive && i.Status != StatusDone {
		http.Error(w, errMsgArchivedReadOnly, http.StatusForbidden)
		return
	}

	i.ID = id
	if err := UpdateIssue(&i); err != nil {
		if err == ErrIssueNotFound {
			http.Error(w, errMsgIssueNotFound, http.StatusNotFound)
			return
		}
		slog.Error("UpdateIssue failed", "id", id, "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	// Return new ETag after update
	newEtag := i.UpdatedAt.UTC().Format(time.RFC3339Nano)
	w.Header().Set("ETag", `"`+newEtag+`"`)
	json.NewEncoder(w).Encode(i)
}

// checkIfMatchConflict verifies if the client's If-Match header matches the current issue's ETag.
// Returns true if a conflict is detected (and sends 409 response), false otherwise.
func checkIfMatchConflict(w http.ResponseWriter, id int, ifMatch string) bool {
	current, err := GetIssueByID(id)
	if err != nil {
		slog.Error("GetIssueByID failed for If-Match check", "id", id, "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return true
	}
	if current == nil {
		http.Error(w, errMsgIssueNotFound, http.StatusNotFound)
		return true
	}
	currentEtag := `"` + current.UpdatedAt.UTC().Format(time.RFC3339Nano) + `"`
	if ifMatch != currentEtag {
		slog.Info("Conflict detected", "id", id, "client_etag", ifMatch, "current_etag", currentEtag)
		http.Error(w, "Issue has been modified by another user", http.StatusConflict)
		return true
	}
	return false
}

// handleDeleteIssue removes an issue by its ID.
func handleDeleteIssue(w http.ResponseWriter, id int) {
	issue, err := GetIssueByID(id)
	if err != nil {
		slog.Error("GetIssueByID failed for delete check", "id", id, "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if issue == nil {
		http.Error(w, errMsgIssueNotFound, http.StatusNotFound)
		return
	}
	if issue.Status == StatusArchive {
		http.Error(w, "Archived issues cannot be deleted", http.StatusForbidden)
		return
	}

	if err := DeleteIssue(id); err != nil {
		if err == ErrIssueNotFound {
			http.Error(w, errMsgIssueNotFound, http.StatusNotFound)
			return
		}
		slog.Error("DeleteIssue failed", "id", id, "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// HandleCreateTask handles POST requests for creating tasks.
func HandleCreateTask(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "POST":
		var t Task
		if err := json.NewDecoder(r.Body).Decode(&t); err != nil {
			slog.Warn("Failed to decode task", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if err := validateTask(&t); err != nil {
			slog.Warn("Task validation failed", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if t.IssueID == 0 {
			http.Error(w, "Issue ID is required", http.StatusBadRequest)
			return
		}

		// Check if issue is archived
		issue, err := GetIssueByID(t.IssueID)
		if err != nil {
			slog.Error("GetIssueByID failed for task creation check", "id", t.IssueID, "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if issue == nil {
			http.Error(w, errMsgIssueNotFound, http.StatusBadRequest)
			return
		}
		if issue.Status == StatusArchive {
			http.Error(w, "Cannot add tasks to archived issues", http.StatusForbidden)
			return
		}

		if err := CreateTask(&t); err != nil {
			slog.Error("CreateTask failed", "issue_id", t.IssueID, "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(t)
	default:
		http.Error(w, errMsgMethodNotAllowed, http.StatusMethodNotAllowed)
	}
}

// HandleTask handles PUT and DELETE requests for a single task.
func HandleTask(w http.ResponseWriter, r *http.Request) {

	idStr := strings.TrimPrefix(r.URL.Path, "/api/tasks/")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		slog.Warn("Invalid task ID", "id", idStr, "error", err)
		http.Error(w, errMsgInvalidID, http.StatusBadRequest)
		return
	}
	switch r.Method {
	case "PUT":
		handlePutTask(w, r, id)
	case "DELETE":
		handleDeleteTask(w, id)
	default:
		http.Error(w, errMsgMethodNotAllowed, http.StatusMethodNotAllowed)
	}
}

// handlePutTask updates an existing task, checking for archived issue status.
func handlePutTask(w http.ResponseWriter, r *http.Request, id int) {
	var t Task
	if err := json.NewDecoder(r.Body).Decode(&t); err != nil {
		slog.Warn("Failed to decode task for update", "error", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if err := validateTask(&t); err != nil {
		slog.Warn("Task update validation failed", "error", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Check if parent issue is archived
	task, err := GetTaskByID(id)
	if err != nil {
		slog.Error("GetTaskByID failed for task update check", "id", id, "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if task == nil {
		http.Error(w, errMsgTaskNotFound, http.StatusNotFound)
		return
	}
	issue, err := GetIssueByID(task.IssueID)
	if err != nil {
		slog.Error("GetIssueByID failed for task update check", "id", task.IssueID, "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if issue != nil && issue.Status == StatusArchive {
		http.Error(w, "Tasks of archived issues are read-only", http.StatusForbidden)
		return
	}

	t.ID = id
	if err := UpdateTask(&t); err != nil {
		if err == ErrTaskNotFound {
			http.Error(w, errMsgTaskNotFound, http.StatusNotFound)
			return
		}
		slog.Error("UpdateTask failed", "id", id, "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(t)
}

// handleDeleteTask removes a task, checking for archived issue status.
func handleDeleteTask(w http.ResponseWriter, id int) {
	// Check if parent issue is archived
	task, err := GetTaskByID(id)
	if err != nil {
		slog.Error("GetTaskByID failed for task delete check", "id", id, "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if task == nil {
		http.Error(w, errMsgTaskNotFound, http.StatusNotFound)
		return
	}
	issue, err := GetIssueByID(task.IssueID)
	if err != nil {
		slog.Error("GetIssueByID failed for task delete check", "id", task.IssueID, "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if issue != nil && issue.Status == StatusArchive {
		http.Error(w, "Tasks of archived issues cannot be deleted", http.StatusForbidden)
		return
	}

	if err := DeleteTask(id); err != nil {
		if err == ErrTaskNotFound {
			http.Error(w, errMsgTaskNotFound, http.StatusNotFound)
			return
		}
		slog.Error("DeleteTask failed", "id", id, "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// HandleLabels handles GET and POST requests for labels.
func HandleLabels(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "GET":
		labels, err := GetAllLabels()
		if err != nil {
			slog.Error("GetAllLabels failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(labels)
	case "POST":
		var l Label
		if err := json.NewDecoder(r.Body).Decode(&l); err != nil {
			slog.Warn("Failed to decode label", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err := validateLabel(&l); err != nil {
			slog.Warn("Label validation failed", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err := CreateLabel(&l); err != nil {
			slog.Error("CreateLabel failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(l)
	default:
		http.Error(w, errMsgMethodNotAllowed, http.StatusMethodNotAllowed)
	}
}

// HandleLabel handles DELETE requests for a single label.
func HandleLabel(w http.ResponseWriter, r *http.Request) {
	idStr := strings.TrimPrefix(r.URL.Path, "/api/labels/")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		slog.Warn("Invalid label ID", "id", idStr, "error", err)
		http.Error(w, errMsgInvalidID, http.StatusBadRequest)
		return
	}

	switch r.Method {
	case "DELETE":
		if err := DeleteLabel(id); err != nil {
			if err == ErrLabelNotFound {
				http.Error(w, "Label not found", http.StatusNotFound)
				return
			}
			slog.Error("DeleteLabel failed", "id", id, "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		http.Error(w, errMsgMethodNotAllowed, http.StatusMethodNotAllowed)
	}
}
