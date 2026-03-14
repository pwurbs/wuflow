import { describe, it, expect } from 'vitest';
import {
    can, userCan,
    ROLE_SYSADMIN, ROLE_ADMIN, ROLE_USER,
    ACTION_LIST_ISSUES, ACTION_GET_ISSUE, ACTION_CREATE_ISSUE, ACTION_UPDATE_ISSUE,
    ACTION_DELETE_ISSUE, ACTION_ARCHIVE_ISSUE, ACTION_UNARCHIVE_ISSUE,
    ACTION_CREATE_TASK, ACTION_UPDATE_TASK, ACTION_DELETE_TASK,
    ACTION_LIST_LABELS, ACTION_CREATE_LABEL, ACTION_DELETE_LABEL,
    ACTION_LIST_USERS, ACTION_GET_USER, ACTION_CREATE_USER, ACTION_UPDATE_USER,
    ACTION_LIST_PROJECTS, ACTION_CREATE_PROJECT, ACTION_UPDATE_PROJECT, ACTION_DELETE_PROJECT,
} from '../permissions.js';

// Actions only sysadmin can perform (system management + issue power ops)
const SYSADMIN_ONLY_ACTIONS = [
    ACTION_CREATE_LABEL,
    ACTION_DELETE_LABEL,
    ACTION_CREATE_USER,
    ACTION_UPDATE_USER,
    ACTION_CREATE_PROJECT,
    ACTION_UPDATE_PROJECT,
    ACTION_DELETE_PROJECT,
];

// Actions both sysadmin and admin can perform (issue power operations)
const ADMIN_AND_SYSADMIN_ACTIONS = [
    ACTION_DELETE_ISSUE,
    ACTION_ARCHIVE_ISSUE,
    ACTION_UNARCHIVE_ISSUE,
];

// Actions all authenticated roles can perform
const USER_ALLOWED_ACTIONS = [
    ACTION_LIST_ISSUES,
    ACTION_GET_ISSUE,
    ACTION_CREATE_ISSUE,
    ACTION_UPDATE_ISSUE,
    ACTION_CREATE_TASK,
    ACTION_UPDATE_TASK,
    ACTION_DELETE_TASK,
    ACTION_LIST_LABELS,
    ACTION_LIST_USERS,
    ACTION_GET_USER,
    ACTION_LIST_PROJECTS,
];

describe('can()', () => {
    it('grants sysadmin all sysadmin-only actions', () => {
        for (const action of SYSADMIN_ONLY_ACTIONS) {
            expect(can(ROLE_SYSADMIN, action), `sysadmin should have ${action}`).toBe(true);
        }
    });

    it('grants sysadmin all admin+sysadmin actions', () => {
        for (const action of ADMIN_AND_SYSADMIN_ACTIONS) {
            expect(can(ROLE_SYSADMIN, action), `sysadmin should have ${action}`).toBe(true);
        }
    });

    it('grants sysadmin all user-allowed actions', () => {
        for (const action of USER_ALLOWED_ACTIONS) {
            expect(can(ROLE_SYSADMIN, action), `sysadmin should have ${action}`).toBe(true);
        }
    });

    it('grants admin all admin+sysadmin actions', () => {
        for (const action of ADMIN_AND_SYSADMIN_ACTIONS) {
            expect(can(ROLE_ADMIN, action), `admin should have ${action}`).toBe(true);
        }
    });

    it('denies admin all sysadmin-only actions', () => {
        for (const action of SYSADMIN_ONLY_ACTIONS) {
            expect(can(ROLE_ADMIN, action), `admin should not have ${action}`).toBe(false);
        }
    });

    it('grants admin all user-allowed actions', () => {
        for (const action of USER_ALLOWED_ACTIONS) {
            expect(can(ROLE_ADMIN, action), `admin should have ${action}`).toBe(true);
        }
    });

    it('denies user all elevated actions', () => {
        const elevatedActions = [...SYSADMIN_ONLY_ACTIONS, ...ADMIN_AND_SYSADMIN_ACTIONS];
        for (const action of elevatedActions) {
            expect(can(ROLE_USER, action), `user should not have ${action}`).toBe(false);
        }
    });

    it('grants user all user-allowed actions', () => {
        for (const action of USER_ALLOWED_ACTIONS) {
            expect(can(ROLE_USER, action), `user should have ${action}`).toBe(true);
        }
    });

    it('returns false for null role', () => {
        expect(can(null, ACTION_DELETE_ISSUE)).toBe(false);
    });

    it('returns false for undefined role', () => {
        expect(can(undefined, ACTION_DELETE_ISSUE)).toBe(false);
    });

    it('returns false for unknown role', () => {
        expect(can('superadmin', ACTION_DELETE_ISSUE)).toBe(false);
    });

    it('returns false for unknown action', () => {
        expect(can(ROLE_SYSADMIN, 'nonexistent:action')).toBe(false);
        expect(can(ROLE_ADMIN, 'nonexistent:action')).toBe(false);
    });

    it('returns false for null action', () => {
        expect(can(ROLE_SYSADMIN, null)).toBe(false);
        expect(can(ROLE_ADMIN, null)).toBe(false);
    });
});

describe('userCan()', () => {
    it('returns true for sysadmin user on sysadmin-only action', () => {
        const user = { role: ROLE_SYSADMIN };
        expect(userCan(user, ACTION_CREATE_USER)).toBe(true);
    });

    it('returns true for sysadmin user on issue power action', () => {
        const user = { role: ROLE_SYSADMIN };
        expect(userCan(user, ACTION_DELETE_ISSUE)).toBe(true);
    });

    it('returns true for admin user on issue power action', () => {
        const user = { role: ROLE_ADMIN };
        expect(userCan(user, ACTION_DELETE_ISSUE)).toBe(true);
    });

    it('returns false for admin user on sysadmin-only action', () => {
        const user = { role: ROLE_ADMIN };
        expect(userCan(user, ACTION_CREATE_USER)).toBe(false);
    });

    it('returns false for regular user on elevated actions', () => {
        const user = { role: ROLE_USER };
        expect(userCan(user, ACTION_DELETE_ISSUE)).toBe(false);
        expect(userCan(user, ACTION_CREATE_USER)).toBe(false);
    });

    it('returns false for null user', () => {
        expect(userCan(null, ACTION_DELETE_ISSUE)).toBe(false);
    });

    it('returns false for user without role', () => {
        expect(userCan({}, ACTION_DELETE_ISSUE)).toBe(false);
    });

    it('returns false for undefined user', () => {
        expect(userCan(undefined, ACTION_DELETE_ISSUE)).toBe(false);
    });
});
