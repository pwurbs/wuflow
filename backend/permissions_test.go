package backend

import (
	"testing"
)

func TestCan(t *testing.T) {
	tests := []struct {
		role    UserRole
		action  Action
		allowed bool
	}{
		// Admin is granted all actions
		{RoleAdmin, ActionListIssues, true},
		{RoleAdmin, ActionGetIssue, true},
		{RoleAdmin, ActionCreateIssue, true},
		{RoleAdmin, ActionUpdateIssue, true},
		{RoleAdmin, ActionDeleteIssue, true},
		{RoleAdmin, ActionArchiveIssue, true},
		{RoleAdmin, ActionUnarchiveIssue, true},
		{RoleAdmin, ActionCreateTask, true},
		{RoleAdmin, ActionUpdateTask, true},
		{RoleAdmin, ActionDeleteTask, true},
		{RoleAdmin, ActionListLabels, true},
		{RoleAdmin, ActionCreateLabel, true},
		{RoleAdmin, ActionDeleteLabel, true},
		{RoleAdmin, ActionListUsers, true},
		{RoleAdmin, ActionGetUser, true},
		{RoleAdmin, ActionCreateUser, true},
		{RoleAdmin, ActionUpdateUser, true},

		// User is granted all non-destructive actions
		{RoleUser, ActionListIssues, true},
		{RoleUser, ActionGetIssue, true},
		{RoleUser, ActionCreateIssue, true},
		{RoleUser, ActionUpdateIssue, true},
		{RoleUser, ActionCreateTask, true},
		{RoleUser, ActionUpdateTask, true},
		{RoleUser, ActionDeleteTask, true},
		{RoleUser, ActionListLabels, true},
		{RoleUser, ActionListUsers, true},
		{RoleUser, ActionGetUser, true},

		// User is denied all admin-only actions
		{RoleUser, ActionDeleteIssue, false},
		{RoleUser, ActionArchiveIssue, false},
		{RoleUser, ActionUnarchiveIssue, false},
		{RoleUser, ActionCreateLabel, false},
		{RoleUser, ActionDeleteLabel, false},
		{RoleUser, ActionCreateUser, false},
		{RoleUser, ActionUpdateUser, false},

		// Unknown / empty role is denied everything
		{UserRole("unknown"), ActionCreateIssue, false},
		{UserRole(""), ActionDeleteIssue, false},

		// Unknown action is always denied (safe default)
		{RoleAdmin, Action("nonexistent:action"), false},
		{RoleUser, Action("nonexistent:action"), false},
	}

	for _, tc := range tests {
		t.Run(string(tc.role)+"/"+string(tc.action), func(t *testing.T) {
			got := Can(tc.role, tc.action)
			if got != tc.allowed {
				t.Errorf("Can(%q, %q) = %v, want %v", tc.role, tc.action, got, tc.allowed)
			}
		})
	}
}
