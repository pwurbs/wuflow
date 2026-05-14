package backend

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
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
	errMsgInvalidLabel        = "Invalid label ID"
	errMsgInvalidAssignee     = "Invalid or inactive assignee"
	headerContentType         = "Content-Type"
	contentTypeJSON           = "application/json"
	loginPath                 = "/login"
	errMsgInvalidRequestBody  = "Invalid request body"
	errMsgFailedLogin         = "Failed login attempt"
	errMsgInvalidCreds        = "Invalid email or password"
	errMsgTooManyAttempts     = "Too many login attempts, please try again later"
	errMsgLabelNotFound       = "Label not found"
	errMsgNotFound            = "Resource not found"
	errMsgProjectNotFound     = "Project not found"
	errMsgInvalidProject      = "Invalid project ID"
	errMsgDefaultProject      = "Cannot delete or rename the default project"
	errMsgProjectHasIssues    = "Cannot delete project with assigned issues"
	errMsgReleaseNotFound       = "Release not found"
	errMsgInvalidRelease        = "Invalid release ID"
	errMsgClosedReleaseReadOnly = "Closed releases are read-only"
	errMsgDuplicateReleaseName  = "Release name already exists in this project"
)

// errAdminCheckDB is a sentinel returned by checkLastSysAdminProtection when the
// sysadmin-count query fails. It lets callers distinguish a server-side DB error
// (→ 500) from a business-logic validation error (→ 400) without leaking the
// internal error detail to the client.
var errAdminCheckDB = errors.New("internal admin count check failed")

// denyForbidden logs a permission-denied warning and writes a 403 response.
func denyForbidden(w http.ResponseWriter, r *http.Request, action Action) {
	email := GetEmailFromContext(r.Context())
	slog.Warn("Permission denied", "action", action, "role", GetRoleFromContext(r.Context()), "email", strings.ReplaceAll(email, "\n", ""), "method", strings.ReplaceAll(r.Method, "\n", ""), "path", strings.ReplaceAll(r.URL.Path, "\n", ""))
	http.Error(w, errMsgForbidden, http.StatusForbidden)
}

// checkAssignee verifies AssigneeID against the DB
func checkAssignee(w http.ResponseWriter, i *Issue, current *Issue, userEmail string) bool {
	if i.AssigneeID == nil {
		return true
	}

	if current == nil || current.AssigneeID == nil || *i.AssigneeID != *current.AssigneeID {
		// New assignee: must exist and be active
		active, err := UserExistsAndActive(*i.AssigneeID)
		if err != nil {
			slog.Error("Validate: UserExistsAndActive failed", "error", err, "user_email", userEmail)
			http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
			return false
		}
		if !active {
			slog.Warn("Validate: Invalid or inactive assignee", "assignee_id", *i.AssigneeID, "user_email", userEmail)
			http.Error(w, errMsgInvalidAssignee, http.StatusBadRequest)
			return false
		}
		return true
	}

	// Same assignee: must exist (can be inactive now)
	exists, err := UserExists(*i.AssigneeID)
	if err != nil {
		slog.Error("Validate: UserExists failed", "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return false
	}
	if !exists {
		slog.Warn("Validate: Assignee no longer exists", "assignee_id", *i.AssigneeID, "user_email", userEmail)
		http.Error(w, "Assignee no longer exists", http.StatusBadRequest)
		return false
	}

	return true
}

// checkLabel verifies Label exists and belongs to the issue's project.
func checkLabel(w http.ResponseWriter, i *Issue, userEmail string) bool {
	if i.Label == nil {
		return true
	}

	exists, err := LabelExistsInProject(i.Label.ID, i.ProjectID)
	if err != nil {
		slog.Error("Validate: LabelExistsInProject failed", "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return false
	}
	if !exists {
		slog.Warn("Validate: Label not found or wrong project", "label_id", i.Label.ID, "project_id", i.ProjectID, "user_email", userEmail)
		http.Error(w, errMsgInvalidLabel, http.StatusBadRequest)
		return false
	}

	return true
}

// checkRelease verifies ReleaseID exists and belongs to the issue's project.
func checkRelease(w http.ResponseWriter, i *Issue, userEmail string) bool {
	if i.ReleaseID == nil {
		return true
	}
	exists, err := ReleaseExistsInProject(*i.ReleaseID, i.ProjectID)
	if err != nil {
		slog.Error("Validate: ReleaseExistsInProject failed", "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return false
	}
	if !exists {
		slog.Warn("Validate: Release not found or wrong project", "release_id", *i.ReleaseID, "project_id", i.ProjectID, "user_email", userEmail)
		http.Error(w, errMsgInvalidRelease, http.StatusBadRequest)
		return false
	}
	return true
}

// checkProject verifies ProjectID against the DB.
func checkProject(w http.ResponseWriter, i *Issue, userEmail string) bool {
	if i.ProjectID == 0 {
		// Default to project 1 if not set
		i.ProjectID = 1
		return true
	}

	exists, err := ProjectExists(i.ProjectID)
	if err != nil {
		slog.Error("Validate: ProjectExists failed", "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return false
	}
	if !exists {
		slog.Warn("Validate: Invalid project ID", "project_id", i.ProjectID, "user_email", userEmail)
		http.Error(w, errMsgInvalidProject, http.StatusBadRequest)
		return false
	}

	return true
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
		if !decodeAndValidate(w, r, &i, validateIssue) {
			return
		}

		// Get creator ID from context and set it
		i.CreatorID = GetUserIDFromContext(r.Context())
		// Set UpdaterID to CreatorID initially
		i.UpdaterID = &i.CreatorID

		userEmail := GetEmailFromContext(r.Context())

		// Validate AssigneeID, Label, Project and Release against the database
		if !checkAssignee(w, &i, nil, userEmail) || !checkLabel(w, &i, userEmail) || !checkProject(w, &i, userEmail) || !checkRelease(w, &i, userEmail) {
			return
		}

		if err := CreateIssue(&i); err != nil {
			slog.Error("CreateIssue failed", "error", err, "user_email", userEmail)
			http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
			return
		}

		// Re-fetch to get full details (Creator, Assignee, etc.)
		created, err := GetIssueByID(i.ID)
		if err != nil {
			slog.Error("CreateIssue: failed to fetch created issue", "id", i.ID, "error", err, "user_email", userEmail)
			http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
			return
		}

		slog.Info("Issue created", "id", i.ID, "user_email", userEmail)
		w.Header().Set(headerContentType, contentTypeJSON)
		w.WriteHeader(http.StatusCreated)
		if err := json.NewEncoder(w).Encode(created); err != nil {
			slog.Error("CreateIssue: failed to encode response", "error", err, "user_email", userEmail)
		}
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
		slog.Warn("Invalid issue ID", "error", err)
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
		handleArchiveIssue(w, r, id)
	case "unarchive":
		if r.Method != "POST" {
			http.Error(w, errMsgMethodNotAllowed, http.StatusMethodNotAllowed)
			return
		}
		if !Can(GetRoleFromContext(r.Context()), ActionUnarchiveIssue) {
			denyForbidden(w, r, ActionUnarchiveIssue)
			return
		}
		handleUnarchiveIssue(w, r, id)
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
		handleDeleteIssue(w, r, id)
	default:
		http.Error(w, errMsgMethodNotAllowed, http.StatusMethodNotAllowed)
	}
}

// handleGetIssue retrieves a single issue by ID and serves it with an ETag header.
func handleGetIssue(w http.ResponseWriter, id int) {
	issue, err := GetIssueByID(id)
	if err != nil {
		slog.Error("GetIssueByID failed", "id", id, "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	if issue == nil {
		http.Error(w, errMsgIssueNotFound, http.StatusNotFound)
		return
	}
	// Set ETag header based on updated_at timestamp
	etag := issue.UpdatedAt.UTC().Format(time.RFC3339Nano)
	w.Header().Set("ETag", `"`+etag+`"`)
	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(issue); err != nil {
		slog.Error("handleGetIssue: failed to encode response", "id", id, "error", err)
	}
}

type archiveToggleOpts struct {
	valid      func(IssueStatus) bool
	newStatus  IssueStatus
	badMsg     string
	logAction  string
	respondMsg string
}

// handleIssueArchiveToggle is the shared implementation for archive and unarchive.
func handleIssueArchiveToggle(w http.ResponseWriter, r *http.Request, id int, opts archiveToggleOpts) {
	userEmail := GetEmailFromContext(r.Context())

	current, err := GetIssueByID(id)
	if err != nil {
		slog.Error("GetIssueByID failed for "+opts.logAction, "id", id, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	if current == nil {
		http.Error(w, errMsgIssueNotFound, http.StatusNotFound)
		return
	}
	if !opts.valid(current.Status) {
		slog.Warn(opts.badMsg, "id", id, "user_email", userEmail)
		http.Error(w, opts.badMsg, http.StatusBadRequest)
		return
	}
	current.Status = opts.newStatus
	if err := UpdateIssue(current); err != nil {
		slog.Error("UpdateIssue failed for "+opts.logAction, "id", id, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	respondWithUpdatedIssue(w, id, opts.respondMsg, userEmail)
}

// handleArchiveIssue sets an issue's status to Archive.
func handleArchiveIssue(w http.ResponseWriter, r *http.Request, id int) {
	handleIssueArchiveToggle(w, r, id, archiveToggleOpts{
		valid:      func(s IssueStatus) bool { return s != StatusArchive },
		newStatus:  StatusArchive,
		badMsg:     "Issue is already archived",
		logAction:  "archive",
		respondMsg: "Issue archived",
	})
}

// handleUnarchiveIssue moves an archived issue back to Done status.
func handleUnarchiveIssue(w http.ResponseWriter, r *http.Request, id int) {
	handleIssueArchiveToggle(w, r, id, archiveToggleOpts{
		valid:      func(s IssueStatus) bool { return s == StatusArchive },
		newStatus:  StatusDone,
		badMsg:     "Issue is not archived",
		logAction:  "unarchive",
		respondMsg: "Issue unarchived",
	})
}

// issueContentHash serializes all meaningful issue fields into a comparable string.
// Position and audit fields (updated_at, updated_by) are excluded by design.
func issueContentHash(i *Issue) string {
	var labelID int
	if i.Label != nil {
		labelID = i.Label.ID
	}
	var assigneeID int
	if i.AssigneeID != nil {
		assigneeID = *i.AssigneeID
	}
	var deadline string
	if i.Deadline != nil {
		deadline = i.Deadline.UTC().Format(time.RFC3339)
	}
	var releaseID int
	if i.ReleaseID != nil {
		releaseID = *i.ReleaseID
	}
	return fmt.Sprintf("%s\x00%s\x00%s\x00%s\x00%d\x00%d\x00%s\x00%v\x00%d\x00%d",
		i.Title, i.Description, i.Status, i.Priority,
		labelID, assigneeID, deadline, i.PlannedDates, i.ProjectID, releaseID)
}

// persistIssueUpdate routes to UpdateIssuePosition (no timestamp recorded) when only position
// changed, or UpdateIssue (full update with timestamp) when content changed.
// Returns false if an error response was already sent.
func persistIssueUpdate(w http.ResponseWriter, i *Issue, current *Issue, userEmail string) bool {
	if issueContentHash(i) == issueContentHash(current) {
		if i.Position != current.Position {
			if err := UpdateIssuePosition(i.ID, i.Position); err != nil {
				if err == ErrIssueNotFound {
					http.Error(w, errMsgIssueNotFound, http.StatusNotFound)
					return false
				}
				slog.Error("UpdateIssuePosition failed", "id", i.ID, "error", err, "user_email", userEmail)
				http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
				return false
			}
		}
		return true
	}
	if err := UpdateIssue(i); err != nil {
		if err == ErrIssueNotFound {
			http.Error(w, errMsgIssueNotFound, http.StatusNotFound)
			return false
		}
		slog.Error("UpdateIssue failed", "id", i.ID, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return false
	}
	return true
}

// handlePutIssue updates an existing non-archived issue, checking for conflicts via the If-Match header.
func handlePutIssue(w http.ResponseWriter, r *http.Request, id int) {
	current, err := GetIssueByID(id)
	if err != nil {
		slog.Error("GetIssueByID failed for put", "id", id, "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	if current == nil {
		http.Error(w, errMsgIssueNotFound, http.StatusNotFound)
		return
	}

	// Check If-Match header for optimistic locking
	ifMatch := r.Header.Get("If-Match")
	if ifMatch != "" {
		if checkIfMatchConflict(w, current, ifMatch) {
			return
		}
	}

	var i Issue
	if !decodeAndValidate(w, r, &i, validateIssue) {
		return
	}

	// Ensure CreatorID is not changed and persists
	i.CreatorID = current.CreatorID

	// Set UpdaterID
	updaterID := GetUserIDFromContext(r.Context())
	i.UpdaterID = &updaterID
	userEmail := GetEmailFromContext(r.Context())

	// Validate AssigneeID, Label, Project and Release against the database
	if !checkAssignee(w, &i, current, userEmail) || !checkLabel(w, &i, userEmail) || !checkProject(w, &i, userEmail) || !checkRelease(w, &i, userEmail) {
		return
	}

	// Archived issues are read-only — use POST /api/issues/{id}/unarchive to restore
	if current.Status == StatusArchive {
		slog.Warn("Attempted update on archived issue", "id", id, "user_email", userEmail)
		http.Error(w, errMsgArchivedReadOnly, http.StatusForbidden)
		return
	}

	// Reject attempts to archive via PUT — use POST /api/issues/{id}/archive instead
	if i.Status == StatusArchive {
		slog.Warn("Attempted archive via PUT", "id", id, "user_email", userEmail)
		http.Error(w, "Use POST /api/issues/{id}/archive to archive an issue", http.StatusBadRequest)
		return
	}

	i.ID = id
	if !persistIssueUpdate(w, &i, current, userEmail) {
		return
	}
	respondWithUpdatedIssue(w, id, "Issue updated", userEmail)
}

// checkIfMatchConflict verifies if the client's If-Match header matches the current issue's ETag.
// Returns true if a conflict is detected (and sends 409 response), false otherwise.
func checkIfMatchConflict(w http.ResponseWriter, current *Issue, ifMatch string) bool {
	currentEtag := `"` + current.UpdatedAt.UTC().Format(time.RFC3339Nano) + `"`
	if ifMatch != currentEtag {
		slog.Info("Conflict detected", "id", current.ID)
		http.Error(w, "Issue has been modified by another user", http.StatusConflict)
		return true
	}
	return false
}

// handleDeleteIssue removes an issue by its ID.
func handleDeleteIssue(w http.ResponseWriter, r *http.Request, id int) {
	userEmail := GetEmailFromContext(r.Context())

	issue, err := GetIssueByID(id)
	if err != nil {
		slog.Error("GetIssueByID failed for delete check", "id", id, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	if issue == nil {
		http.Error(w, errMsgIssueNotFound, http.StatusNotFound)
		return
	}
	if issue.Status == StatusArchive {
		slog.Warn("Attempted to delete archived issue", "id", id, "user_email", userEmail)
		http.Error(w, "Archived issues cannot be deleted", http.StatusForbidden)
		return
	}

	if err := DeleteIssue(id); err != nil {
		if err == ErrIssueNotFound {
			http.Error(w, errMsgIssueNotFound, http.StatusNotFound)
			return
		}
		slog.Error("DeleteIssue failed", "id", id, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	slog.Info("Issue deleted", "id", id, "user_email", userEmail)
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
	if !decodeAndValidate(w, r, &t, validateTask) {
		return
	}

	userEmail := GetEmailFromContext(r.Context())

	if t.IssueID == 0 {
		http.Error(w, "Issue ID is required", http.StatusBadRequest)
		return
	}

	// Check if issue is archived
	issue, err := GetIssueByID(t.IssueID)
	if err != nil {
		slog.Error("GetIssueByID failed for task creation check", "id", t.IssueID, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	if issue == nil {
		slog.Warn("Task creation failed: Issue not found", "issue_id", t.IssueID, "user_email", userEmail)
		http.Error(w, errMsgIssueNotFound, http.StatusBadRequest)
		return
	}
	if issue.Status == StatusArchive {
		slog.Warn("Task creation failed: Issue archived", "issue_id", t.IssueID, "user_email", userEmail)
		http.Error(w, "Cannot add tasks to archived issues", http.StatusForbidden)
		return
	}

	if err := CreateTask(&t); err != nil {
		slog.Error("CreateTask failed", "issue_id", t.IssueID, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	slog.Info("Task created", "id", t.ID, "issue_id", t.IssueID, "user_email", userEmail)
	w.Header().Set(headerContentType, contentTypeJSON)
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(t); err != nil {
		slog.Error("handleCreateTask: failed to encode response", "id", t.ID, "error", err, "user_email", userEmail)
	}
}

// HandleTask handles PUT and DELETE requests for a single task.
func HandleTask(w http.ResponseWriter, r *http.Request) {

	idStr := strings.TrimPrefix(r.URL.Path, "/api/tasks/")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		slog.Warn("Invalid task ID", "error", err)
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
	if !decodeAndValidate(w, r, &t, validateTask) {
		return
	}

	userEmail := GetEmailFromContext(r.Context())

	// Check if parent issue is archived
	task, err := GetTaskByID(id)
	if err != nil {
		slog.Error("GetTaskByID failed for task update check", "id", id, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	if task == nil {
		http.Error(w, errMsgTaskNotFound, http.StatusNotFound)
		return
	}
	issue, err := GetIssueByID(task.IssueID)
	if err != nil {
		slog.Error("GetIssueByID failed for task update check", "id", task.IssueID, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	if issue != nil && issue.Status == StatusArchive {
		slog.Warn("Task update failed: Issue archived", "id", id, "user_email", userEmail)
		http.Error(w, "Tasks of archived issues are read-only", http.StatusForbidden)
		return
	}

	t.ID = id
	if err := UpdateTask(&t); err != nil {
		if err == ErrTaskNotFound {
			http.Error(w, errMsgTaskNotFound, http.StatusNotFound)
			return
		}
		slog.Error("UpdateTask failed", "id", id, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	slog.Info("Task updated", "id", id, "user_email", userEmail)
	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(t); err != nil {
		slog.Error("handlePutTask: failed to encode response", "id", id, "error", err, "user_email", userEmail)
	}
}

// handleDeleteTask removes a task, checking for archived issue status.
func handleDeleteTask(w http.ResponseWriter, id int) {
	// Check if parent issue is archived
	task, err := GetTaskByID(id)
	if err != nil {
		slog.Error("GetTaskByID failed for task delete check", "id", id, "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	if task == nil {
		http.Error(w, errMsgTaskNotFound, http.StatusNotFound)
		return
	}
	issue, err := GetIssueByID(task.IssueID)
	if err != nil {
		slog.Error("GetIssueByID failed for task delete check", "id", task.IssueID, "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
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
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleProjectLabels routes GET and POST for /api/projects/{id}/labels.
func handleProjectLabels(w http.ResponseWriter, r *http.Request, projectID int) {
	switch r.Method {
	case http.MethodGet:
		if !Can(GetRoleFromContext(r.Context()), ActionListLabels) {
			denyForbidden(w, r, ActionListLabels)
			return
		}
		labels, err := GetLabelsByProject(projectID)
		if err != nil {
			slog.Error("GetLabelsByProject failed", "project_id", projectID, "error", err)
			http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
			return
		}
		w.Header().Set(headerContentType, contentTypeJSON)
		if err := json.NewEncoder(w).Encode(labels); err != nil {
			slog.Error("handleProjectLabels: failed to encode response", "error", err)
		}
	case http.MethodPost:
		if !Can(GetRoleFromContext(r.Context()), ActionCreateLabel) {
			denyForbidden(w, r, ActionCreateLabel)
			return
		}
		var l Label
		if !decodeAndValidate(w, r, &l, validateLabel) {
			return
		}
		l.ProjectID = projectID
		userEmail := GetEmailFromContext(r.Context())
		if err := CreateLabel(&l); err != nil {
			slog.Error("CreateLabel failed", "project_id", projectID, "error", err, "user_email", userEmail)
			http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
			return
		}
		slog.Info("Label created", "id", l.ID, "project_id", projectID, "user_email", userEmail)
		w.Header().Set(headerContentType, contentTypeJSON)
		w.WriteHeader(http.StatusCreated)
		if err := json.NewEncoder(w).Encode(l); err != nil {
			slog.Error("handleProjectLabels: failed to encode create response", "error", err)
		}
	default:
		http.Error(w, errMsgMethodNotAllowed, http.StatusMethodNotAllowed)
	}
}

// handleProjectStatusConfig handles GET and PUT for /api/projects/{id}/statusconfig.
func handleProjectStatusConfig(w http.ResponseWriter, r *http.Request, projectID int) {
	switch r.Method {
	case http.MethodGet:
		if !Can(GetRoleFromContext(r.Context()), ActionGetStatusConfig) {
			denyForbidden(w, r, ActionGetStatusConfig)
			return
		}
		cfg, err := GetStatusConfig(projectID)
		if err != nil {
			slog.Error("GetStatusConfig failed", "project_id", projectID, "error", err)
			http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
			return
		}
		w.Header().Set(headerContentType, contentTypeJSON)
		if err := json.NewEncoder(w).Encode(cfg); err != nil {
			slog.Error("handleProjectStatusConfig: failed to encode response", "error", err)
		}
	case http.MethodPut:
		if !Can(GetRoleFromContext(r.Context()), ActionUpdateStatusConfig) {
			denyForbidden(w, r, ActionUpdateStatusConfig)
			return
		}
		var cfg StatusConfig
		if !decodeAndValidate(w, r, &cfg, validateStatusConfig) {
			return
		}
		cfg.ProjectID = projectID
		userEmail := GetEmailFromContext(r.Context())
		if err := UpsertStatusConfig(&cfg); err != nil {
			slog.Error("UpsertStatusConfig failed", "project_id", projectID, "error", err, "user_email", userEmail)
			http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
			return
		}
		slog.Info("Status config updated", "project_id", projectID, "user_email", userEmail)
		w.Header().Set(headerContentType, contentTypeJSON)
		if err := json.NewEncoder(w).Encode(cfg); err != nil {
			slog.Error("handleProjectStatusConfig: failed to encode update response", "error", err)
		}
	default:
		http.Error(w, errMsgMethodNotAllowed, http.StatusMethodNotAllowed)
	}
}

// handleDeleteProjectLabel handles DELETE /api/projects/{id}/labels/{labelId}.
func handleDeleteProjectLabel(w http.ResponseWriter, r *http.Request, projectID, labelID int) {
	if r.Method != http.MethodDelete {
		http.Error(w, errMsgMethodNotAllowed, http.StatusMethodNotAllowed)
		return
	}
	if !Can(GetRoleFromContext(r.Context()), ActionDeleteLabel) {
		denyForbidden(w, r, ActionDeleteLabel)
		return
	}
	userEmail := GetEmailFromContext(r.Context())
	if err := DeleteLabel(labelID, projectID); err != nil {
		if err == ErrLabelNotFound {
			http.Error(w, errMsgLabelNotFound, http.StatusNotFound)
			return
		}
		slog.Error("DeleteLabel failed", "label_id", labelID, "project_id", projectID, "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	slog.Info("Label deleted", "label_id", labelID, "project_id", projectID, "user_email", userEmail)
	w.WriteHeader(http.StatusNoContent)
}

// -----------------------------------------------------------------------------
// Auth Handlers
// -----------------------------------------------------------------------------

// loginRequest represents the expected JSON body for login.
type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// validateLoginRequest ensures an email and password are present and within length limits.
func validateLoginRequest(req *loginRequest) error {
	req.Email = strings.TrimSpace(req.Email)
	if req.Email == "" || !emailRegex.MatchString(req.Email) {
		return ErrInvalidEmail
	}
	if len(req.Email) > MaxEmailLength {
		return ErrEmailTooLong
	}
	if req.Password == "" {
		return errors.New("password is required")
	}
	if utf8.RuneCountInString(req.Password) > MaxPasswordLength {
		return ErrPasswordTooLong
	}
	return nil
}

// HandleLogin handles POST /api/auth/login.
// Validates credentials and sets JWT cookies on success.
func HandleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, errMsgMethodNotAllowed, http.StatusMethodNotAllowed)
		return
	}

	ip := GetClientIP(r)
	if loginLimiter.checkIP(ip) {
		slog.Warn("Login blocked: IP rate limit exceeded", "ip", strings.ReplaceAll(ip, "\n", ""))
		http.Error(w, errMsgTooManyAttempts, http.StatusTooManyRequests)
		return
	}

	var req loginRequest
	if !decodeAndValidate(w, r, &req, validateLoginRequest) {
		return
	}

	if loginLimiter.checkIPAndEmail(ip, req.Email) {
		slog.Warn("Login blocked: IP and email rate limit exceeded", "email", strings.ReplaceAll(req.Email, "\n", ""), "ip", strings.ReplaceAll(ip, "\n", ""))
		dummyPasswordCheck(req.Password)                           // Equalize timing to prevent side channels
		http.Error(w, errMsgInvalidCreds, http.StatusUnauthorized) // we don't reveal the actual cause here
		return
	}

	user, err := GetUserByEmail(req.Email)
	if err != nil {
		slog.Error("Login: database error", "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	if user == nil {
		// Equalise timing with the valid-user path to prevent user enumeration.
		dummyPasswordCheck(req.Password)
		slog.Warn(errMsgFailedLogin, "email", strings.ReplaceAll(req.Email, "\n", ""), "reason", "user_not_found")
		loginLimiter.recordFailure(ip, req.Email)
		http.Error(w, errMsgInvalidCreds, http.StatusUnauthorized)
		return
	}

	if !user.Active {
		dummyPasswordCheck(req.Password) // Equalize timing to prevent side channels
		slog.Warn("Failed login attempt", "email", strings.ReplaceAll(user.Email, "\n", ""), "reason", "inactive_user")
		loginLimiter.recordFailure(ip, req.Email)
		http.Error(w, errMsgInvalidCreds, http.StatusUnauthorized)
		return
	}

	if !CheckPassword(user.PasswordHash, req.Password) {
		slog.Warn(errMsgFailedLogin, "email", strings.ReplaceAll(req.Email, "\n", ""), "reason", "invalid_password")
		loginLimiter.recordFailure(ip, req.Email)
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

	loginLimiter.resetOnSuccess(ip, req.Email)
	SetAuthCookies(w, accessToken, refreshToken)
	slog.Info("Successful login", "email", strings.ReplaceAll(user.Email, "\n", ""), "session_id", session.ID)

	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(map[string]any{
		"user": user,
	}); err != nil {
		slog.Error("HandleLogin: failed to encode response", "error", err)
	}
}

// HandleLogout handles POST /api/auth/logout.
// Clears auth cookies.
func HandleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, errMsgMethodNotAllowed, http.StatusMethodNotAllowed)
		return
	}

	revokeSessionFromCookie(r)
	email := getUserEmailFromCookie(r)

	ClearAuthCookies(w)
	slog.Info("Successful logout", "email", strings.ReplaceAll(email, "\n", ""))

	w.Header().Set(headerContentType, contentTypeJSON)
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(map[string]string{"message": "Logged out"}); err != nil {
		slog.Error("HandleLogout: failed to encode response", "error", err)
	}
}

func revokeSessionFromCookie(r *http.Request) {
	if cookie, err := r.Cookie(cookieRefreshToken); err == nil {
		sessionID, _, err := ValidateRefreshToken(cookie.Value)
		if err == nil {
			if err := RevokeSession(sessionID); err != nil {
				if errors.Is(err, ErrSessionNotFound) {
					slog.Info("Logout: session already revoked or not found", "session_id", strconv.Itoa(sessionID))
				} else {
					slog.Warn("Logout: failed to revoke session", "session_id", strconv.Itoa(sessionID), "error", err)
				}
			}
		}
	}
}

func getUserEmailFromCookie(r *http.Request) string {
	if cookie, err := r.Cookie(cookieAccessToken); err == nil {
		if claims, err := ValidateToken(cookie.Value); err == nil {
			return claims.Email
		}
	}
	return "unknown"
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
		slog.Warn("Refresh failed", "error", err)
		ClearAuthCookies(w)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Set Cookies
	SetAuthCookies(w, accessToken, newRefreshToken)

	slog.Info("Token refresh successful (rotated)", "email", user.Email, "user_id", user.ID)

	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(map[string]any{
		"user": user,
	}); err != nil {
		slog.Error("HandleRefresh: failed to encode response", "error", err)
	}
}

// HandleCurrentUser handles GET /api/auth/me (get info) and PUT /api/auth/me (update info).
func HandleCurrentUser(w http.ResponseWriter, r *http.Request) {
	userID := GetUserIDFromContext(r.Context())
	if userID == 0 {
		slog.Warn("CurrentUser: unauthorized (no user ID in context)")
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
		slog.Warn("CurrentUser: user not found", "user_id", userID)
		http.Error(w, errMsgUserNotFound, http.StatusNotFound)
		return
	}

	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(user); err != nil {
		slog.Error("handleGetCurrentUser: failed to encode response", "user_id", userID, "error", err)
	}
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
		slog.Warn("UpdateSelf: user not found", "user_id", userID)
		http.Error(w, errMsgUserNotFound, http.StatusNotFound)
		return
	}

	// We reuse the createUserRequest structure but ignore role/active fields for self-update
	var req createUserRequest
	if !decodeAndValidate(w, r, &req, func(r *createUserRequest) error { return nil }) {
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
	if err := json.NewEncoder(w).Encode(existing); err != nil {
		slog.Error("handleUpdateSelf: failed to encode response", "user_id", userID, "error", err)
	}
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

// validateCreateUserRequest validates the DTO fields (email, name, role).
// Password policy is checked separately in the handler because it depends on
// the resolved email and is only required on creation.
func validateCreateUserRequest(req *createUserRequest) error {
	req.Email = strings.TrimSpace(req.Email)
	req.FirstName = strings.TrimSpace(req.FirstName)
	req.LastName = strings.TrimSpace(req.LastName)
	if req.Email == "" || !emailRegex.MatchString(req.Email) {
		return ErrInvalidEmail
	}
	if len(req.Email) > MaxEmailLength {
		return ErrEmailTooLong
	}
	if req.FirstName == "" || req.LastName == "" {
		return ErrInvalidName
	}
	if utf8.RuneCountInString(req.FirstName) > MaxUserNameLength || utf8.RuneCountInString(req.LastName) > MaxUserNameLength {
		return ErrUserNameTooLong
	}
	if !isValidRole(req.Role) {
		return ErrInvalidRole
	}
	return nil
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
		handleListUsers(w, r)
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

func handleListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := GetAllUsers()
	if err != nil {
		userEmail := GetEmailFromContext(r.Context())
		slog.Error("ListUsers: database error", "error", err, "admin_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}

	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(users); err != nil {
		slog.Error("handleListUsers: failed to encode response", "error", err, "admin_email", GetEmailFromContext(r.Context()))
	}
}

func handleCreateUser(w http.ResponseWriter, r *http.Request) {
	userEmail := GetEmailFromContext(r.Context())

	var req createUserRequest
	if !decodeAndValidate(w, r, &req, validateCreateUserRequest) {
		return
	}

	user := &User{
		Email:     req.Email, // already trimmed by validateCreateUserRequest
		FirstName: req.FirstName,
		LastName:  req.LastName,
		Role:      req.Role,
		Active:    req.Active,
	}

	if req.Password == "" {
		slog.Warn("CreateUser: password missing", "admin_email", userEmail)
		http.Error(w, "Password is required", http.StatusBadRequest)
		return
	}

	if err := ValidatePassword(req.Password, user.Email); err != nil {
		slog.Warn("CreateUser: password validation failed", "error", err, "admin_email", userEmail)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	hash, err := HashPassword(req.Password)
	if err != nil {
		slog.Error("CreateUser: failed to hash password", "error", err, "admin_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	user.PasswordHash = hash

	if err := CreateUser(user); err != nil {
		if err == ErrDuplicateEmail {
			slog.Warn("CreateUser: duplicate email", "email", user.Email, "admin_email", userEmail)
			http.Error(w, "Email already exists", http.StatusConflict)
			return
		}
		slog.Error("CreateUser: database error", "error", err, "admin_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}

	slog.Info("User created", "email", user.Email, "role", user.Role, "admin_email", userEmail)
	w.Header().Set(headerContentType, contentTypeJSON)
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(user); err != nil {
		slog.Error("handleCreateUser: failed to encode response", "error", err, "admin_email", userEmail)
	}
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
		handleGetUser(w, r, id)
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

func handleGetUser(w http.ResponseWriter, r *http.Request, id int) {
	userEmail := GetEmailFromContext(r.Context())

	user, err := GetUserByID(id)
	if err != nil {
		slog.Error("GetUser: database error", "error", err, "admin_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	if user == nil {
		slog.Warn("GetUser: not found", "target_id", id, "admin_email", userEmail)
		http.Error(w, errMsgUserNotFound, http.StatusNotFound)
		return
	}

	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(user); err != nil {
		slog.Error("handleGetUser: failed to encode response", "error", err, "admin_email", userEmail)
	}
}

func handleUpdateUser(w http.ResponseWriter, r *http.Request, id int) {
	userEmail := GetEmailFromContext(r.Context())

	// Load existing user first
	existing, err := GetUserByID(id)
	if err != nil {
		slog.Error("UpdateUser: database error", "error", err, "admin_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	if existing == nil {
		slog.Warn("UpdateUser: not found", "target_id", id, "admin_email", userEmail)
		http.Error(w, errMsgUserNotFound, http.StatusNotFound)
		return
	}

	var req createUserRequest
	if !decodeAndValidate(w, r, &req, validateCreateUserRequest) {
		return
	}

	revokeSessions, err := validateAndPrepareUserUpdate(existing, req, userEmail)
	if err != nil {
		if errors.Is(err, errAdminCheckDB) {
			http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		} else {
			http.Error(w, err.Error(), http.StatusBadRequest)
		}
		return
	}

	if err := UpdateUser(existing); err != nil {
		if err == ErrDuplicateEmail {
			slog.Warn("UpdateUser: duplicate email", "email", existing.Email, "admin_email", userEmail)
			http.Error(w, "Email already exists", http.StatusConflict)
			return
		}
		slog.Error("UpdateUser: database error", "error", err, "admin_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}

	// If deactivated or password changed, revoke all sessions immediately
	if revokeSessions {
		if err := RevokeUserSessions(id); err != nil {
			slog.Error("UpdateUser: failed to revoke sessions", "user_id", id, "error", err, "admin_email", userEmail)
			// Non-fatal for the update, but log it as error
		} else {
			slog.Info("UpdateUser: sessions revoked", "user_id", id, "admin_email", userEmail)
		}
	}

	slog.Info("User updated", "id", id, "email", existing.Email, "admin_email", userEmail)
	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(existing); err != nil {
		slog.Error("handleUpdateUser: failed to encode response", "error", err, "admin_email", userEmail)
	}
}

func validateAndPrepareUserUpdate(existing *User, req createUserRequest, userEmail string) (bool, error) {
	existing.Email = strings.TrimSpace(req.Email)
	existing.FirstName = strings.TrimSpace(req.FirstName)
	existing.LastName = strings.TrimSpace(req.LastName)

	if err := checkLastSysAdminProtection(existing, req.Role, req.Active); err != nil {
		if !errors.Is(err, errAdminCheckDB) {
			slog.Warn("UpdateUser: last admin protection triggered", "error", err, "admin_email", userEmail)
		}
		return false, err
	}

	originalRole := existing.Role
	existing.Role = req.Role
	existing.Active = req.Active

	if err := validateUser(existing); err != nil {
		slog.Warn("UpdateUser: validation failed", "error", err, "admin_email", userEmail)
		return false, err
	}

	// Check if we need to revoke sessions (Security: Immediate Logout)
	revokeSessions := false
	if !req.Active || req.Password != "" || originalRole != req.Role {
		revokeSessions = true
	}

	if err := updateUserPassword(existing, req.Password); err != nil {
		slog.Error("UpdateUser: password error", "error", err, "admin_email", userEmail)
		return false, err
	}

	return revokeSessions, nil
}

func checkLastSysAdminProtection(existing *User, newRole UserRole, newActive bool) error {
	// Prevent deactivating or demoting the last active system administrator
	if existing.Role == RoleSysAdmin && existing.Active {
		if newRole != RoleSysAdmin || !newActive {
			sysAdminCount, err := CountActiveSysAdmins()
			if err != nil {
				slog.Error("checkLastSysAdminProtection: failed to count active sysadmins", "error", err)
				return errAdminCheckDB
			}
			if sysAdminCount <= 1 {
				return fmt.Errorf("Cannot deactivate or demote the last active system administrator")
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

// respondWithUpdatedIssue fetches the updated issue, sets ETag, logs the action, and writes the JSON response.
func respondWithUpdatedIssue(w http.ResponseWriter, id int, actionLog, userEmail string) {
	updated, err := GetIssueByID(id)
	if err != nil {
		slog.Error("GetIssueByID failed after update", "id", id, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}

	slog.Info(actionLog, "id", id, "user_email", userEmail)

	newEtag := updated.UpdatedAt.UTC().Format(time.RFC3339Nano)
	w.Header().Set("ETag", `"`+newEtag+`"`)
	w.Header().Set(headerContentType, contentTypeJSON)

	if err := json.NewEncoder(w).Encode(updated); err != nil {
		slog.Error("Failed to encode response", "id", id, "error", err, "user_email", userEmail)
	}
}

// decodeAndValidate decodes a JSON request body into the provided struct and validates it using the given function.
// It handles errors by logging them and writing an appropriate HTTP response.
// Returns true if successful, false otherwise.
func decodeAndValidate[T any](w http.ResponseWriter, r *http.Request, v *T, validate func(*T) error) bool {
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		slog.Warn("Failed to decode request", "type", fmt.Sprintf("%T", v), "error", err)
		http.Error(w, errMsgInvalidRequestBody, http.StatusBadRequest)
		return false
	}
	if err := validate(v); err != nil {
		userEmail := GetEmailFromContext(r.Context())
		slog.Warn("Validation failed", "type", fmt.Sprintf("%T", v), "error", err, "user_email", userEmail)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return false
	}
	return true
}

// -----------------------------------------------------------------------------
// Project Handlers
// -----------------------------------------------------------------------------

// HandleProjects handles GET /api/projects (list) and POST /api/projects (create).
func HandleProjects(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		if !Can(GetRoleFromContext(r.Context()), ActionListProjects) {
			denyForbidden(w, r, ActionListProjects)
			return
		}
		handleListProjects(w, r)
	case http.MethodPost:
		if !Can(GetRoleFromContext(r.Context()), ActionCreateProject) {
			denyForbidden(w, r, ActionCreateProject)
			return
		}
		handleCreateProject(w, r)
	default:
		http.Error(w, errMsgMethodNotAllowed, http.StatusMethodNotAllowed)
	}
}

func handleListProjects(w http.ResponseWriter, r *http.Request) {
	projects, err := GetAllProjects()
	if err != nil {
		userEmail := GetEmailFromContext(r.Context())
		slog.Error("ListProjects: database error", "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}

	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(projects); err != nil {
		slog.Error("handleListProjects: failed to encode response", "error", err)
	}
}

func handleCreateProject(w http.ResponseWriter, r *http.Request) {
	userEmail := GetEmailFromContext(r.Context())

	var p Project
	if !decodeAndValidate(w, r, &p, validateProject) {
		return
	}

	if err := CreateProject(&p); err != nil {
		if errors.Is(err, ErrDuplicateProjectName) {
			slog.Warn("CreateProject: name already exists", "name", p.Name, "user_email", userEmail)
			http.Error(w, "Project name already exists", http.StatusConflict)
			return
		}
		slog.Error("CreateProject failed", "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}

	slog.Info("Project created", "id", p.ID, "name", p.Name, "user_email", userEmail)
	w.Header().Set(headerContentType, contentTypeJSON)
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(p); err != nil {
		slog.Error("handleCreateProject: failed to encode response", "error", err, "user_email", userEmail)
	}
}

// HandleProject handles all /api/projects/{id} requests, including issue sub-resources:
//   - PUT    /api/projects/{id}                → update project
//   - DELETE /api/projects/{id}                → delete project
//   - GET    /api/projects/{id}/issues/active  → list active issues for project (excludes Open and Archive)
//   - GET    /api/projects/{id}/issues/archived → list archived issues for project
//   - GET    /api/projects/{id}/issues/open    → list open (backlog) issues for project
//   - GET    /api/projects/{id}/labels         → list labels for project
//   - POST   /api/projects/{id}/labels         → create label for project
//   - DELETE /api/projects/{id}/labels/{lid}   → delete label from project
//   - GET    /api/projects/{id}/statusconfig   → get board stage column config
//   - PUT    /api/projects/{id}/statusconfig   → update board stage column config
func HandleProject(w http.ResponseWriter, r *http.Request) {
	// Strip prefix and split the remainder to detect sub-resource paths.
	rest := strings.TrimPrefix(r.URL.Path, "/api/projects/")
	parts := strings.SplitN(rest, "/", 2)

	id, err := strconv.Atoi(parts[0])
	if err != nil {
		slog.Warn("Invalid project ID", "error", err)
		http.Error(w, errMsgInvalidID, http.StatusBadRequest)
		return
	}

	// Sub-resource routing: /api/projects/{id}/issues/{sub} and /api/projects/{id}/labels[/{labelId}]
	if len(parts) == 2 {
		switch {
		case parts[1] == "issues/active":
			handleProjectActiveIssues(w, r, id)
		case parts[1] == "issues/archived":
			handleProjectArchivedIssues(w, r, id)
		case parts[1] == "issues/open":
			handleProjectOpenIssues(w, r, id)
		case parts[1] == "labels":
			handleProjectLabels(w, r, id)
		case parts[1] == "statusconfig":
			handleProjectStatusConfig(w, r, id)
		case parts[1] == "releases":
			handleProjectReleases(w, r, id)
		case strings.HasPrefix(parts[1], "labels/"):
			labelIDStr := strings.TrimPrefix(parts[1], "labels/")
			labelID, err := strconv.Atoi(labelIDStr)
			if err != nil {
				http.Error(w, errMsgInvalidID, http.StatusBadRequest)
				return
			}
			handleDeleteProjectLabel(w, r, id, labelID)
		default:
			http.Error(w, errMsgNotFound, http.StatusNotFound)
		}
		return
	}

	switch r.Method {
	case http.MethodPut:
		if !Can(GetRoleFromContext(r.Context()), ActionUpdateProject) {
			denyForbidden(w, r, ActionUpdateProject)
			return
		}
		handleUpdateProject(w, r, id)
	case http.MethodDelete:
		if !Can(GetRoleFromContext(r.Context()), ActionDeleteProject) {
			denyForbidden(w, r, ActionDeleteProject)
			return
		}
		handleDeleteProject(w, r, id)
	default:
		http.Error(w, errMsgMethodNotAllowed, http.StatusMethodNotAllowed)
	}
}

// handleProjectActiveIssues handles GET /api/projects/{id}/issues/active.
func projectExists(id int) (bool, error) {
	p, err := GetProjectByID(id)
	if err != nil {
		return false, err
	}
	return p != nil, nil
}

// handleProjectIssues is the shared handler for all project-scoped issue endpoints.
// fetch is the DB function that retrieves the relevant issues for the given projectID.
func handleProjectIssues(w http.ResponseWriter, r *http.Request, projectID int, name string, fetch func(int) ([]Issue, error)) {
	if r.Method != http.MethodGet {
		http.Error(w, errMsgMethodNotAllowed, http.StatusMethodNotAllowed)
		return
	}
	if !Can(GetRoleFromContext(r.Context()), ActionListIssues) {
		denyForbidden(w, r, ActionListIssues)
		return
	}

	if ok, err := projectExists(projectID); err != nil {
		slog.Error(name+": projectExists failed", "project_id", projectID, "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	} else if !ok {
		http.Error(w, errMsgProjectNotFound, http.StatusNotFound)
		return
	}

	issues, err := fetch(projectID)
	if err != nil {
		slog.Error(name+" failed", "project_id", projectID, "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(issues); err != nil {
		slog.Error(name+": failed to encode response", "error", err)
	}
}

func handleProjectActiveIssues(w http.ResponseWriter, r *http.Request, projectID int) {
	handleProjectIssues(w, r, projectID, "handleProjectActiveIssues", GetActiveIssuesByProject)
}

// handleProjectArchivedIssues handles GET /api/projects/{id}/issues/archived.
func handleProjectArchivedIssues(w http.ResponseWriter, r *http.Request, projectID int) {
	handleProjectIssues(w, r, projectID, "handleProjectArchivedIssues", GetArchivedIssuesByProject)
}

// handleProjectOpenIssues handles GET /api/projects/{id}/issues/open.
func handleProjectOpenIssues(w http.ResponseWriter, r *http.Request, projectID int) {
	handleProjectIssues(w, r, projectID, "handleProjectOpenIssues", GetOpenIssuesByProject)
}

// handleProjectReleases routes GET and POST for /api/projects/{id}/releases.
func handleProjectReleases(w http.ResponseWriter, r *http.Request, projectID int) {
	switch r.Method {
	case http.MethodGet:
		handleProjectReleasesGet(w, r, projectID)
	case http.MethodPost:
		handleProjectReleasesPost(w, r, projectID)
	default:
		http.Error(w, errMsgMethodNotAllowed, http.StatusMethodNotAllowed)
	}
}

func handleProjectReleasesGet(w http.ResponseWriter, r *http.Request, projectID int) {
	if !Can(GetRoleFromContext(r.Context()), ActionListReleases) {
		denyForbidden(w, r, ActionListReleases)
		return
	}
	releases, err := GetReleasesByProject(projectID)
	if err != nil {
		slog.Error("GetReleasesByProject failed", "project_id", projectID, "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(releases); err != nil {
		slog.Error("handleProjectReleasesGet: failed to encode response", "error", err)
	}
}

func handleProjectReleasesPost(w http.ResponseWriter, r *http.Request, projectID int) {
	if !Can(GetRoleFromContext(r.Context()), ActionCreateRelease) {
		denyForbidden(w, r, ActionCreateRelease)
		return
	}
	var rel Release
	if !decodeAndValidate(w, r, &rel, validateRelease) {
		return
	}
	rel.ProjectID = projectID
	userEmail := GetEmailFromContext(r.Context())
	if err := CreateRelease(&rel); err != nil {
		if errors.Is(err, ErrDuplicateReleaseName) {
			http.Error(w, errMsgDuplicateReleaseName, http.StatusConflict)
			return
		}
		slog.Error("CreateRelease failed", "project_id", projectID, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	slog.Info("Release created", "id", rel.ID, "project_id", projectID, "user_email", userEmail)
	w.Header().Set(headerContentType, contentTypeJSON)
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(rel); err != nil {
		slog.Error("handleProjectReleasesPost: failed to encode response", "error", err)
	}
}

// HandleRelease handles all /api/releases/{id} requests.
//   - GET    /api/releases/{id}          → get single release
//   - PUT    /api/releases/{id}          → update release
//   - DELETE /api/releases/{id}          → delete release
//   - POST   /api/releases/{id}/release  → trigger release action
func HandleRelease(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/releases/")
	parts := strings.SplitN(rest, "/", 2)

	id, err := strconv.Atoi(parts[0])
	if err != nil {
		slog.Warn("Invalid release ID", "error", err)
		http.Error(w, errMsgInvalidID, http.StatusBadRequest)
		return
	}

	if len(parts) == 2 {
		if r.Method != http.MethodPost {
			http.Error(w, errMsgMethodNotAllowed, http.StatusMethodNotAllowed)
			return
		}
		if !Can(GetRoleFromContext(r.Context()), ActionTriggerRelease) {
			denyForbidden(w, r, ActionTriggerRelease)
			return
		}
		switch parts[1] {
		case "release":
			handleTriggerRelease(w, r, id)
		case "reopen":
			handleReopenRelease(w, r, id)
		default:
			http.Error(w, errMsgMethodNotAllowed, http.StatusMethodNotAllowed)
		}
		return
	}

	switch r.Method {
	case http.MethodGet:
		if !Can(GetRoleFromContext(r.Context()), ActionListReleases) {
			denyForbidden(w, r, ActionListReleases)
			return
		}
		handleGetRelease(w, id)
	case http.MethodPut:
		if !Can(GetRoleFromContext(r.Context()), ActionUpdateRelease) {
			denyForbidden(w, r, ActionUpdateRelease)
			return
		}
		handlePutRelease(w, r, id)
	case http.MethodDelete:
		if !Can(GetRoleFromContext(r.Context()), ActionDeleteRelease) {
			denyForbidden(w, r, ActionDeleteRelease)
			return
		}
		handleDeleteRelease(w, r, id)
	default:
		http.Error(w, errMsgMethodNotAllowed, http.StatusMethodNotAllowed)
	}
}

func handleGetRelease(w http.ResponseWriter, id int) {
	rel, err := GetReleaseByID(id)
	if err != nil {
		slog.Error("GetReleaseByID failed", "id", id, "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	if rel == nil {
		http.Error(w, errMsgReleaseNotFound, http.StatusNotFound)
		return
	}
	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(rel); err != nil {
		slog.Error("handleGetRelease: failed to encode response", "error", err)
	}
}

func handlePutRelease(w http.ResponseWriter, r *http.Request, id int) {
	var rel Release
	if !decodeAndValidate(w, r, &rel, validateRelease) {
		return
	}
	rel.ID = id
	userEmail := GetEmailFromContext(r.Context())
	current, err := GetReleaseByID(id)
	if err != nil {
		slog.Error("GetReleaseByID failed", "id", id, "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	if current == nil {
		http.Error(w, errMsgReleaseNotFound, http.StatusNotFound)
		return
	}
	if current.Status == ReleaseStatusClosed {
		slog.Warn("Attempted update on closed release", "id", id, "user_email", userEmail)
		http.Error(w, errMsgClosedReleaseReadOnly, http.StatusForbidden)
		return
	}
	if err := UpdateRelease(&rel); err != nil {
		if errors.Is(err, ErrReleaseNotFound) {
			http.Error(w, errMsgReleaseNotFound, http.StatusNotFound)
			return
		}
		if errors.Is(err, ErrDuplicateReleaseName) {
			http.Error(w, errMsgDuplicateReleaseName, http.StatusConflict)
			return
		}
		slog.Error("UpdateRelease failed", "id", id, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	slog.Info("Release updated", "id", id, "user_email", userEmail)
	updated, err := GetReleaseByID(id)
	if err != nil || updated == nil {
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(updated); err != nil {
		slog.Error("handlePutRelease: failed to encode response", "error", err)
	}
}

func handleDeleteRelease(w http.ResponseWriter, r *http.Request, id int) {
	userEmail := GetEmailFromContext(r.Context())
	if err := DeleteRelease(id); err != nil {
		if errors.Is(err, ErrReleaseNotFound) {
			http.Error(w, errMsgReleaseNotFound, http.StatusNotFound)
			return
		}
		slog.Error("DeleteRelease failed", "id", id, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	slog.Info("Release deleted", "id", id, "user_email", userEmail)
	w.WriteHeader(http.StatusNoContent)
}

// handleTriggerRelease sets a release to 'closed' and optionally archives Done issues.
func handleTriggerRelease(w http.ResponseWriter, r *http.Request, id int) {
	var body struct {
		ArchiveDone bool `json:"archive_done"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, errMsgInvalidRequestBody, http.StatusBadRequest)
		return
	}
	userEmail := GetEmailFromContext(r.Context())
	if err := TriggerRelease(id, body.ArchiveDone); err != nil {
		if errors.Is(err, ErrReleaseNotFound) {
			http.Error(w, errMsgReleaseNotFound, http.StatusNotFound)
			return
		}
		slog.Error("TriggerRelease failed", "id", id, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	slog.Info("Release triggered", "id", id, "archive_done", body.ArchiveDone, "user_email", userEmail)
	updated, err := GetReleaseByID(id)
	if err != nil || updated == nil {
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(updated); err != nil {
		slog.Error("handleTriggerRelease: failed to encode response", "error", err)
	}
}

func handleReopenRelease(w http.ResponseWriter, r *http.Request, id int) {
	userEmail := GetEmailFromContext(r.Context())
	if err := ReopenRelease(id); err != nil {
		if errors.Is(err, ErrReleaseNotFound) {
			http.Error(w, errMsgReleaseNotFound, http.StatusNotFound)
			return
		}
		slog.Error("ReopenRelease failed", "id", id, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	slog.Info("Release reopened", "id", id, "user_email", userEmail)
	updated, err := GetReleaseByID(id)
	if err != nil || updated == nil {
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(updated); err != nil {
		slog.Error("handleReopenRelease: failed to encode response", "error", err)
	}
}

func handleUpdateProject(w http.ResponseWriter, r *http.Request, id int) {
	userEmail := GetEmailFromContext(r.Context())

	var p Project
	if !decodeAndValidate(w, r, &p, validateProject) {
		return
	}

	p.ID = id
	if err := UpdateProject(&p); err != nil {
		if errors.Is(err, ErrProjectNotFound) {
			slog.Warn("UpdateProject: project not found", "id", id, "user_email", userEmail)
			http.Error(w, errMsgProjectNotFound, http.StatusNotFound)
			return
		}
		if errors.Is(err, ErrDuplicateProjectName) {
			slog.Warn("UpdateProject: name already exists", "id", id, "name", p.Name, "user_email", userEmail)
			http.Error(w, "Project name already exists", http.StatusConflict)
			return
		}
		slog.Error("UpdateProject failed", "id", id, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}

	slog.Info("Project updated", "id", id, "name", p.Name, "user_email", userEmail)
	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(p); err != nil {
		slog.Error("handleUpdateProject: failed to encode response", "id", id, "error", err, "user_email", userEmail)
	}
}

func handleDeleteProject(w http.ResponseWriter, r *http.Request, id int) {
	userEmail := GetEmailFromContext(r.Context())

	// Prevent deleting the default project
	if id == 1 {
		slog.Warn("Attempt to delete default project blocked", "id", id, "user_email", userEmail)
		http.Error(w, errMsgDefaultProject, http.StatusBadRequest)
		return
	}

	// Prevent deleting projects that still have issues
	count, err := CountIssuesByProject(id)
	if err != nil {
		slog.Error("DeleteProject: CountIssuesByProject failed", "id", id, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	if count > 0 {
		slog.Warn("Attempt to delete project with assigned issues blocked", "id", id, "count", count, "user_email", userEmail)
		http.Error(w, errMsgProjectHasIssues, http.StatusBadRequest)
		return
	}

	if err := DeleteProject(id); err != nil {
		if errors.Is(err, ErrProjectNotFound) {
			slog.Warn("DeleteProject: project not found", "id", id, "user_email", userEmail)
			http.Error(w, errMsgProjectNotFound, http.StatusNotFound)
			return
		}
		slog.Error("DeleteProject failed", "id", id, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}

	slog.Info("Project deleted", "id", id, "user_email", userEmail)
	w.Header().Set(headerContentType, contentTypeJSON)
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(map[string]string{"message": "Project deleted"}); err != nil {
		slog.Error("handleDeleteProject: failed to encode response", "id", id, "error", err, "user_email", userEmail)
	}
}
