package backend

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

// HandleIssues handles GET and POST requests for issues.
func HandleIssues(w http.ResponseWriter, r *http.Request) {

	switch r.Method {
	case "GET":
		issues, err := GetAllIssues()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(issues)
	case "POST":
		var i Issue
		if err := json.NewDecoder(r.Body).Decode(&i); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err := CreateIssue(&i); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(i)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// HandleIssue handles PUT and DELETE requests for a single issue.
func HandleIssue(w http.ResponseWriter, r *http.Request) {

	idStr := strings.TrimPrefix(r.URL.Path, "/api/issues/")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "Invalid ID", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case "PUT":
		var i Issue
		if err := json.NewDecoder(r.Body).Decode(&i); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		i.ID = id
		if err := UpdateIssue(&i); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(i)
	case "DELETE":
		if err := DeleteIssue(id); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// HandleTasks handles POST requests for creating tasks.
func HandleTasks(w http.ResponseWriter, r *http.Request) {

	switch r.Method {
	case "POST":
		// Extract issue ID from URL if needed, or from body.
		// Here we assume body contains issue_id or the URL structure is /api/issues/{id}/tasks
		// For simplicity let's stick to /api/tasks for creation if issue_id is in body,
		// but the plan said /api/issues/{id}/tasks. Let's support the plan.

		// Parse URL to get issue ID
		parts := strings.Split(r.URL.Path, "/")
		// Expected: /api/issues/{id}/tasks
		// parts: ["", "api", "issues", "{id}", "tasks"]
		if len(parts) < 5 || parts[4] != "tasks" {
			http.Error(w, "Invalid URL", http.StatusBadRequest)
			return
		}
		issueID, err := strconv.Atoi(parts[3]) // /api/issues/{id}/tasks
		if err != nil {
			http.Error(w, "Invalid Issue ID", http.StatusBadRequest)
			return
		}

		var t Task
		if err := json.NewDecoder(r.Body).Decode(&t); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		t.IssueID = issueID
		if err := CreateTask(&t); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(t)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// HandleTask handles PUT and DELETE requests for a single task.
func HandleTask(w http.ResponseWriter, r *http.Request) {

	idStr := strings.TrimPrefix(r.URL.Path, "/api/tasks/")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "Invalid ID", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case "PUT":
		var t Task
		if err := json.NewDecoder(r.Body).Decode(&t); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		t.ID = id
		if err := UpdateTask(&t); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(t)
	case "DELETE":
		if err := DeleteTask(id); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}
