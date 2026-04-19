import { describe, it, expect, beforeEach } from 'vitest';
import {
    STATUS_SLOTS,
    getDefaultStatusConfig,
    getActiveStatusConfig,
    getBoardColumns,
    getStatusOptions,
    getStatusLabel,
} from '../status-config.js';
import { state } from '../state.js';

describe('status-config', () => {
    beforeEach(() => {
        state.statusConfig = null;
    });

    describe('STATUS_SLOTS', () => {
        it('should define 4 stage slots mapping fields to status keys', () => {
            expect(STATUS_SLOTS).toHaveLength(4);
            expect(STATUS_SLOTS.map(s => s.field)).toEqual([
                'stage1_name', 'stage2_name', 'stage3_name', 'stage4_name',
            ]);
            expect(STATUS_SLOTS.map(s => s.statusKey)).toEqual([
                'Stage1', 'Stage2', 'Stage3', 'Stage4',
            ]);
        });
    });

    describe('getDefaultStatusConfig', () => {
        it('should return default config with Pending and Working stages', () => {
            const cfg = getDefaultStatusConfig();
            expect(cfg.project_id).toBeNull();
            expect(cfg.stage1_name).toBe('Pending');
            expect(cfg.stage2_name).toBe('Working');
            expect(cfg.stage3_name).toBe('');
            expect(cfg.stage4_name).toBe('');
        });

        it('should return a new object each call', () => {
            expect(getDefaultStatusConfig()).not.toBe(getDefaultStatusConfig());
        });
    });

    describe('getActiveStatusConfig', () => {
        it('should return default config when state.statusConfig is null', () => {
            expect(getActiveStatusConfig()).toEqual(getDefaultStatusConfig());
        });

        it('should return state.statusConfig when set', () => {
            state.statusConfig = { project_id: 1, stage1_name: 'In Progress', stage2_name: '', stage3_name: '', stage4_name: '' };
            expect(getActiveStatusConfig()).toBe(state.statusConfig);
        });
    });

    describe('getBoardColumns', () => {
        it('should always start with Todo and end with Done', () => {
            const cols = getBoardColumns();
            expect(cols[0]).toEqual({ statusKey: 'Todo', displayName: 'Todo' });
            expect(cols.at(-1)).toEqual({ statusKey: 'Done', displayName: 'Done' });
        });

        it('should include active stages from config', () => {
            state.statusConfig = { stage1_name: 'In Progress', stage2_name: 'Review', stage3_name: '', stage4_name: '' };
            const cols = getBoardColumns();
            expect(cols).toEqual([
                { statusKey: 'Todo',   displayName: 'Todo' },
                { statusKey: 'Stage1', displayName: 'In Progress' },
                { statusKey: 'Stage2', displayName: 'Review' },
                { statusKey: 'Done',   displayName: 'Done' },
            ]);
        });

        it('should exclude stages with empty names', () => {
            state.statusConfig = { stage1_name: 'Active', stage2_name: '', stage3_name: '', stage4_name: '' };
            const cols = getBoardColumns();
            expect(cols.map(c => c.statusKey)).toEqual(['Todo', 'Stage1', 'Done']);
        });

        it('should exclude stages with whitespace-only names', () => {
            state.statusConfig = { stage1_name: '   ', stage2_name: 'Review', stage3_name: '', stage4_name: '' };
            const cols = getBoardColumns();
            expect(cols.map(c => c.statusKey)).toEqual(['Todo', 'Stage2', 'Done']);
        });

        it('should trim stage display names', () => {
            state.statusConfig = { stage1_name: '  Active  ', stage2_name: '', stage3_name: '', stage4_name: '' };
            const cols = getBoardColumns();
            expect(cols.find(c => c.statusKey === 'Stage1').displayName).toBe('Active');
        });

        it('should return only anchors when all stages are empty', () => {
            state.statusConfig = { stage1_name: '', stage2_name: '', stage3_name: '', stage4_name: '' };
            const cols = getBoardColumns();
            expect(cols).toEqual([
                { statusKey: 'Todo', displayName: 'Todo' },
                { statusKey: 'Done', displayName: 'Done' },
            ]);
        });

        it('should support all 4 stages active', () => {
            state.statusConfig = { stage1_name: 'A', stage2_name: 'B', stage3_name: 'C', stage4_name: 'D' };
            const cols = getBoardColumns();
            expect(cols.map(c => c.statusKey)).toEqual(['Todo', 'Stage1', 'Stage2', 'Stage3', 'Stage4', 'Done']);
        });
    });

    describe('getStatusOptions', () => {
        it('should always include Open, Todo, and Done', () => {
            state.statusConfig = { stage1_name: '', stage2_name: '', stage3_name: '', stage4_name: '' };
            const opts = getStatusOptions();
            expect(opts.map(o => o.value)).toEqual(['Open', 'Todo', 'Done']);
        });

        it('should include active stages between Todo and Done', () => {
            state.statusConfig = { stage1_name: 'In Progress', stage2_name: '', stage3_name: '', stage4_name: '' };
            const opts = getStatusOptions();
            expect(opts.map(o => o.value)).toEqual(['Open', 'Todo', 'Stage1', 'Done']);
            expect(opts.find(o => o.value === 'Stage1').label).toBe('In Progress');
        });

        it('should not include Archive', () => {
            const opts = getStatusOptions();
            expect(opts.map(o => o.value)).not.toContain('Archive');
        });

        it('should trim stage labels', () => {
            state.statusConfig = { stage1_name: '  Review  ', stage2_name: '', stage3_name: '', stage4_name: '' };
            const opts = getStatusOptions();
            expect(opts.find(o => o.value === 'Stage1').label).toBe('Review');
        });
    });

    describe('getStatusLabel', () => {
        it('should return label for known status keys', () => {
            state.statusConfig = { stage1_name: 'In Progress', stage2_name: '', stage3_name: '', stage4_name: '' };
            expect(getStatusLabel('Open')).toBe('Open');
            expect(getStatusLabel('Todo')).toBe('Todo');
            expect(getStatusLabel('Stage1')).toBe('In Progress');
            expect(getStatusLabel('Done')).toBe('Done');
        });

        it('should fall back to the raw status key for unknown values', () => {
            // Archive is never included in options; Stage3/Stage4 are empty in the default config
            expect(getStatusLabel('Archive')).toBe('Archive');
            expect(getStatusLabel('Stage3')).toBe('Stage3');
        });
    });
});
