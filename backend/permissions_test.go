package backend

import (
	"testing"
)

const actionUnknown Action = "nonexistent:action"

func TestCan(t *testing.T) {
	tests := []struct {
		role    UserRole
		action  Action
		allowed bool
	}{
		// SysAdmin is granted all actions (super-admin)
		{RoleSysAdmin, ActionListIssues, true},
		{RoleSysAdmin, ActionGetIssue, true},
		{RoleSysAdmin, ActionCreateIssue, true},
		{RoleSysAdmin, ActionUpdateIssue, true},
		{RoleSysAdmin, ActionDeleteIssue, true},
		{RoleSysAdmin, ActionArchiveIssue, true},
		{RoleSysAdmin, ActionUnarchiveIssue, true},
		{RoleSysAdmin, ActionCreateTask, true},
		{RoleSysAdmin, ActionUpdateTask, true},
		{RoleSysAdmin, ActionDeleteTask, true},
		{RoleSysAdmin, ActionListLabels, true},
		{RoleSysAdmin, ActionCreateLabel, true},
		{RoleSysAdmin, ActionDeleteLabel, true},
		{RoleSysAdmin, ActionListUsers, true},
		{RoleSysAdmin, ActionGetUser, true},
		{RoleSysAdmin, ActionCreateUser, true},
		{RoleSysAdmin, ActionUpdateUser, true},
		{RoleSysAdmin, ActionListProjects, true},
		{RoleSysAdmin, ActionCreateProject, true},
		{RoleSysAdmin, ActionUpdateProject, true},
		{RoleSysAdmin, ActionDeleteProject, true},

		// Admin is granted issue power operations, label management, and all standard actions,
		// but NOT system management (users/projects write)
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
		{RoleAdmin, ActionListProjects, true},

		// Admin is denied sysadmin-only actions
		{RoleAdmin, ActionCreateUser, false},
		{RoleAdmin, ActionUpdateUser, false},
		{RoleAdmin, ActionCreateProject, false},
		{RoleAdmin, ActionUpdateProject, false},
		{RoleAdmin, ActionDeleteProject, false},

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
		{RoleUser, ActionListProjects, true},

		// User is denied all elevated actions
		{RoleUser, ActionDeleteIssue, false},
		{RoleUser, ActionArchiveIssue, false},
		{RoleUser, ActionUnarchiveIssue, false},
		{RoleUser, ActionCreateLabel, false},
		{RoleUser, ActionDeleteLabel, false},
		{RoleUser, ActionCreateUser, false},
		{RoleUser, ActionUpdateUser, false},
		{RoleUser, ActionCreateProject, false},
		{RoleUser, ActionUpdateProject, false},
		{RoleUser, ActionDeleteProject, false},

		// Unknown / empty role is denied everything
		{UserRole("unknown"), ActionCreateIssue, false},
		{UserRole(""), ActionDeleteIssue, false},

		// Unknown action is always denied (safe default)
		{RoleSysAdmin, actionUnknown, false},
		{RoleAdmin, actionUnknown, false},
		{RoleUser, actionUnknown, false},
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
