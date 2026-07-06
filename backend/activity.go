package backend

import (
	"context"
	"strings"
	"time"
)

// recordHistory appends one immutable audit-trail entry for an issue. It is
// best-effort: a failure is logged but never propagated, so a failed history
// write can never fail the user's primary action.
func recordHistory(ctx context.Context, issueID, userID int, event string, data ChangeData) {
	h := &HistoryEntry{IssueID: issueID, Event: event, Data: data}
	if userID > 0 {
		h.UserID = &userID
	}
	if err := CreateHistoryEntry(ctx, h); err != nil {
		LogError("recordHistory failed", "issue_id", issueID, "event", event, "error", err)
	}
}

// isCommentModerator reports whether a role may edit or delete any comment
// (not just its own). Admins and sysadmins can do anything.
func isCommentModerator(role UserRole) bool {
	return role == RoleAdmin || role == RoleSysAdmin
}

// -----------------------------------------------------------------------------
// Issue-edit history diffing
// -----------------------------------------------------------------------------

// recordIssueEditHistory records one EventUpdated entry per changed field by
// diffing the pre-update issue against the freshly persisted one. Both are fully
// hydrated (label/assignee/release) so from/to values are human-readable.
func recordIssueEditHistory(ctx context.Context, old *Issue, issueID, userID int) {
	updated, err := GetIssueByID(ctx, issueID)
	if err != nil || updated == nil {
		return
	}
	for _, d := range diffIssueFields(old, updated) {
		recordHistory(ctx, issueID, userID, EventUpdated, d)
	}
}

// diffIssueFields returns a ChangeData per changed field. Title and description
// carry no from/to (only that they changed); the rest carry human-readable
// from/to values (status keeps the raw status key for the frontend to map).
func diffIssueFields(old, updated *Issue) []ChangeData {
	var changes []ChangeData
	if old.Title != updated.Title {
		changes = append(changes, ChangeData{Field: "title"})
	}
	if old.Description != updated.Description {
		changes = append(changes, ChangeData{Field: "description"})
	}
	if old.Status != updated.Status {
		changes = append(changes, ChangeData{Field: "status", From: string(old.Status), To: string(updated.Status)})
	}
	if old.Priority != updated.Priority {
		changes = append(changes, ChangeData{Field: "priority", From: string(old.Priority), To: string(updated.Priority)})
	}
	if of, nf := deadlineStr(old.Deadline), deadlineStr(updated.Deadline); of != nf {
		changes = append(changes, ChangeData{Field: "deadline", From: of, To: nf})
	}
	if oa, na := assigneeName(old), assigneeName(updated); oa != na {
		changes = append(changes, ChangeData{Field: "assignee", From: oa, To: na})
	}
	if ol, nl := labelName(old), labelName(updated); ol != nl {
		changes = append(changes, ChangeData{Field: "label", From: ol, To: nl})
	}
	if or, nr := releaseName(old), releaseName(updated); or != nr {
		changes = append(changes, ChangeData{Field: "release", From: or, To: nr})
	}
	return changes
}

func deadlineStr(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.Format("2006-01-02")
}

func assigneeName(i *Issue) string {
	if i.Assignee == nil {
		return ""
	}
	return strings.TrimSpace(i.Assignee.FirstName + " " + i.Assignee.LastName)
}

func labelName(i *Issue) string {
	if i.Label == nil {
		return ""
	}
	return i.Label.Name
}

func releaseName(i *Issue) string {
	if i.Release == nil {
		return ""
	}
	return i.Release.Name
}

// findIssueTask returns the task with the given id from the issue's loaded tasks,
// or nil. Used to diff a task's prior state when recording task history.
func findIssueTask(issue *Issue, id int) *Task {
	for idx := range issue.Tasks {
		if issue.Tasks[idx].ID == id {
			return &issue.Tasks[idx]
		}
	}
	return nil
}

// taskUpdateChange builds the history entry for a task update, or a zero-value
// ChangeData (Field == "") when the change is not worth recording (e.g. only
// position/deadline changed).
func taskUpdateChange(old *Task, updated *Task) ChangeData {
	if old != nil && old.Done != updated.Done {
		if updated.Done {
			return ChangeData{Field: "task_completed", Detail: "Task: Completed '" + updated.Title + "'"}
		}
		return ChangeData{Field: "task_reopened", Detail: "Task: Reopened '" + updated.Title + "'"}
	}
	if old != nil && old.Title != updated.Title {
		return ChangeData{Field: "task_renamed", Detail: "Task: Renamed " + old.Title + " → " + updated.Title}
	}
	return ChangeData{}
}
