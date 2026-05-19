package backend

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	errMsgForbidden             = "Forbidden"
	errMsgInvalidID             = "Invalid ID"
	errMsgIssueNotFound         = "Issue not found"
	errMsgTaskNotFound          = "Task not found"
	errMsgArchivedReadOnly      = "Archived issues are read-only"
	errMsgInternalServerError   = "Internal server error"
	errMsgUserNotFound          = "User not found"
	errMsgInvalidLabel          = "Invalid label ID"
	errMsgInvalidAssignee       = "Invalid or inactive assignee"
	headerContentType           = "Content-Type"
	contentTypeJSON             = "application/json"
	loginPath                   = "/login"
	errMsgInvalidRequestBody    = "Invalid request body"
	errMsgFailedLogin           = "Failed login attempt"
	errMsgInvalidCreds          = "Invalid email or password"
	errMsgTooManyAttempts       = "Too many login attempts, please try again later"
	errMsgLabelNotFound         = "Label not found"
	errMsgProjectNotFound       = "Project not found"
	errMsgInvalidProject        = "Invalid project ID"
	errMsgDefaultProject        = "Cannot delete or rename the default project"
	errMsgProjectHasIssues      = "Cannot delete project with assigned issues"
	errMsgReleaseNotFound       = "Release not found"
	errMsgInvalidRelease        = "Invalid release ID"
	errMsgClosedReleaseReadOnly = "Closed releases are read-only"
	errMsgDuplicateReleaseName  = "Release name already exists in this project"
	errMsgUnauthorized          = "Unauthorized"
)

// errAdminCheckDB is a sentinel returned by checkLastSysAdminProtection when the
// sysadmin-count query fails. It lets callers distinguish a server-side DB error
// (→ 500) from a business-logic validation error (→ 400) without leaking the
// internal error detail to the client.
var errAdminCheckDB = errors.New("internal admin count check failed")

// formatETag returns the ETag header value for a timestamp (quoted RFC3339Nano).
func formatETag(t time.Time) string {
	return `"` + t.UTC().Format(time.RFC3339Nano) + `"`
}

// denyForbidden logs a permission-denied warning and writes a 403 response.
func denyForbidden(w http.ResponseWriter, r *http.Request, action Action) {
	email := GetEmailFromContext(r.Context())
	LogWarn("Permission denied", "action", action, "role", GetRoleFromContext(r.Context()), "email", email, "method", r.Method, "path", r.URL.Path)
	http.Error(w, errMsgForbidden, http.StatusForbidden)
}

// HandleGetVersion returns a handler that responds with the build version
// as a JSON object. Constructed at startup (the version string is embedded
// by the build); the returned closure is reused per request.
func HandleGetVersion(version string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set(headerContentType, contentTypeJSON)
		if err := json.NewEncoder(w).Encode(map[string]string{"version": version}); err != nil {
			LogError("HandleGetVersion: failed to encode response", "error", err)
		}
	}
}

// -----------------------------------------------------------------------------
// Routing factories
//
// Every protected route flows through one of the factories below so each
// inner handler stays focused on business logic. All four factories enforce a
// strict order: role-based permission check first (so tests asserting 403
// don't need a DB), then path-variable parsing, project existence, and finally
// resource ownership. What differs between them is how much of that chain
// applies — see the table in docs/backend-architecture.md.
// -----------------------------------------------------------------------------

// checkProjectAccess validates that {pId} from the URL is a positive int and
// the project exists. Returns the project ID and ok=true on success; writes the
// appropriate HTTP error and returns ok=false on failure.
//
// TODO(per-project-membership): This is the SINGLE insertion point for
// per-project membership enforcement. When the project_users table is
// introduced, add the membership lookup here (after project existence,
// before returning ok). All project-scoped routes flow through this helper
// via withProject / withProjectResource, so no other handler will change.
func checkProjectAccess(w http.ResponseWriter, r *http.Request) (int, bool) {
	pID, err := strconv.Atoi(r.PathValue(pathParamProjectID))
	if err != nil || pID <= 0 {
		http.Error(w, errMsgInvalidProject, http.StatusBadRequest)
		return 0, false
	}
	exists, err := ProjectExists(r.Context(), pID)
	if err != nil {
		LogError("checkProjectAccess: ProjectExists failed", "project_id", pID, "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return 0, false
	}
	if !exists {
		http.Error(w, errMsgProjectNotFound, http.StatusNotFound)
		return 0, false
	}
	return pID, true
}

// Path variable names used in route patterns registered with http.ServeMux.
const (
	pathParamProjectID  = "pId"
	pathParamIssueID    = "iId"
	pathParamResourceID = "id"
)

// resourceIDFromPath parses an integer path variable, writing 400 on failure.
func resourceIDFromPath(w http.ResponseWriter, r *http.Request, name string) (int, bool) {
	id, err := strconv.Atoi(r.PathValue(name))
	if err != nil || id <= 0 {
		http.Error(w, errMsgInvalidID, http.StatusBadRequest)
		return 0, false
	}
	return id, true
}

type resourceHandler func(w http.ResponseWriter, r *http.Request, id int)
type projectHandler func(w http.ResponseWriter, r *http.Request, projectID int)
type projectResHandler func(w http.ResponseWriter, r *http.Request, projectID, resourceID int)
type issueHandler func(w http.ResponseWriter, r *http.Request, projectID, issueID int, issue *Issue)
type issueResHandler func(w http.ResponseWriter, r *http.Request, projectID, issueID, resourceID int, issue *Issue)

// withRole gates a plain handler behind a role-based permission check.
func withRole(action Action, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !Can(GetRoleFromContext(r.Context()), action) {
			denyForbidden(w, r, action)
			return
		}
		h(w, r)
	}
}

// withResource: permission check → parse {id} → h(id).
// For routes with a single {id} path variable and no project scope (users, tasks).
func withResource(action Action, h resourceHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !Can(GetRoleFromContext(r.Context()), action) {
			denyForbidden(w, r, action)
			return
		}
		id, ok := resourceIDFromPath(w, r, pathParamResourceID)
		if !ok {
			return
		}
		h(w, r, id)
	}
}

// withProject: permission check → checkProjectAccess → h(projectID).
func withProject(action Action, h projectHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !Can(GetRoleFromContext(r.Context()), action) {
			denyForbidden(w, r, action)
			return
		}
		projectID, ok := checkProjectAccess(w, r)
		if !ok {
			return
		}
		h(w, r, projectID)
	}
}

// withProjectResource: role check → checkProjectAccess → parse {id} →
// h(projectID, resourceID). Ownership (resource belongs to project) is NOT
// checked here — the handler must load the resource via the project-aware DB
// helper (e.g. GetIssueByIDInProject) and treat a nil return as 404. That
// collapses the ownership check and the read into one query.
func withProjectResource(action Action, h projectResHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !Can(GetRoleFromContext(r.Context()), action) {
			denyForbidden(w, r, action)
			return
		}
		projectID, ok := checkProjectAccess(w, r)
		if !ok {
			return
		}
		resourceID, ok := resourceIDFromPath(w, r, pathParamResourceID)
		if !ok {
			return
		}
		h(w, r, projectID, resourceID)
	}
}

// withIssue loads the {iId} issue (scoped to the path's project) and passes
// it to h, so child-collection handlers (e.g. POST tasks) don't repeat the
// fetch or the archive lookup.
func withIssue(action Action, h issueHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !Can(GetRoleFromContext(r.Context()), action) {
			denyForbidden(w, r, action)
			return
		}
		projectID, ok := checkProjectAccess(w, r)
		if !ok {
			return
		}
		issueID, ok := resourceIDFromPath(w, r, pathParamIssueID)
		if !ok {
			return
		}
		issue, err := GetIssueByIDInProject(r.Context(), issueID, projectID)
		if err != nil {
			LogError("withIssue: GetIssueByIDInProject failed", "issue_id", issueID, "project_id", projectID, "error", err)
			http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
			return
		}
		if issue == nil {
			http.Error(w, errMsgIssueNotFound, http.StatusNotFound)
			return
		}
		h(w, r, projectID, issueID, issue)
	}
}

// withIssueResource is withIssue plus a {id} child-resource ID. Ownership of
// {id} under {iId} is NOT verified here — the mutating DB helper filters by
// both id AND issue_id, so a wrong-issue resource affects zero rows and the
// handler maps ErrTaskNotFound → 404.
func withIssueResource(action Action, h issueResHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !Can(GetRoleFromContext(r.Context()), action) {
			denyForbidden(w, r, action)
			return
		}
		projectID, ok := checkProjectAccess(w, r)
		if !ok {
			return
		}
		issueID, ok := resourceIDFromPath(w, r, pathParamIssueID)
		if !ok {
			return
		}
		issue, err := GetIssueByIDInProject(r.Context(), issueID, projectID)
		if err != nil {
			LogError("withIssueResource: GetIssueByIDInProject failed", "issue_id", issueID, "project_id", projectID, "error", err)
			http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
			return
		}
		if issue == nil {
			http.Error(w, errMsgIssueNotFound, http.StatusNotFound)
			return
		}
		resourceID, ok := resourceIDFromPath(w, r, pathParamResourceID)
		if !ok {
			return
		}
		h(w, r, projectID, issueID, resourceID, issue)
	}
}

// checkAssignee verifies AssigneeID against the DB
func checkAssignee(ctx context.Context, w http.ResponseWriter, i *Issue, current *Issue, userEmail string) bool {
	if i.AssigneeID == nil {
		return true
	}

	if current == nil || current.AssigneeID == nil || *i.AssigneeID != *current.AssigneeID {
		// New assignee: must exist and be active
		active, err := UserExistsAndActive(ctx, *i.AssigneeID)
		if err != nil {
			LogError("Validate: UserExistsAndActive failed", "error", err, "user_email", userEmail)
			http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
			return false
		}
		if !active {
			LogWarn("Validate: Invalid or inactive assignee", "assignee_id", *i.AssigneeID, "user_email", userEmail)
			http.Error(w, errMsgInvalidAssignee, http.StatusBadRequest)
			return false
		}
		return true
	}

	// Same assignee: must exist (can be inactive now)
	exists, err := UserExists(ctx, *i.AssigneeID)
	if err != nil {
		LogError("Validate: UserExists failed", "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return false
	}
	if !exists {
		LogWarn("Validate: Assignee no longer exists", "assignee_id", *i.AssigneeID, "user_email", userEmail)
		http.Error(w, "Assignee no longer exists", http.StatusBadRequest)
		return false
	}

	return true
}

// checkLabel verifies Label exists and belongs to the issue's project.
func checkLabel(ctx context.Context, w http.ResponseWriter, i *Issue, userEmail string) bool {
	if i.Label == nil {
		return true
	}

	exists, err := LabelExistsInProject(ctx, i.Label.ID, i.ProjectID)
	if err != nil {
		LogError("Validate: LabelExistsInProject failed", "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return false
	}
	if !exists {
		LogWarn("Validate: Label not found or wrong project", "label_id", i.Label.ID, "project_id", i.ProjectID, "user_email", userEmail)
		http.Error(w, errMsgInvalidLabel, http.StatusBadRequest)
		return false
	}

	return true
}

// checkRelease verifies ReleaseID exists and belongs to the issue's project.
func checkRelease(ctx context.Context, w http.ResponseWriter, i *Issue, userEmail string) bool {
	if i.ReleaseID == nil {
		return true
	}
	exists, err := ReleaseExistsInProject(ctx, *i.ReleaseID, i.ProjectID)
	if err != nil {
		LogError("Validate: ReleaseExistsInProject failed", "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return false
	}
	if !exists {
		LogWarn("Validate: Release not found or wrong project", "release_id", *i.ReleaseID, "project_id", i.ProjectID, "user_email", userEmail)
		http.Error(w, errMsgInvalidRelease, http.StatusBadRequest)
		return false
	}
	return true
}

// handleCreateIssue handles POST /api/projects/{pId}/issues.
// The URL's {pId} is the source of truth — any project_id in the body is overridden.
func handleCreateIssue(w http.ResponseWriter, r *http.Request, projectID int) {
	var i Issue
	if !decodeAndValidate(w, r, &i, validateIssue) {
		return
	}

	i.ProjectID = projectID
	i.CreatorID = GetUserIDFromContext(r.Context())
	i.UpdaterID = &i.CreatorID

	userEmail := GetEmailFromContext(r.Context())

	if !checkAssignee(r.Context(), w, &i, nil, userEmail) || !checkLabel(r.Context(), w, &i, userEmail) || !checkRelease(r.Context(), w, &i, userEmail) {
		return
	}

	if err := CreateIssue(r.Context(), &i); err != nil {
		LogError("CreateIssue failed", "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}

	created, err := GetIssueByID(r.Context(), i.ID)
	if err != nil {
		LogError("CreateIssue: failed to fetch created issue", "id", i.ID, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}

	LogInfo("Issue created", "id", i.ID, "user_email", userEmail)
	w.Header().Set(headerContentType, contentTypeJSON)
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(created); err != nil {
		LogError("CreateIssue: failed to encode response", "error", err, "user_email", userEmail)
	}
}

// handleGetIssue retrieves a single issue (scoped to the URL's project) and
// serves it with an ETag header. Returns 404 if the issue belongs to another
// project — see GetIssueByIDInProject.
func handleGetIssue(w http.ResponseWriter, r *http.Request, projectID, id int) {
	issue, err := GetIssueByIDInProject(r.Context(), id, projectID)
	if err != nil {
		LogError("GetIssueByIDInProject failed", "id", id, "project_id", projectID, "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	if issue == nil {
		http.Error(w, errMsgIssueNotFound, http.StatusNotFound)
		return
	}
	w.Header().Set("ETag", formatETag(issue.UpdatedAt))
	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(issue); err != nil {
		LogError("handleGetIssue: failed to encode response", "id", id, "error", err)
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
func handleIssueArchiveToggle(w http.ResponseWriter, r *http.Request, projectID, id int, opts archiveToggleOpts) {
	userEmail := GetEmailFromContext(r.Context())

	current, err := GetIssueByIDInProject(r.Context(), id, projectID)
	if err != nil {
		LogError("GetIssueByIDInProject failed for "+opts.logAction, "id", id, "project_id", projectID, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	if current == nil {
		http.Error(w, errMsgIssueNotFound, http.StatusNotFound)
		return
	}
	if !opts.valid(current.Status) {
		LogWarn(opts.badMsg, "id", id, "user_email", userEmail)
		http.Error(w, opts.badMsg, http.StatusBadRequest)
		return
	}
	current.Status = opts.newStatus
	if err := UpdateIssue(r.Context(), current); err != nil {
		LogError("UpdateIssue failed for "+opts.logAction, "id", id, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	respondWithUpdatedIssue(r.Context(), w, id, opts.respondMsg, userEmail)
}

// handleArchiveIssue sets an issue's status to Archive.
func handleArchiveIssue(w http.ResponseWriter, r *http.Request, projectID, id int) {
	handleIssueArchiveToggle(w, r, projectID, id, archiveToggleOpts{
		valid:      func(s IssueStatus) bool { return s != StatusArchive },
		newStatus:  StatusArchive,
		badMsg:     "Issue is already archived",
		logAction:  "archive",
		respondMsg: "Issue archived",
	})
}

// handleUnarchiveIssue moves an archived issue back to Done status.
func handleUnarchiveIssue(w http.ResponseWriter, r *http.Request, projectID, id int) {
	handleIssueArchiveToggle(w, r, projectID, id, archiveToggleOpts{
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
func persistIssueUpdate(ctx context.Context, w http.ResponseWriter, i *Issue, current *Issue, userEmail string) bool {
	if issueContentHash(i) == issueContentHash(current) {
		if i.Position != current.Position {
			if err := UpdateIssuePosition(ctx, i.ID, i.Position); err != nil {
				if err == ErrIssueNotFound {
					http.Error(w, errMsgIssueNotFound, http.StatusNotFound)
					return false
				}
				LogError("UpdateIssuePosition failed", "id", i.ID, "error", err, "user_email", userEmail)
				http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
				return false
			}
		}
		return true
	}
	if err := UpdateIssue(ctx, i); err != nil {
		if err == ErrIssueNotFound {
			http.Error(w, errMsgIssueNotFound, http.StatusNotFound)
			return false
		}
		LogError("UpdateIssue failed", "id", i.ID, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return false
	}
	return true
}

// handlePutIssue updates an existing non-archived issue, checking for conflicts via the If-Match header.
func handlePutIssue(w http.ResponseWriter, r *http.Request, projectID, id int) {
	current, err := GetIssueByIDInProject(r.Context(), id, projectID)
	if err != nil {
		LogError("GetIssueByIDInProject failed for put", "id", id, "project_id", projectID, "error", err)
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
	// Project is pinned by the URL — body cannot move an issue across projects.
	i.ProjectID = projectID

	// Set UpdaterID
	updaterID := GetUserIDFromContext(r.Context())
	i.UpdaterID = &updaterID
	userEmail := GetEmailFromContext(r.Context())

	if !checkAssignee(r.Context(), w, &i, current, userEmail) || !checkLabel(r.Context(), w, &i, userEmail) || !checkRelease(r.Context(), w, &i, userEmail) {
		return
	}

	// Archived issues are read-only — use POST /api/projects/{pId}/issues/{id}/unarchive to restore
	if current.Status == StatusArchive {
		LogWarn("Attempted update on archived issue", "id", id, "user_email", userEmail)
		http.Error(w, errMsgArchivedReadOnly, http.StatusForbidden)
		return
	}

	// Reject attempts to archive via PUT — use POST .../archive instead
	if i.Status == StatusArchive {
		LogWarn("Attempted archive via PUT", "id", id, "user_email", userEmail)
		http.Error(w, "Use POST /api/projects/{pId}/issues/{id}/archive to archive an issue", http.StatusBadRequest)
		return
	}

	i.ID = id
	if !persistIssueUpdate(r.Context(), w, &i, current, userEmail) {
		return
	}
	respondWithUpdatedIssue(r.Context(), w, id, "Issue updated", userEmail)
}

// checkIfMatchConflict verifies if the client's If-Match header matches the current issue's ETag.
// Returns true if a conflict is detected (and sends 409 response), false otherwise.
func checkIfMatchConflict(w http.ResponseWriter, current *Issue, ifMatch string) bool {
	currentEtag := formatETag(current.UpdatedAt)
	if ifMatch != currentEtag {
		LogInfo("Conflict detected", "id", current.ID)
		http.Error(w, "Issue has been modified by another user", http.StatusConflict)
		return true
	}
	return false
}

// handleDeleteIssue removes an issue by its ID.
func handleDeleteIssue(w http.ResponseWriter, r *http.Request, projectID, id int) {
	userEmail := GetEmailFromContext(r.Context())

	issue, err := GetIssueByIDInProject(r.Context(), id, projectID)
	if err != nil {
		LogError("GetIssueByIDInProject failed for delete check", "id", id, "project_id", projectID, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	if issue == nil {
		http.Error(w, errMsgIssueNotFound, http.StatusNotFound)
		return
	}
	if issue.Status == StatusArchive {
		LogWarn("Attempted to delete archived issue", "id", id, "user_email", userEmail)
		http.Error(w, "Archived issues cannot be deleted", http.StatusForbidden)
		return
	}

	if err := DeleteIssue(r.Context(), id); err != nil {
		if err == ErrIssueNotFound {
			http.Error(w, errMsgIssueNotFound, http.StatusNotFound)
			return
		}
		LogError("DeleteIssue failed", "id", id, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	LogInfo("Issue deleted", "id", id, "user_email", userEmail)
	w.WriteHeader(http.StatusNoContent)
}

// handleCreateTask handles POST /api/projects/{pId}/issues/{iId}/tasks.
func handleCreateTask(w http.ResponseWriter, r *http.Request, _ int, issueID int, issue *Issue) {
	var t Task
	if !decodeAndValidate(w, r, &t, validateTask) {
		return
	}

	userEmail := GetEmailFromContext(r.Context())
	t.IssueID = issueID

	if issue.Status == StatusArchive {
		LogWarn("Task creation failed: Issue archived", "issue_id", issueID, "user_email", userEmail)
		http.Error(w, "Cannot add tasks to archived issues", http.StatusForbidden)
		return
	}

	if err := CreateTask(r.Context(), &t); err != nil {
		LogError("CreateTask failed", "issue_id", issueID, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	LogInfo("Task created", "id", t.ID, "issue_id", issueID, "user_email", userEmail)
	w.Header().Set(headerContentType, contentTypeJSON)
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(t); err != nil {
		LogError("handleCreateTask: failed to encode response", "id", t.ID, "error", err, "user_email", userEmail)
	}
}

// handlePutTask updates an existing task.
func handlePutTask(w http.ResponseWriter, r *http.Request, _ int, issueID, id int, issue *Issue) {
	var t Task
	if !decodeAndValidate(w, r, &t, validateTask) {
		return
	}

	userEmail := GetEmailFromContext(r.Context())

	if issue.Status == StatusArchive {
		LogWarn("Task update failed: Issue archived", "id", id, "user_email", userEmail)
		http.Error(w, "Tasks of archived issues are read-only", http.StatusForbidden)
		return
	}

	t.ID = id
	t.IssueID = issueID
	if err := UpdateTask(r.Context(), &t, issueID); err != nil {
		if err == ErrTaskNotFound {
			http.Error(w, errMsgTaskNotFound, http.StatusNotFound)
			return
		}
		LogError("UpdateTask failed", "id", id, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	LogInfo("Task updated", "id", id, "user_email", userEmail)
	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(t); err != nil {
		LogError("handlePutTask: failed to encode response", "id", id, "error", err, "user_email", userEmail)
	}
}

// handleDeleteTask removes a task.
func handleDeleteTask(w http.ResponseWriter, r *http.Request, _ int, issueID int, id int, issue *Issue) {
	if issue.Status == StatusArchive {
		http.Error(w, "Tasks of archived issues cannot be deleted", http.StatusForbidden)
		return
	}

	userEmail := GetEmailFromContext(r.Context())

	if err := DeleteTask(r.Context(), id, issueID); err != nil {
		if err == ErrTaskNotFound {
			http.Error(w, errMsgTaskNotFound, http.StatusNotFound)
			return
		}
		LogError("DeleteTask failed", "id", id, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	LogInfo("Task deleted", "id", id, "issue_id", issueID, "user_email", userEmail)
	w.WriteHeader(http.StatusNoContent)
}

// handleListLabels handles GET /api/projects/{pId}/labels.
func handleListLabels(w http.ResponseWriter, r *http.Request, projectID int) {
	labels, err := GetLabelsByProject(r.Context(), projectID)
	if err != nil {
		LogError("GetLabelsByProject failed", "project_id", projectID, "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(labels); err != nil {
		LogError("handleListLabels: failed to encode response", "error", err)
	}
}

// handleCreateLabel handles POST /api/projects/{pId}/labels.
func handleCreateLabel(w http.ResponseWriter, r *http.Request, projectID int) {
	var l Label
	if !decodeAndValidate(w, r, &l, validateLabel) {
		return
	}
	l.ProjectID = projectID
	userEmail := GetEmailFromContext(r.Context())
	if err := CreateLabel(r.Context(), &l); err != nil {
		LogError("CreateLabel failed", "project_id", projectID, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	LogInfo("Label created", "id", l.ID, "project_id", projectID, "user_email", userEmail)
	w.Header().Set(headerContentType, contentTypeJSON)
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(l); err != nil {
		LogError("handleCreateLabel: failed to encode response", "error", err)
	}
}

// handleDeleteLabel handles DELETE /api/projects/{pId}/labels/{id}.
// projectID/labelID are validated by withProjectResource before this runs.
func handleDeleteLabel(w http.ResponseWriter, r *http.Request, projectID, labelID int) {
	userEmail := GetEmailFromContext(r.Context())
	if err := DeleteLabel(r.Context(), labelID, projectID); err != nil {
		if err == ErrLabelNotFound {
			http.Error(w, errMsgLabelNotFound, http.StatusNotFound)
			return
		}
		LogError("DeleteLabel failed", "label_id", labelID, "project_id", projectID, "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	LogInfo("Label deleted", "label_id", labelID, "project_id", projectID, "user_email", userEmail)
	w.WriteHeader(http.StatusNoContent)
}

// handleGetStatusConfig handles GET /api/projects/{pId}/statusconfig.
func handleGetStatusConfig(w http.ResponseWriter, r *http.Request, projectID int) {
	cfg, err := GetStatusConfig(r.Context(), projectID)
	if err != nil {
		LogError("GetStatusConfig failed", "project_id", projectID, "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(cfg); err != nil {
		LogError("handleGetStatusConfig: failed to encode response", "error", err)
	}
}

// handleUpdateStatusConfig handles PUT /api/projects/{pId}/statusconfig.
func handleUpdateStatusConfig(w http.ResponseWriter, r *http.Request, projectID int) {
	var cfg StatusConfig
	if !decodeAndValidate(w, r, &cfg, validateStatusConfig) {
		return
	}
	cfg.ProjectID = projectID
	userEmail := GetEmailFromContext(r.Context())
	if err := UpsertStatusConfig(r.Context(), &cfg); err != nil {
		LogError("UpsertStatusConfig failed", "project_id", projectID, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	LogInfo("Status config updated", "project_id", projectID, "user_email", userEmail)
	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(cfg); err != nil {
		LogError("handleUpdateStatusConfig: failed to encode response", "error", err)
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
	ip := GetClientIP(r)
	if loginLimiter.checkIP(ip) {
		LogWarn("Login blocked: IP rate limit exceeded", "ip", ip)
		http.Error(w, errMsgTooManyAttempts, http.StatusTooManyRequests)
		return
	}

	var req loginRequest
	if !decodeAndValidate(w, r, &req, validateLoginRequest) {
		return
	}

	if loginLimiter.checkIPAndEmail(ip, req.Email) {
		LogWarn("Login blocked: IP and email rate limit exceeded", "email", req.Email, "ip", ip)
		dummyPasswordCheck(req.Password)                           // Equalize timing to prevent side channels
		http.Error(w, errMsgInvalidCreds, http.StatusUnauthorized) // we don't reveal the actual cause here
		return
	}

	user, err := GetUserByEmail(r.Context(), req.Email)
	if err != nil {
		LogError("Login: database error", "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	if user == nil {
		// Equalise timing with the valid-user path to prevent user enumeration.
		dummyPasswordCheck(req.Password)
		LogWarn(errMsgFailedLogin, "email", req.Email, "reason", "user_not_found")
		loginLimiter.recordFailure(ip, req.Email)
		http.Error(w, errMsgInvalidCreds, http.StatusUnauthorized)
		return
	}

	if !user.Active {
		dummyPasswordCheck(req.Password) // Equalize timing to prevent side channels
		LogWarn("Failed login attempt", "email", user.Email, "reason", "inactive_user")
		loginLimiter.recordFailure(ip, req.Email)
		http.Error(w, errMsgInvalidCreds, http.StatusUnauthorized)
		return
	}

	if !CheckPassword(user.PasswordHash, req.Password) {
		LogWarn(errMsgFailedLogin, "email", req.Email, "reason", "invalid_password")
		loginLimiter.recordFailure(ip, req.Email)
		http.Error(w, errMsgInvalidCreds, http.StatusUnauthorized)
		return
	}

	// Use Auth Service to create session
	session, accessToken, refreshToken, err := CreateUserSession(r.Context(), user)
	if err != nil {
		LogError("Login: failed to create session", "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}

	loginLimiter.resetOnSuccess(ip, req.Email)
	SetAuthCookies(w, accessToken, refreshToken)
	LogInfo("Successful login", "email", user.Email, "session_id", session.ID)

	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(map[string]any{
		"user": user,
	}); err != nil {
		LogError("HandleLogin: failed to encode response", "error", err)
	}
}

// HandleLogout handles POST /api/auth/logout.
// Clears auth cookies.
func HandleLogout(w http.ResponseWriter, r *http.Request) {
	revokeSessionFromCookie(r)
	email := getUserEmailFromCookie(r)

	ClearAuthCookies(w)
	LogInfo("Successful logout", "email", email)

	w.Header().Set(headerContentType, contentTypeJSON)
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(map[string]string{"message": "Logged out"}); err != nil {
		LogError("HandleLogout: failed to encode response", "error", err)
	}
}

// revokeSessionFromCookie revokes the session referenced by the refresh-token
// cookie, if any. Silently does nothing when the cookie is missing or invalid —
// logout is best-effort and must succeed even without a usable session.
func revokeSessionFromCookie(r *http.Request) {
	if cookie, err := r.Cookie(cookieRefreshToken); err == nil {
		sessionID, _, err := ValidateRefreshToken(cookie.Value)
		if err == nil {
			if err := RevokeSession(r.Context(), sessionID); err != nil {
				if errors.Is(err, ErrSessionNotFound) {
					LogInfo("Logout: session already revoked or not found", "session_id", strconv.Itoa(sessionID))
				} else {
					LogWarn("Logout: failed to revoke session", "session_id", strconv.Itoa(sessionID), "error", err)
				}
			}
		}
	}
}

// getUserEmailFromCookie returns the email claim from the access-token cookie,
// or the sentinel "unknown" when the cookie is missing or invalid. Used only
// for log messages, never for authorization.
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
	cookie, err := r.Cookie(cookieRefreshToken)
	if err != nil {
		http.Error(w, errMsgUnauthorized, http.StatusUnauthorized)
		return
	}

	// Use Auth Service to refresh session
	user, accessToken, newRefreshToken, err := RefreshSession(r.Context(), cookie.Value)
	if err != nil {
		LogWarn("Refresh failed", "error", err)
		ClearAuthCookies(w)
		http.Error(w, errMsgUnauthorized, http.StatusUnauthorized)
		return
	}

	// Set Cookies
	SetAuthCookies(w, accessToken, newRefreshToken)

	LogInfo("Token refresh successful (rotated)", "email", user.Email, "user_id", user.ID)

	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(map[string]any{
		"user": user,
	}); err != nil {
		LogError("HandleRefresh: failed to encode response", "error", err)
	}
}

// HandleGetCurrentUser handles GET /api/auth/me.
func HandleGetCurrentUser(w http.ResponseWriter, r *http.Request) {
	userID := GetUserIDFromContext(r.Context())
	if userID == 0 {
		LogWarn("CurrentUser: unauthorized (no user ID in context)")
		http.Error(w, errMsgUnauthorized, http.StatusUnauthorized)
		return
	}
	handleGetCurrentUser(r.Context(), w, userID)
}

// HandleUpdateSelf handles PUT /api/auth/me.
func HandleUpdateSelf(w http.ResponseWriter, r *http.Request) {
	userID := GetUserIDFromContext(r.Context())
	if userID == 0 {
		LogWarn("UpdateSelf: unauthorized (no user ID in context)")
		http.Error(w, errMsgUnauthorized, http.StatusUnauthorized)
		return
	}
	handleUpdateSelf(w, r, userID)
}

// handleGetCurrentUser is the inner handler for HandleGetCurrentUser: loads
// the user by id and writes the JSON response or the appropriate error.
func handleGetCurrentUser(ctx context.Context, w http.ResponseWriter, userID int) {
	user, err := GetUserByID(ctx, userID)
	if err != nil {
		LogError("CurrentUser: database error", "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	if user == nil {
		LogWarn("CurrentUser: user not found", "user_id", userID)
		http.Error(w, errMsgUserNotFound, http.StatusNotFound)
		return
	}

	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(user); err != nil {
		LogError("handleGetCurrentUser: failed to encode response", "user_id", userID, "error", err)
	}
}

// handleUpdateSelf allows a user to update their own profile (e.g. password).
func handleUpdateSelf(w http.ResponseWriter, r *http.Request, userID int) {
	// Load existing user first
	existing, err := GetUserByID(r.Context(), userID)
	if err != nil {
		LogError("UpdateSelf: database error", "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	if existing == nil {
		LogWarn("UpdateSelf: user not found", "user_id", userID)
		http.Error(w, errMsgUserNotFound, http.StatusNotFound)
		return
	}

	// Ignore role/active from the request — users cannot self-promote or self-deactivate.
	var req userRequest
	if !decodeAndValidate(w, r, &req, func(r *userRequest) error { return nil }) {
		return
	}

	// Users can only update their own password for now.
	// Email, FirstName, LastName could be allowed here if desired, but requirements only mention password.
	// For now, we'll only process password updates if provided.

	if req.Password != "" {
		if req.CurrentPassword == "" || !CheckPassword(existing.PasswordHash, req.CurrentPassword) {
			LogWarn("UpdateSelf: current password confirmation failed", "user_id", userID)
			http.Error(w, "Current password is incorrect", http.StatusBadRequest)
			return
		}
		if err := updateUserPassword(existing, req.Password); err != nil {
			LogError("UpdateSelf: password error", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
	}

	// Persist changes
	if err := UpdateUser(r.Context(), existing); err != nil {
		LogError("UpdateSelf: database error", "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}

	// If password changed, revoke all sessions immediately
	if req.Password != "" {
		if err := RevokeUserSessions(r.Context(), userID); err != nil {
			LogError("UpdateSelf: failed to revoke sessions", "user_id", userID, "error", err)
		} else {
			LogInfo("UpdateSelf: sessions revoked", "user_id", userID)
		}
	}

	LogInfo("User updated self", "id", userID, "email", existing.Email)
	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(existing); err != nil {
		LogError("handleUpdateSelf: failed to encode response", "user_id", userID, "error", err)
	}
}

// -----------------------------------------------------------------------------
// User Management Handlers
// -----------------------------------------------------------------------------

// userRequest represents the expected JSON body for creating/updating a user.
type userRequest struct {
	Email           string   `json:"email"`
	FirstName       string   `json:"first_name"`
	LastName        string   `json:"last_name"`
	Password        string   `json:"password,omitempty"`
	AdminPassword   string   `json:"admin_password,omitempty"`
	CurrentPassword string   `json:"current_password,omitempty"`
	Role            UserRole `json:"role"`
	Active          bool     `json:"active"`
}

// validateUserRequest validates the DTO fields (email, name, role).
// Password policy is checked separately in the handler because it depends on
// the resolved email and is only required on creation.
func validateUserRequest(req *userRequest) error {
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

func handleListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := GetAllUsers(r.Context())
	if err != nil {
		userEmail := GetEmailFromContext(r.Context())
		LogError("ListUsers: database error", "error", err, "admin_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}

	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(users); err != nil {
		LogError("handleListUsers: failed to encode response", "error", err, "admin_email", GetEmailFromContext(r.Context()))
	}
}

func handleCreateUser(w http.ResponseWriter, r *http.Request) {
	userEmail := GetEmailFromContext(r.Context())

	var req userRequest
	if !decodeAndValidate(w, r, &req, validateUserRequest) {
		return
	}

	user := &User{
		Email:     req.Email, // already trimmed by validateUserRequest
		FirstName: req.FirstName,
		LastName:  req.LastName,
		Role:      req.Role,
		Active:    req.Active,
	}

	if req.Password == "" {
		LogWarn("CreateUser: password missing", "admin_email", userEmail)
		http.Error(w, "Password is required", http.StatusBadRequest)
		return
	}

	if err := ValidatePassword(req.Password, user.Email); err != nil {
		LogWarn("CreateUser: password validation failed", "error", err, "admin_email", userEmail)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	hash, err := HashPassword(req.Password)
	if err != nil {
		LogError("CreateUser: failed to hash password", "error", err, "admin_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	user.PasswordHash = hash

	if err := CreateUser(r.Context(), user); err != nil {
		if err == ErrDuplicateEmail {
			LogWarn("CreateUser: duplicate email", "email", user.Email, "admin_email", userEmail)
			http.Error(w, "Email already exists", http.StatusConflict)
			return
		}
		LogError("CreateUser: database error", "error", err, "admin_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}

	LogInfo("User created", "email", user.Email, "role", user.Role, "admin_email", userEmail)
	w.Header().Set(headerContentType, contentTypeJSON)
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(user); err != nil {
		LogError("handleCreateUser: failed to encode response", "error", err, "admin_email", userEmail)
	}
}

func handleGetUser(w http.ResponseWriter, r *http.Request, id int) {
	userEmail := GetEmailFromContext(r.Context())

	user, err := GetUserByID(r.Context(), id)
	if err != nil {
		LogError("GetUser: database error", "error", err, "admin_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	if user == nil {
		LogWarn("GetUser: not found", "target_id", id, "admin_email", userEmail)
		http.Error(w, errMsgUserNotFound, http.StatusNotFound)
		return
	}

	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(user); err != nil {
		LogError("handleGetUser: failed to encode response", "error", err, "admin_email", userEmail)
	}
}

func handleUpdateUser(w http.ResponseWriter, r *http.Request, id int) {
	userEmail := GetEmailFromContext(r.Context())

	// Load existing user first
	existing, err := GetUserByID(r.Context(), id)
	if err != nil {
		LogError("UpdateUser: database error", "error", err, "admin_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	if existing == nil {
		LogWarn("UpdateUser: not found", "target_id", id, "admin_email", userEmail)
		http.Error(w, errMsgUserNotFound, http.StatusNotFound)
		return
	}

	var req userRequest
	if !decodeAndValidate(w, r, &req, validateUserRequest) {
		return
	}

	revokeSessions, err := validateAndPrepareUserUpdate(r.Context(), existing, req, userEmail)
	if err != nil {
		if errors.Is(err, errAdminCheckDB) {
			http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		} else {
			http.Error(w, err.Error(), http.StatusBadRequest)
		}
		return
	}

	if err := UpdateUser(r.Context(), existing); err != nil {
		if err == ErrDuplicateEmail {
			LogWarn("UpdateUser: duplicate email", "email", existing.Email, "admin_email", userEmail)
			http.Error(w, "Email already exists", http.StatusConflict)
			return
		}
		LogError("UpdateUser: database error", "error", err, "admin_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}

	// If deactivated or password changed, revoke all sessions immediately
	if revokeSessions {
		if err := RevokeUserSessions(r.Context(), id); err != nil {
			LogError("UpdateUser: failed to revoke sessions", "user_id", id, "error", err, "admin_email", userEmail)
			// Non-fatal for the update, but log it as error
		} else {
			LogInfo("UpdateUser: sessions revoked", "user_id", id, "admin_email", userEmail)
		}
	}

	LogInfo("User updated", "id", id, "email", existing.Email, "admin_email", userEmail)
	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(existing); err != nil {
		LogError("handleUpdateUser: failed to encode response", "error", err, "admin_email", userEmail)
	}
}

// validateAndPrepareUserUpdate mutates `existing` in place with values from `req`,
// enforces the last-sysadmin-protection rule, validates the resulting user,
// and verifies the admin password when the change is privilege-elevating
// (password change or role promotion). Returns whether the caller should
// revoke all of the target user's sessions (deactivation, password change, or
// role change all trigger session revocation).
func validateAndPrepareUserUpdate(ctx context.Context, existing *User, req userRequest, userEmail string) (bool, error) {
	existing.Email = strings.TrimSpace(req.Email)
	existing.FirstName = strings.TrimSpace(req.FirstName)
	existing.LastName = strings.TrimSpace(req.LastName)

	if err := checkLastSysAdminProtection(ctx, existing, req.Role, req.Active); err != nil {
		if !errors.Is(err, errAdminCheckDB) {
			LogWarn("UpdateUser: last admin protection triggered", "error", err, "admin_email", userEmail)
		}
		return false, err
	}

	originalRole := existing.Role
	existing.Role = req.Role
	existing.Active = req.Active

	if err := validateUser(existing); err != nil {
		LogWarn("UpdateUser: validation failed", "error", err, "admin_email", userEmail)
		return false, err
	}

	// Check if we need to revoke sessions (Security: Immediate Logout)
	revokeSessions := false
	if !req.Active || req.Password != "" || originalRole != req.Role {
		revokeSessions = true
	}

	if req.Password != "" || roleRank(req.Role) > roleRank(originalRole) {
		adminUser, err := GetUserByEmail(ctx, userEmail)
		if err != nil || adminUser == nil {
			return false, errAdminCheckDB
		}
		if req.AdminPassword == "" || !CheckPassword(adminUser.PasswordHash, req.AdminPassword) {
			LogWarn("UpdateUser: admin password confirmation failed", "admin_email", userEmail, "target_id", existing.ID)
			return false, errors.New("admin password confirmation required")
		}
	}

	if err := updateUserPassword(existing, req.Password); err != nil {
		LogError("UpdateUser: password error", "error", err, "admin_email", userEmail)
		return false, err
	}

	return revokeSessions, nil
}

// checkLastSysAdminProtection rejects an update that would leave the system
// with zero active sysadmins (deactivating or demoting the last one). Returns
// errAdminCheckDB on a DB failure so the caller can return 500 instead of 400.
func checkLastSysAdminProtection(ctx context.Context, existing *User, newRole UserRole, newActive bool) error {
	if existing.Role == RoleSysAdmin && existing.Active {
		if newRole != RoleSysAdmin || !newActive {
			sysAdminCount, err := CountActiveSysAdmins(ctx)
			if err != nil {
				LogError("checkLastSysAdminProtection: failed to count active sysadmins", "error", err)
				return errAdminCheckDB
			}
			if sysAdminCount <= 1 {
				return fmt.Errorf("Cannot deactivate or demote the last active system administrator")
			}
		}
	}
	return nil
}

// updateUserPassword hashes newPassword and assigns it to user.PasswordHash.
// No-op (returns nil) when newPassword is empty — callers can invoke it
// unconditionally during a user update without a separate "did they change
// the password" branch.
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
func respondWithUpdatedIssue(ctx context.Context, w http.ResponseWriter, id int, actionLog, userEmail string) {
	updated, err := GetIssueByID(ctx, id)
	if err != nil {
		LogError("GetIssueByID failed after update", "id", id, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}

	LogInfo(actionLog, "id", id, "user_email", userEmail)

	w.Header().Set("ETag", formatETag(updated.UpdatedAt))
	w.Header().Set(headerContentType, contentTypeJSON)

	if err := json.NewEncoder(w).Encode(updated); err != nil {
		LogError("Failed to encode response", "id", id, "error", err, "user_email", userEmail)
	}
}

// decodeAndValidate decodes a JSON request body into the provided struct and validates it using the given function.
// It handles errors by logging them and writing an appropriate HTTP response.
// Returns true if successful, false otherwise.
func decodeAndValidate[T any](w http.ResponseWriter, r *http.Request, v *T, validate func(*T) error) bool {
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		LogWarn("Failed to decode request", "type", fmt.Sprintf("%T", v), "error", err)
		http.Error(w, errMsgInvalidRequestBody, http.StatusBadRequest)
		return false
	}
	if err := validate(v); err != nil {
		userEmail := GetEmailFromContext(r.Context())
		LogWarn("Validation failed", "type", fmt.Sprintf("%T", v), "error", err, "user_email", userEmail)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return false
	}
	return true
}

// -----------------------------------------------------------------------------
// Project Handlers
// -----------------------------------------------------------------------------

func handleListProjects(w http.ResponseWriter, r *http.Request) {
	projects, err := GetAllProjects(r.Context())
	if err != nil {
		userEmail := GetEmailFromContext(r.Context())
		LogError("ListProjects: database error", "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}

	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(projects); err != nil {
		LogError("handleListProjects: failed to encode response", "error", err)
	}
}

func handleCreateProject(w http.ResponseWriter, r *http.Request) {
	userEmail := GetEmailFromContext(r.Context())

	var p Project
	if !decodeAndValidate(w, r, &p, validateProject) {
		return
	}

	if err := CreateProject(r.Context(), &p); err != nil {
		if errors.Is(err, ErrDuplicateProjectName) {
			LogWarn("CreateProject: name already exists", "name", p.Name, "user_email", userEmail)
			http.Error(w, "Project name already exists", http.StatusConflict)
			return
		}
		LogError("CreateProject failed", "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}

	LogInfo("Project created", "id", p.ID, "name", p.Name, "user_email", userEmail)
	w.Header().Set(headerContentType, contentTypeJSON)
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(p); err != nil {
		LogError("handleCreateProject: failed to encode response", "error", err, "user_email", userEmail)
	}
}

// fetchAndEncodeIssues is the shared body for the three issue-list endpoints
// (active, archived, open) of a project.
func fetchAndEncodeIssues(ctx context.Context, w http.ResponseWriter, projectID int, name string, fetch func(context.Context, int) ([]Issue, error)) {
	issues, err := fetch(ctx, projectID)
	if err != nil {
		LogError(name+" failed", "project_id", projectID, "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(issues); err != nil {
		LogError(name+": failed to encode response", "error", err)
	}
}

func handleProjectActiveIssues(w http.ResponseWriter, r *http.Request, projectID int) {
	fetchAndEncodeIssues(r.Context(), w, projectID, "handleProjectActiveIssues", GetActiveIssuesByProject)
}

func handleProjectArchivedIssues(w http.ResponseWriter, r *http.Request, projectID int) {
	fetchAndEncodeIssues(r.Context(), w, projectID, "handleProjectArchivedIssues", GetArchivedIssuesByProject)
}

func handleProjectOpenIssues(w http.ResponseWriter, r *http.Request, projectID int) {
	fetchAndEncodeIssues(r.Context(), w, projectID, "handleProjectOpenIssues", GetOpenIssuesByProject)
}

func handleListReleases(w http.ResponseWriter, r *http.Request, projectID int) {
	releases, err := GetReleasesByProject(r.Context(), projectID)
	if err != nil {
		LogError("GetReleasesByProject failed", "project_id", projectID, "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(releases); err != nil {
		LogError("handleListReleases: failed to encode response", "error", err)
	}
}

func handleCreateRelease(w http.ResponseWriter, r *http.Request, projectID int) {
	var rel Release
	if !decodeAndValidate(w, r, &rel, validateRelease) {
		return
	}
	rel.ProjectID = projectID
	userEmail := GetEmailFromContext(r.Context())
	if err := CreateRelease(r.Context(), &rel); err != nil {
		if errors.Is(err, ErrDuplicateReleaseName) {
			http.Error(w, errMsgDuplicateReleaseName, http.StatusConflict)
			return
		}
		LogError("CreateRelease failed", "project_id", projectID, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	LogInfo("Release created", "id", rel.ID, "project_id", projectID, "user_email", userEmail)
	w.Header().Set(headerContentType, contentTypeJSON)
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(rel); err != nil {
		LogError("handleCreateRelease: failed to encode response", "error", err)
	}
}

func handleGetRelease(w http.ResponseWriter, r *http.Request, projectID, id int) {
	rel, err := GetReleaseByIDInProject(r.Context(), id, projectID)
	if err != nil {
		LogError("GetReleaseByIDInProject failed", "id", id, "project_id", projectID, "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	if rel == nil {
		http.Error(w, errMsgReleaseNotFound, http.StatusNotFound)
		return
	}
	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(rel); err != nil {
		LogError("handleGetRelease: failed to encode response", "error", err)
	}
}

func handlePutRelease(w http.ResponseWriter, r *http.Request, projectID, id int) {
	var rel Release
	if !decodeAndValidate(w, r, &rel, validateRelease) {
		return
	}
	rel.ID = id
	rel.ProjectID = projectID
	userEmail := GetEmailFromContext(r.Context())
	current, err := GetReleaseByIDInProject(r.Context(), id, projectID)
	if err != nil {
		LogError("GetReleaseByIDInProject failed", "id", id, "project_id", projectID, "error", err)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	if current == nil {
		http.Error(w, errMsgReleaseNotFound, http.StatusNotFound)
		return
	}
	if current.Status == ReleaseStatusClosed {
		LogWarn("Attempted update on closed release", "id", id, "user_email", userEmail)
		http.Error(w, errMsgClosedReleaseReadOnly, http.StatusForbidden)
		return
	}
	if err := UpdateRelease(r.Context(), &rel); err != nil {
		if errors.Is(err, ErrReleaseNotFound) {
			http.Error(w, errMsgReleaseNotFound, http.StatusNotFound)
			return
		}
		if errors.Is(err, ErrDuplicateReleaseName) {
			http.Error(w, errMsgDuplicateReleaseName, http.StatusConflict)
			return
		}
		LogError("UpdateRelease failed", "id", id, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	LogInfo("Release updated", "id", id, "user_email", userEmail)
	updated, err := GetReleaseByID(r.Context(), id)
	if err != nil || updated == nil {
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(updated); err != nil {
		LogError("handlePutRelease: failed to encode response", "error", err)
	}
}

func handleDeleteRelease(w http.ResponseWriter, r *http.Request, projectID, id int) {
	userEmail := GetEmailFromContext(r.Context())
	if rel, err := GetReleaseByIDInProject(r.Context(), id, projectID); err != nil {
		LogError("GetReleaseByIDInProject failed for delete", "id", id, "project_id", projectID, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	} else if rel == nil {
		http.Error(w, errMsgReleaseNotFound, http.StatusNotFound)
		return
	}
	if err := DeleteRelease(r.Context(), id); err != nil {
		if errors.Is(err, ErrReleaseNotFound) {
			http.Error(w, errMsgReleaseNotFound, http.StatusNotFound)
			return
		}
		LogError("DeleteRelease failed", "id", id, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	LogInfo("Release deleted", "id", id, "user_email", userEmail)
	w.WriteHeader(http.StatusNoContent)
}

// handleTriggerRelease sets a release to 'closed' and optionally archives Done issues.
func handleTriggerRelease(w http.ResponseWriter, r *http.Request, projectID, id int) {
	var body struct {
		ArchiveDone bool `json:"archive_done"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, errMsgInvalidRequestBody, http.StatusBadRequest)
		return
	}
	userEmail := GetEmailFromContext(r.Context())
	if rel, err := GetReleaseByIDInProject(r.Context(), id, projectID); err != nil {
		LogError("GetReleaseByIDInProject failed for trigger", "id", id, "project_id", projectID, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	} else if rel == nil {
		http.Error(w, errMsgReleaseNotFound, http.StatusNotFound)
		return
	}
	if err := TriggerRelease(r.Context(), id, body.ArchiveDone); err != nil {
		if errors.Is(err, ErrReleaseNotFound) {
			http.Error(w, errMsgReleaseNotFound, http.StatusNotFound)
			return
		}
		LogError("TriggerRelease failed", "id", id, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	LogInfo("Release triggered", "id", id, "archive_done", body.ArchiveDone, "user_email", userEmail)
	updated, err := GetReleaseByID(r.Context(), id)
	if err != nil || updated == nil {
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(updated); err != nil {
		LogError("handleTriggerRelease: failed to encode response", "error", err)
	}
}

func handleReopenRelease(w http.ResponseWriter, r *http.Request, projectID, id int) {
	userEmail := GetEmailFromContext(r.Context())
	if rel, err := GetReleaseByIDInProject(r.Context(), id, projectID); err != nil {
		LogError("GetReleaseByIDInProject failed for reopen", "id", id, "project_id", projectID, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	} else if rel == nil {
		http.Error(w, errMsgReleaseNotFound, http.StatusNotFound)
		return
	}
	if err := ReopenRelease(r.Context(), id); err != nil {
		if errors.Is(err, ErrReleaseNotFound) {
			http.Error(w, errMsgReleaseNotFound, http.StatusNotFound)
			return
		}
		LogError("ReopenRelease failed", "id", id, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	LogInfo("Release reopened", "id", id, "user_email", userEmail)
	updated, err := GetReleaseByID(r.Context(), id)
	if err != nil || updated == nil {
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(updated); err != nil {
		LogError("handleReopenRelease: failed to encode response", "error", err)
	}
}

func handleUpdateProject(w http.ResponseWriter, r *http.Request, id int) {
	userEmail := GetEmailFromContext(r.Context())

	var p Project
	if !decodeAndValidate(w, r, &p, validateProject) {
		return
	}

	p.ID = id
	if err := UpdateProject(r.Context(), &p); err != nil {
		if errors.Is(err, ErrProjectNotFound) {
			LogWarn("UpdateProject: project not found", "id", id, "user_email", userEmail)
			http.Error(w, errMsgProjectNotFound, http.StatusNotFound)
			return
		}
		if errors.Is(err, ErrDuplicateProjectName) {
			LogWarn("UpdateProject: name already exists", "id", id, "name", p.Name, "user_email", userEmail)
			http.Error(w, "Project name already exists", http.StatusConflict)
			return
		}
		LogError("UpdateProject failed", "id", id, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}

	LogInfo("Project updated", "id", id, "name", p.Name, "user_email", userEmail)
	w.Header().Set(headerContentType, contentTypeJSON)
	if err := json.NewEncoder(w).Encode(p); err != nil {
		LogError("handleUpdateProject: failed to encode response", "id", id, "error", err, "user_email", userEmail)
	}
}

func handleDeleteProject(w http.ResponseWriter, r *http.Request, id int) {
	userEmail := GetEmailFromContext(r.Context())

	// Prevent deleting the default project
	if id == 1 {
		LogWarn("Attempt to delete default project blocked", "id", id, "user_email", userEmail)
		http.Error(w, errMsgDefaultProject, http.StatusBadRequest)
		return
	}

	// Prevent deleting projects that still have issues
	count, err := CountIssuesByProject(r.Context(), id)
	if err != nil {
		LogError("DeleteProject: CountIssuesByProject failed", "id", id, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}
	if count > 0 {
		LogWarn("Attempt to delete project with assigned issues blocked", "id", id, "count", count, "user_email", userEmail)
		http.Error(w, errMsgProjectHasIssues, http.StatusBadRequest)
		return
	}

	if err := DeleteProject(r.Context(), id); err != nil {
		if errors.Is(err, ErrProjectNotFound) {
			LogWarn("DeleteProject: project not found", "id", id, "user_email", userEmail)
			http.Error(w, errMsgProjectNotFound, http.StatusNotFound)
			return
		}
		LogError("DeleteProject failed", "id", id, "error", err, "user_email", userEmail)
		http.Error(w, errMsgInternalServerError, http.StatusInternalServerError)
		return
	}

	LogInfo("Project deleted", "id", id, "user_email", userEmail)
	w.Header().Set(headerContentType, contentTypeJSON)
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(map[string]string{"message": "Project deleted"}); err != nil {
		LogError("handleDeleteProject: failed to encode response", "id", id, "error", err, "user_email", userEmail)
	}
}
