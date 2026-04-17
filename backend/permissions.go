package backend

// Action represents a discrete operation subject to authorization.
// Action constants must be kept in sync with the frontend permissions.js module.
type Action string

const (
	// Issue actions
	ActionListIssues     Action = "issue:list"
	ActionGetIssue       Action = "issue:get"
	ActionCreateIssue    Action = "issue:create"
	ActionUpdateIssue    Action = "issue:update"
	ActionDeleteIssue    Action = "issue:delete"
	ActionArchiveIssue   Action = "issue:archive"
	ActionUnarchiveIssue Action = "issue:unarchive"

	// Task actions
	ActionCreateTask Action = "task:create"
	ActionUpdateTask Action = "task:update"
	ActionDeleteTask Action = "task:delete"

	// Label actions
	ActionListLabels  Action = "label:list"
	ActionCreateLabel Action = "label:create"
	ActionDeleteLabel Action = "label:delete"

	// User management actions
	ActionListUsers  Action = "user:list"
	ActionGetUser    Action = "user:get"
	ActionCreateUser Action = "user:create"
	ActionUpdateUser Action = "user:update"

	// Project actions
	ActionListProjects  Action = "project:list"
	ActionCreateProject Action = "project:create"
	ActionUpdateProject Action = "project:update"
	ActionDeleteProject Action = "project:delete"
)

// rolePermissions is the single source of truth for the permission policy.
// It uses an allowlist model: a role must be explicitly listed to be granted an action.
// To add a new role, add it to the relevant actions here — no handler code changes needed.
//
// Role hierarchy:
//   - RoleSysAdmin: full system administration (users, projects, labels) + all RoleAdmin actions
//   - RoleAdmin:    issue power operations (delete, archive, unarchive) + all RoleUser actions
//   - RoleUser:     standard read/create/update access
var rolePermissions = map[Action][]UserRole{
	// Issues
	ActionListIssues:     {RoleSysAdmin, RoleAdmin, RoleUser},
	ActionGetIssue:       {RoleSysAdmin, RoleAdmin, RoleUser},
	ActionCreateIssue:    {RoleSysAdmin, RoleAdmin, RoleUser},
	ActionUpdateIssue:    {RoleSysAdmin, RoleAdmin, RoleUser},
	ActionDeleteIssue:    {RoleSysAdmin, RoleAdmin},
	ActionArchiveIssue:   {RoleSysAdmin, RoleAdmin},
	ActionUnarchiveIssue: {RoleSysAdmin, RoleAdmin},

	// Tasks
	ActionCreateTask: {RoleSysAdmin, RoleAdmin, RoleUser},
	ActionUpdateTask: {RoleSysAdmin, RoleAdmin, RoleUser},
	ActionDeleteTask: {RoleSysAdmin, RoleAdmin, RoleUser},

	// Labels
	ActionListLabels:  {RoleSysAdmin, RoleAdmin, RoleUser},
	ActionCreateLabel: {RoleSysAdmin, RoleAdmin},
	ActionDeleteLabel: {RoleSysAdmin, RoleAdmin},

	// Users
	ActionListUsers:  {RoleSysAdmin, RoleAdmin, RoleUser},
	ActionGetUser:    {RoleSysAdmin, RoleAdmin, RoleUser},
	ActionCreateUser: {RoleSysAdmin},
	ActionUpdateUser: {RoleSysAdmin},

	// Projects
	ActionListProjects:  {RoleSysAdmin, RoleAdmin, RoleUser},
	ActionCreateProject: {RoleSysAdmin},
	ActionUpdateProject: {RoleSysAdmin},
	ActionDeleteProject: {RoleSysAdmin},
}

// Can reports whether a user with the given role is permitted to perform action.
// Returns false for any role or action not present in the policy table (safe default).
func Can(role UserRole, action Action) bool {
	allowed, exists := rolePermissions[action]
	if !exists {
		return false
	}
	for _, r := range allowed {
		if r == role {
			return true
		}
	}
	return false
}
