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
)

// HandleIssues handles GET and POST requests for issues.
func HandleIssues(w http.ResponseWriter, r *http.Request) {

	switch r.Method {
	case "GET":
		issues, err := GetAllIssues()
		if err != nil {
			slog.Error("GetAllIssues failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(issues)
	case "POST":
		var i Issue
		if err := json.NewDecoder(r.Body).Decode(&i); err != nil {
			slog.Warn("Failed to decode issue", "error", err)
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
		http.Error(w, "Issue not found", http.StatusNotFound)
		return
	}
	// Set ETag header based on updated_at timestamp
	etag := issue.UpdatedAt.UTC().Format(time.RFC3339Nano)
	w.Header().Set("ETag", `"`+etag+`"`)
	json.NewEncoder(w).Encode(issue)
}

// handlePutIssue updates an existing issue, checking for conflicts via the If-Match header.
func handlePutIssue(w http.ResponseWriter, r *http.Request, id int) {
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
	i.ID = id
	if err := UpdateIssue(&i); err != nil {
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
		http.Error(w, "Issue not found", http.StatusNotFound)
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
	if err := DeleteIssue(id); err != nil {
		slog.Error("DeleteIssue failed", "id", id, "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// HandleTasks handles POST requests for creating tasks.
func HandleTasks(w http.ResponseWriter, r *http.Request) {

	switch r.Method {
	case "POST":
		// Extract issue ID from URL if needed, or from body.
		// Here we assume body contains issue_id or the URL structure is /api/issues/{id}/tasks
		// For simplicity let's stick to /api/tasks for creation if issue_id is in body,
		// Parse URL to get issue ID
		parts := strings.Split(r.URL.Path, "/")
		// Expected: /api/issues/{id}/tasks
		// parts: ["", "api", "issues", "{id}", "tasks"]
		if len(parts) < 5 || parts[4] != "tasks" {
			slog.Warn("Invalid URL structure for tasks", "path", r.URL.Path)
			http.Error(w, "Invalid URL", http.StatusBadRequest)
			return
		}
		issueID, err := strconv.Atoi(parts[3]) // /api/issues/{id}/tasks
		if err != nil {
			slog.Warn("Invalid Issue ID in tasks URL", "id_part", parts[3], "error", err)
			http.Error(w, "Invalid Issue ID", http.StatusBadRequest)
			return
		}

		var t Task
		if err := json.NewDecoder(r.Body).Decode(&t); err != nil {
			slog.Warn("Failed to decode task", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		t.IssueID = issueID
		if err := CreateTask(&t); err != nil {
			slog.Error("CreateTask failed", "issue_id", issueID, "error", err)
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
		var t Task
		if err := json.NewDecoder(r.Body).Decode(&t); err != nil {
			slog.Warn("Failed to decode task for update", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		t.ID = id
		if err := UpdateTask(&t); err != nil {
			slog.Error("UpdateTask failed", "id", id, "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(t)
	case "DELETE":
		if err := DeleteTask(id); err != nil {
			slog.Error("DeleteTask failed", "id", id, "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		http.Error(w, errMsgMethodNotAllowed, http.StatusMethodNotAllowed)
	}
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
			slog.Error("DeleteLabel failed", "id", id, "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		http.Error(w, errMsgMethodNotAllowed, http.StatusMethodNotAllowed)
	}
}
