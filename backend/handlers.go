package backend

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	errMsgForbidden           = "Forbidden"
	errMsgMethodNotAllowed    = "Method not allowed"
	errMsgInvalidID           = "Invalid ID"
	errMsgIssueNotFound       = "Issue not found"
	errMsgTaskNotFound        = "Task not found"
	errMsgArchivedReadOnly    = "Archived issues are read-only"
	errMsgInternalServerError = "Internal server error"
	errMsgUserNotFound        = "User not found"
	headerContentType         = "Content-Type"
	contentTypeJSON           = "application/json"
	loginPath                 = "/login"
	errMsgInvalidRequestBody  = "Invalid request body"
	errMsgFailedLogin         = "Failed login attempt"
	errMsgInvalidCreds        = "Invalid email or password"
)

// denyForbidden logs a permission-denied warning and writes a 403 response.
func denyForbidden(w http.ResponseWriter, r *http.Request, action Action) {
	slog.Warn("Permission denied", "action", action, "role", GetRoleFromContext(r.Context()), "method", r.Method, "path", r.URL.Path)
	http.Error(w, errMsgForbidden, http.StatusForbidden)
}

// HandleCreateIssue handles POST requests to create a new issue.
func HandleCreateIssue(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "POST":
		if !Can(GetRoleFromContext(r.Context()), ActionCreateIssue) {
			denyForbidden(w, r, ActionCreateIssue)
			return
		}
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

		// Get creator ID from context and set it
		i.CreatorID = GetUserIDFromContext(r.Context())

		if err := CreateIssue(&i); err != nil {
			slog.Error("CreateIssue failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Re-fetch to get full details (Creator, Assignee, etc.)
		created, err := GetIssueByID(i.ID)
		if err != nil {
			slog.Error("CreateIssue: failed to fetch created issue", "id", i.ID, "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(created)
	default:
		http.Error(w, errMsgMethodNotAllowed, http.StatusMethodNotAllowed)
	}
}

// HandleActiveIssues handles GET requests to get all active issues.
func HandleActiveIssues(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "GET":
		if !Can(GetRoleFromContext(r.Context()), ActionListIssues) {
			denyForbidden(w, r, ActionListIssues)
			return
		}
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
		if !Can(GetRoleFromContext(r.Context()), ActionListIssues) {
			denyForbidden(w, r, ActionListIssues)
			return
		}
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

// HandleIssue handles GET, PUT, DELETE and sub-action (archive/unarchive) requests for a single issue.
func HandleIssue(w http.ResponseWriter, r *http.Request) {
	pathSuffix := strings.TrimPrefix(r.URL.Path, "/api/issues/")
	parts := strings.SplitN(pathSuffix, "/", 2)
	id, err := strconv.Atoi(parts[0])
	if err != nil {
		slog.Warn("Invalid issue ID", "id", parts[0], "error", err)
		http.Error(w, errMsgInvalidID, http.StatusBadRequest)
		return
	}
	subAction := ""
	if len(parts) == 2 {
		subAction = parts[1]
	}

	switch subAction {
	case "archive":
		if r.Method != "POST" {
			http.Error(w, errMsgMethodNotAllowed, http.StatusMethodNotAllowed)
			return
		}
		if !Can(GetRoleFromContext(r.Context()), ActionArchiveIssue) {
			denyForbidden(w, r, ActionArchiveIssue)
			return
		}
		handleArchiveIssue(w, id)
	case "unarchive":
		if r.Method != "POST" {
			http.Error(w, errMsgMethodNotAllowed, http.StatusMethodNotAllowed)
			return
		}
		if !Can(GetRoleFromContext(r.Context()), ActionUnarchiveIssue) {
			denyForbidden(w, r, ActionUnarchiveIssue)
			return
		}
		handleUnarchiveIssue(w, id)
	case "":
		dispatchIssueMethod(w, r, id)
	default:
		http.Error(w, errMsgInvalidID, http.StatusBadRequest)
	}
}

// dispatchIssueMethod routes GET/PUT/DELETE for a single issue.
func dispatchIssueMethod(w http.ResponseWriter, r *http.Request, id int) {
	switch r.Method {
	case "GET":
		if !Can(GetRoleFromContext(r.Context()), ActionGetIssue) {
			denyForbidden(w, r, ActionGetIssue)
			return
		}
		handleGetIssue(w, id)
	case "PUT":
		if !Can(GetRoleFromContext(r.Context()), ActionUpdateIssue) {
			denyForbidden(w, r, ActionUpdateIssue)
			return
		}
		handlePutIssue(w, r, id)
	case "DELETE":
		if !Can(GetRoleFromContext(r.Context()), ActionDeleteIssue) {
			denyForbidden(w, r, ActionDeleteIssue)
			return
		}
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

// handleArchiveIssue sets an issue's status to Archive.
func handleArchiveIssue(w http.ResponseWriter, id int) {
	current, err := GetIssueByID(id)
	if err != nil {
		slog.Error("GetIssueByID failed for archive", "id", id, "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if current == nil {
		http.Error(w, errMsgIssueNotFound, http.StatusNotFound)
		return
	}
	if current.Status == StatusArchive {
		http.Error(w, "Issue is already archived", http.StatusBadRequest)
		return
	}
	current.Status = StatusArchive
	if err := UpdateIssue(current); err != nil {
		slog.Error("UpdateIssue failed for archive", "id", id, "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	updated, err := GetIssueByID(id)
	if err != nil {
		slog.Error("GetIssueByID failed after archive", "id", id, "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(updated)
}

// handleUnarchiveIssue moves an archived issue back to Done status.
func handleUnarchiveIssue(w http.ResponseWriter, id int) {
	current, err := GetIssueByID(id)
	if err != nil {
		slog.Error("GetIssueByID failed for unarchive", "id", id, "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if current == nil {
		http.Error(w, errMsgIssueNotFound, http.StatusNotFound)
		return
	}
	if current.Status != StatusArchive {
		http.Error(w, "Issue is not archived", http.StatusBadRequest)
		return
	}
	current.Status = StatusDone
	if err := UpdateIssue(current); err != nil {
		slog.Error("UpdateIssue failed for unarchive", "id", id, "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	updated, err := GetIssueByID(id)
	if err != nil {
		slog.Error("GetIssueByID failed after unarchive", "id", id, "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(updated)
}

// handlePutIssue updates an existing non-archived issue, checking for conflicts via the If-Match header.
func handlePutIssue(w http.ResponseWriter, r *http.Request, id int) {
	current, err := GetIssueByID(id)
	if err != nil {
		slog.Error("GetIssueByID failed for put", "id", id, "error", err)
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

	// Ensure CreatorID is not changed and persists
	i.CreatorID = current.CreatorID

	if err := validateIssue(&i); err != nil {
		slog.Warn("Issue update validation failed", "error", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Archived issues are read-only — use POST /api/issues/{id}/unarchive to restore
	if current.Status == StatusArchive {
		http.Error(w, errMsgArchivedReadOnly, http.StatusForbidden)
		return
	}

	// Reject attempts to archive via PUT — use POST /api/issues/{id}/archive instead
	if i.Status == StatusArchive {
		http.Error(w, "Use POST /api/issues/{id}/archive to archive an issue", http.StatusBadRequest)
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
	updated, err := GetIssueByID(id)
	if err != nil {
		slog.Error("UpdateIssue: failed to fetch updated issue", "id", id, "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	newEtag := updated.UpdatedAt.UTC().Format(time.RFC3339Nano)
	w.Header().Set("ETag", `"`+newEtag+`"`)
	json.NewEncoder(w).Encode(updated)
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
		if !Can(GetRoleFromContext(r.Context()), ActionCreateTask) {
			denyForbidden(w, r, ActionCreateTask)
			return
		}
		handleCreateTask(w, r)
	default:
		http.Error(w, errMsgMethodNotAllowed, http.StatusMethodNotAllowed)
	}
}

func handleCreateTask(w http.ResponseWriter, r *http.Request) {
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
		if !Can(GetRoleFromContext(r.Context()), ActionUpdateTask) {
			denyForbidden(w, r, ActionUpdateTask)
			return
		}
		handlePutTask(w, r, id)
	case "DELETE":
		if !Can(GetRoleFromContext(r.Context()), ActionDeleteTask) {
			denyForbidden(w, r, ActionDeleteTask)
			return
		}
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
		if !Can(GetRoleFromContext(r.Context()), ActionListLabels) {
			denyForbidden(w, r, ActionListLabels)
			return
		}
		labels, err := GetAllLabels()
		if err != nil {
			slog.Error("GetAllLabels failed", "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(labels)
	case "POST":
		if !Can(GetRoleFromContext(r.Context()), ActionCreateLabel) {
			denyForbidden(w, r, ActionCreateLabel)
			return
		}
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
		if !Can(GetRoleFromContext(r.Context()), ActionDeleteLabel) {
			denyForbidden(w, r, ActionDeleteLabel)
			return
		}
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

// -----------------------------------------------------------------------------
// Auth Handlers
// -----------------------------------------------------------------------------

// loginRequest represents the expected JSON body for login.
type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// HandleLogin handles POST /api/auth/login.
// Validates credentials and sets JWT cookies on success.
func HandleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, errMsgMethodNotAllowed, http.StatusMethodNotAllowed)
		return
	}

	var req loginRequest
	if json.NewDecoder(r.Body).Decode(&req) != nil {
		http.Error(w, errMsgInvalidRequestBody, http.StatusBadRequest)
		return
	}

	user, err := GetUserByEmail(req.Email)
	if err != nil {
		slog.Error("Login: database error", "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	if user == nil {
		slog.Warn(errMsgFailedLogin, "email", req.Email, "reason", "user_not_found")
		http.Error(w, errMsgInvalidCreds, http.StatusUnauthorized)
		return
	}

	if !user.Active {
		slog.Warn("Failed login attempt", "email", user.Email, "reason", "inactive_user")
		http.Error(w, errMsgInvalidCreds, http.StatusUnauthorized)
		return
	}

	if !CheckPassword(user.PasswordHash, req.Password) {
		slog.Warn(errMsgFailedLogin, "email", req.Email, "reason", "invalid_password")
		http.Error(w, errMsgInvalidCreds, http.StatusUnauthorized)
		return
	}

	// Use Auth Service to create session
	session, accessToken, refreshToken, err := CreateUserSession(user)
	if err != nil {
		slog.Error("Login: failed to create session", "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}

	SetAuthCookies(w, accessToken, refreshToken)
	slog.Info("Successful login", "email", user.Email, "session_id", session.ID)

	w.Header().Set(headerContentType, contentTypeJSON)
	json.NewEncoder(w).Encode(map[string]any{
		"user": user,
	})
}

// HandleLogout handles POST /api/auth/logout.
// Clears auth cookies.
func HandleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, errMsgMethodNotAllowed, http.StatusMethodNotAllowed)
		return
	}

	// Parse refresh token to find session ID
	if cookie, err := r.Cookie(cookieRefreshToken); err == nil {
		sessionID, _, err := ValidateRefreshToken(cookie.Value)
		if err == nil {
			// Revoke via service method
			if err := RevokeSession(sessionID); err != nil {
				// If session not found, it's already revoked/expired, which is fine for logout
				if err.Error() == "session not found" {
					slog.Info("Logout: session already revoked or not found", "session_id", sessionID)
				} else {
					slog.Warn("Logout: failed to revoke session", "session_id", sessionID, "error", err)
				}
			}
		}
	}

	// Extract user email for logging before clearing cookies
	email := "unknown"
	if cookie, err := r.Cookie(cookieAccessToken); err == nil {
		if claims, err := ValidateToken(cookie.Value); err == nil {
			email = claims.Email
		}
	}

	ClearAuthCookies(w)
	slog.Info("Successful logout", "email", email)

	w.Header().Set(headerContentType, contentTypeJSON)
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "Logged out"})
}

// HandleRefresh handles POST /api/auth/refresh.
// Validates the refresh token, checks user is still active, and issues a new access token.
func HandleRefresh(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, errMsgMethodNotAllowed, http.StatusMethodNotAllowed)
		return
	}

	cookie, err := r.Cookie(cookieRefreshToken)
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Use Auth Service to refresh session
	user, accessToken, newRefreshToken, err := RefreshSession(cookie.Value)
	if err != nil {
		// Log specific error for debugging
		slog.Warn("Refresh failed", "error", err)

		// If it was a reuse detection or invalid token, RefreshSession already handled cleanup/revocation logic implicitly?
		// Actually RefreshSession does cleanup (DeleteSession) on errors.
		// We just need to clear cookies and return 401.
		ClearAuthCookies(w)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Set Cookies
	SetAuthCookies(w, accessToken, newRefreshToken)

	slog.Info("Token refresh successful (rotated)", "email", user.Email, "user_id", user.ID)

	w.Header().Set(headerContentType, contentTypeJSON)
	json.NewEncoder(w).Encode(map[string]any{
		"user": user,
	})
}

// HandleCurrentUser handles GET /api/auth/me (get info) and PUT /api/auth/me (update info).
func HandleCurrentUser(w http.ResponseWriter, r *http.Request) {
	userID := GetUserIDFromContext(r.Context())
	if userID == 0 {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	switch r.Method {
	case http.MethodGet:
		handleGetCurrentUser(w, userID)
	case http.MethodPut:
		handleUpdateSelf(w, r, userID)
	default:
		http.Error(w, errMsgMethodNotAllowed, http.StatusMethodNotAllowed)
	}
}

func handleGetCurrentUser(w http.ResponseWriter, userID int) {
	user, err := GetUserByID(userID)
	if err != nil {
		slog.Error("CurrentUser: database error", "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	if user == nil {
		http.Error(w, errMsgUserNotFound, http.StatusNotFound)
		return
	}

	w.Header().Set(headerContentType, contentTypeJSON)
	json.NewEncoder(w).Encode(user)
}

// handleUpdateSelf allows a user to update their own profile (e.g. password).
func handleUpdateSelf(w http.ResponseWriter, r *http.Request, userID int) {
	// Load existing user first
	existing, err := GetUserByID(userID)
	if err != nil {
		slog.Error("UpdateSelf: database error", "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	if existing == nil {
		http.Error(w, errMsgUserNotFound, http.StatusNotFound)
		return
	}

	// We reuse the createUserRequest structure but ignore role/active fields for self-update
	var req createUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		slog.Warn("UpdateSelf: invalid request body", "error", err)
		http.Error(w, errMsgInvalidRequestBody, http.StatusBadRequest)
		return
	}

	// Users can only update their own password for now.
	// Email, FirstName, LastName could be allowed here if desired, but requirements only mention password.
	// For now, we'll only process password updates if provided.

	if req.Password != "" {
		if err := updateUserPassword(existing, req.Password); err != nil {
			slog.Error("UpdateSelf: password error", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
	}

	// Persist changes
	if err := UpdateUser(existing); err != nil {
		slog.Error("UpdateSelf: database error", "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}

	// If password changed, revoke all sessions immediately
	if req.Password != "" {
		if err := RevokeUserSessions(userID); err != nil {
			slog.Error("UpdateSelf: failed to revoke sessions", "user_id", userID, "error", err)
		} else {
			slog.Info("UpdateSelf: sessions revoked", "user_id", userID)
		}
	}

	slog.Info("User updated self", "id", userID, "email", existing.Email)
	w.Header().Set(headerContentType, contentTypeJSON)
	json.NewEncoder(w).Encode(existing)
}

// -----------------------------------------------------------------------------
// User Management Handlers
// -----------------------------------------------------------------------------

// createUserRequest represents the expected JSON body for creating/updating a user.
type createUserRequest struct {
	Email     string   `json:"email"`
	FirstName string   `json:"first_name"`
	LastName  string   `json:"last_name"`
	Password  string   `json:"password,omitempty"`
	Role      UserRole `json:"role"`
	Active    bool     `json:"active"`
}

// HandleUsers handles GET /api/users (list) and POST /api/users (create).
// Requires admin role.
func HandleUsers(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		if !Can(GetRoleFromContext(r.Context()), ActionListUsers) {
			denyForbidden(w, r, ActionListUsers)
			return
		}
		handleListUsers(w)
	case http.MethodPost:
		if !Can(GetRoleFromContext(r.Context()), ActionCreateUser) {
			denyForbidden(w, r, ActionCreateUser)
			return
		}
		handleCreateUser(w, r)
	default:
		http.Error(w, errMsgMethodNotAllowed, http.StatusMethodNotAllowed)
	}
}

func handleListUsers(w http.ResponseWriter) {
	users, err := GetAllUsers()
	if err != nil {
		slog.Error("ListUsers: database error", "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}

	w.Header().Set(headerContentType, contentTypeJSON)
	json.NewEncoder(w).Encode(users)
}

func handleCreateUser(w http.ResponseWriter, r *http.Request) {
	var req createUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		slog.Warn("CreateUser: invalid request body", "error", err)
		http.Error(w, errMsgInvalidRequestBody, http.StatusBadRequest)
		return
	}

	user := &User{
		Email:     strings.TrimSpace(req.Email),
		FirstName: strings.TrimSpace(req.FirstName),
		LastName:  strings.TrimSpace(req.LastName),
		Role:      req.Role,
		Active:    req.Active,
	}

	if err := validateUser(user); err != nil {
		slog.Warn("CreateUser: validation failed", "error", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if req.Password == "" {
		slog.Warn("CreateUser: password missing")
		http.Error(w, "Password is required", http.StatusBadRequest)
		return
	}

	if err := ValidatePassword(req.Password, user.Email); err != nil {
		slog.Warn("CreateUser: password validation failed", "error", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	hash, err := HashPassword(req.Password)
	if err != nil {
		slog.Error("CreateUser: failed to hash password", "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	user.PasswordHash = hash

	if err := CreateUser(user); err != nil {
		if err == ErrDuplicateEmail {
			slog.Warn("CreateUser: duplicate email", "email", user.Email)
			http.Error(w, "Email already exists", http.StatusConflict)
			return
		}
		slog.Error("CreateUser: database error", "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}

	slog.Info("User created", "email", user.Email, "role", user.Role)
	w.Header().Set(headerContentType, contentTypeJSON)
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(user)
}

// HandleUser handles GET /api/users/{id} and PUT /api/users/{id}.
// Requires admin role.
func HandleUser(w http.ResponseWriter, r *http.Request) {
	// Extract ID from URL path: /api/users/{id}
	idStr := strings.TrimPrefix(r.URL.Path, "/api/users/")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, errMsgInvalidID, http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodGet:
		if !Can(GetRoleFromContext(r.Context()), ActionGetUser) {
			denyForbidden(w, r, ActionGetUser)
			return
		}
		handleGetUser(w, id)
	case http.MethodPut:
		if !Can(GetRoleFromContext(r.Context()), ActionUpdateUser) {
			denyForbidden(w, r, ActionUpdateUser)
			return
		}
		handleUpdateUser(w, r, id)
	default:
		http.Error(w, errMsgMethodNotAllowed, http.StatusMethodNotAllowed)
	}
}

func handleGetUser(w http.ResponseWriter, id int) {
	user, err := GetUserByID(id)
	if err != nil {
		slog.Error("GetUser: database error", "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	if user == nil {
		http.Error(w, errMsgUserNotFound, http.StatusNotFound)
		return
	}

	w.Header().Set(headerContentType, contentTypeJSON)
	json.NewEncoder(w).Encode(user)
}

func handleUpdateUser(w http.ResponseWriter, r *http.Request, id int) {
	// Load existing user first
	existing, err := GetUserByID(id)
	if err != nil {
		slog.Error("UpdateUser: database error", "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	if existing == nil {
		http.Error(w, errMsgUserNotFound, http.StatusNotFound)
		return
	}

	var req createUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		slog.Warn("UpdateUser: invalid request body", "error", err)
		http.Error(w, errMsgInvalidRequestBody, http.StatusBadRequest)
		return
	}

	existing.Email = strings.TrimSpace(req.Email)
	existing.FirstName = strings.TrimSpace(req.FirstName)
	existing.LastName = strings.TrimSpace(req.LastName)

	if err := checkLastAdminProtection(existing, req.Role, req.Active); err != nil {
		slog.Warn("UpdateUser: last admin protection triggered", "error", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	originalRole := existing.Role
	existing.Role = req.Role
	existing.Active = req.Active

	if err := validateUser(existing); err != nil {
		slog.Warn("UpdateUser: validation failed", "error", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Check if we need to revoke sessions (Security: Immediate Logout)
	revokeSessions := false
	if !req.Active || req.Password != "" || originalRole != req.Role {
		revokeSessions = true
	}

	if err := updateUserPassword(existing, req.Password); err != nil {
		slog.Error("UpdateUser: password error", "error", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if err := UpdateUser(existing); err != nil {
		if err == ErrDuplicateEmail {
			slog.Warn("UpdateUser: duplicate email", "email", existing.Email)
			http.Error(w, "Email already exists", http.StatusConflict)
			return
		}
		slog.Error("UpdateUser: database error", "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}

	// If deactivated or password changed, revoke all sessions immediately
	if revokeSessions {
		if err := RevokeUserSessions(id); err != nil {
			slog.Error("UpdateUser: failed to revoke sessions", "user_id", id, "error", err)
			// Non-fatal for the update, but log it as error
		} else {
			slog.Info("UpdateUser: sessions revoked", "user_id", id)
		}
	}

	slog.Info("User updated", "id", id, "email", existing.Email)
	w.Header().Set(headerContentType, contentTypeJSON)
	json.NewEncoder(w).Encode(existing)
}

func checkLastAdminProtection(existing *User, newRole UserRole, newActive bool) error {
	// Prevent deactivating or demoting the last active administrator
	if existing.Role == RoleAdmin && existing.Active {
		if newRole != RoleAdmin || !newActive {
			adminCount, err := CountActiveAdmins()
			if err != nil {
				return fmt.Errorf("failed to check admin count")
			}
			if adminCount <= 1 {
				return fmt.Errorf("Cannot deactivate or demote the last active administrator")
			}
		}
	}
	return nil
}

func updateUserPassword(user *User, newPassword string) error {
	if newPassword == "" {
		return nil
	}
	if err := ValidatePassword(newPassword, user.Email); err != nil {
		return err
	}
	hash, err := HashPassword(newPassword)
	if err != nil {
		return fmt.Errorf("failed to hash password")
	}
	user.PasswordHash = hash
	return nil
}
