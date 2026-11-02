/**
 * Frontend authorization module.
 *
 * Mirrors the backend policy in backend/permissions.go.
 * This is UI-only — the backend always enforces real authorization.
 * Use these helpers to show/hide UI elements and prevent unnecessary API calls.
 */

// Role constants — must match backend/models.go
export const ROLE_SYSADMIN = 'sysadmin' as const;
export const ROLE_ADMIN = 'admin' as const;
export const ROLE_USER = 'user' as const;
export type Role = typeof ROLE_SYSADMIN | typeof ROLE_ADMIN | typeof ROLE_USER;

// Action constants — must match backend/permissions.go
export const ACTION_LIST_ISSUES     = 'issue:list' as const;
export const ACTION_GET_ISSUE       = 'issue:get' as const;
export const ACTION_CREATE_ISSUE    = 'issue:create' as const;
export const ACTION_UPDATE_ISSUE    = 'issue:update' as const;
export const ACTION_DELETE_ISSUE    = 'issue:delete' as const;
export const ACTION_ARCHIVE_ISSUE   = 'issue:archive' as const;
export const ACTION_UNARCHIVE_ISSUE = 'issue:unarchive' as const;
export const ACTION_MOVE_ISSUE      = 'issue:move' as const;
export const ACTION_CREATE_TASK     = 'task:create' as const;
export const ACTION_UPDATE_TASK     = 'task:update' as const;
export const ACTION_DELETE_TASK     = 'task:delete' as const;
export const ACTION_LIST_HISTORY    = 'history:list' as const;
export const ACTION_LIST_COMMENTS   = 'comment:list' as const;
export const ACTION_CREATE_COMMENT  = 'comment:create' as const;
export const ACTION_UPDATE_COMMENT  = 'comment:update' as const;
export const ACTION_DELETE_COMMENT  = 'comment:delete' as const;
export const ACTION_LIST_LABELS     = 'label:list' as const;
export const ACTION_CREATE_LABEL    = 'label:create' as const;
export const ACTION_DELETE_LABEL    = 'label:delete' as const;
export const ACTION_LIST_USERS      = 'user:list' as const;
export const ACTION_GET_USER        = 'user:get' as const;
export const ACTION_CREATE_USER     = 'user:create' as const;
export const ACTION_UPDATE_USER     = 'user:update' as const;
export const ACTION_DELETE_USER     = 'user:delete' as const;
export const ACTION_LIST_PROJECTS   = 'project:list' as const;
export const ACTION_CREATE_PROJECT  = 'project:create' as const;
export const ACTION_UPDATE_PROJECT  = 'project:update' as const;
export const ACTION_DELETE_PROJECT  = 'project:delete' as const;
export const ACTION_GET_STATUS_CONFIG    = 'statusconfig:get' as const;
export const ACTION_UPDATE_STATUS_CONFIG = 'statusconfig:update' as const;
export const ACTION_LIST_RELEASES   = 'release:list' as const;
export const ACTION_GET_RELEASE     = 'release:get' as const;
export const ACTION_CREATE_RELEASE  = 'release:create' as const;
export const ACTION_UPDATE_RELEASE  = 'release:update' as const;
export const ACTION_DELETE_RELEASE  = 'release:delete' as const;
export const ACTION_TRIGGER_RELEASE = 'release:trigger' as const;

// Allowlist policy — mirrors rolePermissions in backend/permissions.go.
// To add a new role or action, update both this map and the backend map.
//
// Role hierarchy:
//   ROLE_SYSADMIN: full system administration (users, projects, labels) + all ROLE_ADMIN actions
//   ROLE_ADMIN:    issue power operations (delete, archive, unarchive) + all ROLE_USER actions
//   ROLE_USER:     standard read/create/update access
const rolePermissions = {
    // Issues
    [ACTION_LIST_ISSUES]:     [ROLE_SYSADMIN, ROLE_ADMIN, ROLE_USER],
    [ACTION_GET_ISSUE]:       [ROLE_SYSADMIN, ROLE_ADMIN, ROLE_USER],
    [ACTION_CREATE_ISSUE]:    [ROLE_SYSADMIN, ROLE_ADMIN, ROLE_USER],
    [ACTION_UPDATE_ISSUE]:    [ROLE_SYSADMIN, ROLE_ADMIN, ROLE_USER],
    [ACTION_DELETE_ISSUE]:    [ROLE_SYSADMIN, ROLE_ADMIN],
    [ACTION_ARCHIVE_ISSUE]:   [ROLE_SYSADMIN, ROLE_ADMIN],
    [ACTION_UNARCHIVE_ISSUE]: [ROLE_SYSADMIN, ROLE_ADMIN],
    [ACTION_MOVE_ISSUE]:      [ROLE_SYSADMIN, ROLE_ADMIN],
    // Tasks
    [ACTION_CREATE_TASK]:     [ROLE_SYSADMIN, ROLE_ADMIN, ROLE_USER],
    [ACTION_UPDATE_TASK]:     [ROLE_SYSADMIN, ROLE_ADMIN, ROLE_USER],
    [ACTION_DELETE_TASK]:     [ROLE_SYSADMIN, ROLE_ADMIN, ROLE_USER],
    // Issue history + comments (author-vs-admin scope handled per-comment in the UI)
    [ACTION_LIST_HISTORY]:    [ROLE_SYSADMIN, ROLE_ADMIN, ROLE_USER],
    [ACTION_LIST_COMMENTS]:   [ROLE_SYSADMIN, ROLE_ADMIN, ROLE_USER],
    [ACTION_CREATE_COMMENT]:  [ROLE_SYSADMIN, ROLE_ADMIN, ROLE_USER],
    [ACTION_UPDATE_COMMENT]:  [ROLE_SYSADMIN, ROLE_ADMIN, ROLE_USER],
    [ACTION_DELETE_COMMENT]:  [ROLE_SYSADMIN, ROLE_ADMIN, ROLE_USER],
    // Labels
    [ACTION_LIST_LABELS]:     [ROLE_SYSADMIN, ROLE_ADMIN, ROLE_USER],
    [ACTION_CREATE_LABEL]:    [ROLE_SYSADMIN, ROLE_ADMIN],
    [ACTION_DELETE_LABEL]:    [ROLE_SYSADMIN, ROLE_ADMIN],
    // Users
    [ACTION_LIST_USERS]:      [ROLE_SYSADMIN, ROLE_ADMIN, ROLE_USER],
    [ACTION_GET_USER]:        [ROLE_SYSADMIN, ROLE_ADMIN, ROLE_USER],
    [ACTION_CREATE_USER]:     [ROLE_SYSADMIN],
    [ACTION_UPDATE_USER]:     [ROLE_SYSADMIN],
    [ACTION_DELETE_USER]:     [ROLE_SYSADMIN],
    // Projects
    [ACTION_LIST_PROJECTS]:   [ROLE_SYSADMIN, ROLE_ADMIN, ROLE_USER],
    [ACTION_CREATE_PROJECT]:  [ROLE_SYSADMIN],
    [ACTION_UPDATE_PROJECT]:  [ROLE_SYSADMIN],
    [ACTION_DELETE_PROJECT]:  [ROLE_SYSADMIN],
    // Status config
    [ACTION_GET_STATUS_CONFIG]:    [ROLE_SYSADMIN, ROLE_ADMIN, ROLE_USER],
    [ACTION_UPDATE_STATUS_CONFIG]: [ROLE_SYSADMIN, ROLE_ADMIN],
    // Releases
    [ACTION_LIST_RELEASES]:   [ROLE_SYSADMIN, ROLE_ADMIN, ROLE_USER],
    [ACTION_GET_RELEASE]:     [ROLE_SYSADMIN, ROLE_ADMIN, ROLE_USER],
    [ACTION_CREATE_RELEASE]:  [ROLE_SYSADMIN, ROLE_ADMIN],
    [ACTION_UPDATE_RELEASE]:  [ROLE_SYSADMIN, ROLE_ADMIN],
    [ACTION_DELETE_RELEASE]:  [ROLE_SYSADMIN, ROLE_ADMIN],
    [ACTION_TRIGGER_RELEASE]: [ROLE_SYSADMIN, ROLE_ADMIN],
} as const satisfies Record<string, readonly Role[]>;

export type Action = keyof typeof rolePermissions;

/**
 * Returns true if the given role is permitted to perform action.
 */
export function can(role: Role | null, action: Action | null): boolean {
    if (!role || !action) return false;
    const allowed: readonly Role[] | undefined = rolePermissions[action];
    if (!allowed) return false;
    return allowed.includes(role);
}

/**
 * Returns true if the given user object is permitted to perform action.
 */
export function userCan(user: { role?: Role | null } | null, action: Action): boolean {
    return can(user?.role ?? null, action);
}

/**
 * Returns true if the user is an admin/sysadmin, i.e. may moderate (edit or
 * delete) any comment — not just their own. Mirrors isCommentModerator in
 * backend/activity.go.
 */
export function isCommentModerator(user: { role?: Role | null } | null): boolean {
    const role = user?.role ?? null;
    return role === ROLE_SYSADMIN || role === ROLE_ADMIN;
}
