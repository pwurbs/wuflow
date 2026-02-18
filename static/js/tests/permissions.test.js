import { describe, it, expect } from 'vitest';
import {
    can, userCan,
    ROLE_ADMIN, ROLE_USER,
    ACTION_LIST_ISSUES, ACTION_GET_ISSUE, ACTION_CREATE_ISSUE, ACTION_UPDATE_ISSUE,
    ACTION_DELETE_ISSUE, ACTION_ARCHIVE_ISSUE, ACTION_UNARCHIVE_ISSUE,
    ACTION_CREATE_TASK, ACTION_UPDATE_TASK, ACTION_DELETE_TASK,
    ACTION_LIST_LABELS, ACTION_CREATE_LABEL, ACTION_DELETE_LABEL,
    ACTION_LIST_USERS, ACTION_GET_USER, ACTION_CREATE_USER, ACTION_UPDATE_USER,
} from '../permissions.js';

const ADMIN_ONLY_ACTIONS = [
    ACTION_DELETE_ISSUE,
    ACTION_ARCHIVE_ISSUE,
    ACTION_UNARCHIVE_ISSUE,
    ACTION_CREATE_LABEL,
    ACTION_DELETE_LABEL,
    ACTION_CREATE_USER,
    ACTION_UPDATE_USER,
];

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
];

describe('can()', () => {
    it('grants admin all restricted actions', () => {
        for (const action of ADMIN_ONLY_ACTIONS) {
            expect(can(ROLE_ADMIN, action), `admin should have ${action}`).toBe(true);
        }
    });

    it('denies user all restricted actions', () => {
        for (const action of ADMIN_ONLY_ACTIONS) {
            expect(can(ROLE_USER, action), `user should not have ${action}`).toBe(false);
        }
    });

    it('grants both roles all user-allowed actions', () => {
        for (const action of USER_ALLOWED_ACTIONS) {
            expect(can(ROLE_ADMIN, action), `admin should have ${action}`).toBe(true);
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
        expect(can(ROLE_ADMIN, 'nonexistent:action')).toBe(false);
    });

    it('returns false for null action', () => {
        expect(can(ROLE_ADMIN, null)).toBe(false);
    });
});

describe('userCan()', () => {
    it('returns true for admin user', () => {
        const user = { role: ROLE_ADMIN };
        expect(userCan(user, ACTION_DELETE_ISSUE)).toBe(true);
    });

    it('returns false for regular user', () => {
        const user = { role: ROLE_USER };
        expect(userCan(user, ACTION_DELETE_ISSUE)).toBe(false);
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
