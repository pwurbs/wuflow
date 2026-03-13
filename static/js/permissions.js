/**
 * Frontend authorization module.
 *
 * Mirrors the backend policy in backend/permissions.go.
 * This is UI-only — the backend always enforces real authorization.
 * Use these helpers to show/hide UI elements and prevent unnecessary API calls.
 */

// Role constants — must match backend/models.go
export const ROLE_ADMIN = 'admin';
export const ROLE_USER = 'user';

// Action constants — must match backend/permissions.go
export const ACTION_LIST_ISSUES     = 'issue:list';
export const ACTION_GET_ISSUE       = 'issue:get';
export const ACTION_CREATE_ISSUE    = 'issue:create';
export const ACTION_UPDATE_ISSUE    = 'issue:update';
export const ACTION_DELETE_ISSUE    = 'issue:delete';
export const ACTION_ARCHIVE_ISSUE   = 'issue:archive';
export const ACTION_UNARCHIVE_ISSUE = 'issue:unarchive';
export const ACTION_CREATE_TASK     = 'task:create';
export const ACTION_UPDATE_TASK     = 'task:update';
export const ACTION_DELETE_TASK     = 'task:delete';
export const ACTION_LIST_LABELS     = 'label:list';
export const ACTION_CREATE_LABEL    = 'label:create';
export const ACTION_DELETE_LABEL    = 'label:delete';
export const ACTION_LIST_USERS      = 'user:list';
export const ACTION_GET_USER        = 'user:get';
export const ACTION_CREATE_USER     = 'user:create';
export const ACTION_UPDATE_USER     = 'user:update';
export const ACTION_LIST_PROJECTS   = 'project:list';
export const ACTION_CREATE_PROJECT  = 'project:create';
export const ACTION_UPDATE_PROJECT  = 'project:update';
export const ACTION_DELETE_PROJECT  = 'project:delete';

// Allowlist policy — mirrors rolePermissions in backend/permissions.go.
// To add a new role or action, update both this map and the backend map.
const rolePermissions = {
    // Issues
    [ACTION_LIST_ISSUES]:     [ROLE_ADMIN, ROLE_USER],
    [ACTION_GET_ISSUE]:       [ROLE_ADMIN, ROLE_USER],
    [ACTION_CREATE_ISSUE]:    [ROLE_ADMIN, ROLE_USER],
    [ACTION_UPDATE_ISSUE]:    [ROLE_ADMIN, ROLE_USER],
    [ACTION_DELETE_ISSUE]:    [ROLE_ADMIN],
    [ACTION_ARCHIVE_ISSUE]:   [ROLE_ADMIN],
    [ACTION_UNARCHIVE_ISSUE]: [ROLE_ADMIN],
    // Tasks
    [ACTION_CREATE_TASK]:     [ROLE_ADMIN, ROLE_USER],
    [ACTION_UPDATE_TASK]:     [ROLE_ADMIN, ROLE_USER],
    [ACTION_DELETE_TASK]:     [ROLE_ADMIN, ROLE_USER],
    // Labels
    [ACTION_LIST_LABELS]:     [ROLE_ADMIN, ROLE_USER],
    [ACTION_CREATE_LABEL]:    [ROLE_ADMIN],
    [ACTION_DELETE_LABEL]:    [ROLE_ADMIN],
    // Users
    [ACTION_LIST_USERS]:      [ROLE_ADMIN, ROLE_USER],
    [ACTION_GET_USER]:        [ROLE_ADMIN, ROLE_USER],
    [ACTION_CREATE_USER]:     [ROLE_ADMIN],
    [ACTION_UPDATE_USER]:     [ROLE_ADMIN],
    // Projects
    [ACTION_LIST_PROJECTS]:   [ROLE_ADMIN, ROLE_USER],
    [ACTION_CREATE_PROJECT]:  [ROLE_ADMIN],
    [ACTION_UPDATE_PROJECT]:  [ROLE_ADMIN],
    [ACTION_DELETE_PROJECT]:  [ROLE_ADMIN],
};

/**
 * Returns true if the given role is permitted to perform action.
 *
 * @param {string|null} role
 * @param {string|null} action
 * @returns {boolean}
 */
export function can(role, action) {
    if (!role || !action) return false;
    const allowed = rolePermissions[action];
    if (!allowed) return false;
    return allowed.includes(role);
}

/**
 * Returns true if the given user object is permitted to perform action.
 *
 * @param {object|null} user - User object with a .role property
 * @param {string} action
 * @returns {boolean}
 */
export function userCan(user, action) {
    return can(user?.role ?? null, action);
}
