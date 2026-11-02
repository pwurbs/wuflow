// Configuration and accessor layer for board column statuses (4 configurable stages plus fixed anchors).
// Used by board rendering, issue modal, and project settings.
import { state } from './state.ts';
import type { StatusConfig } from './models.ts';

// Mirror of backend/models.go IssueStatus constants — keep in sync when changing.
export const STATUS_OPEN    = 'Open' as const;
export const STATUS_TODO    = 'Todo' as const;
export const STATUS_DONE    = 'Done' as const;
export const STATUS_ARCHIVE = 'Archive' as const;
export const STATUS_STAGE1  = 'Stage1' as const;
export const STATUS_STAGE2  = 'Stage2' as const;
export const STATUS_STAGE3  = 'Stage3' as const;
export const STATUS_STAGE4  = 'Stage4' as const;
export type IssueStatus =
    | typeof STATUS_OPEN | typeof STATUS_TODO | typeof STATUS_DONE | typeof STATUS_ARCHIVE
    | typeof STATUS_STAGE1 | typeof STATUS_STAGE2 | typeof STATUS_STAGE3 | typeof STATUS_STAGE4;
export const IN_PROGRESS_STATUSES: readonly IssueStatus[] = [STATUS_STAGE1, STATUS_STAGE2, STATUS_STAGE3, STATUS_STAGE4];

// Fixed mapping between StatusConfig fields and internal issue status keys.
export const STATUS_SLOTS = [
    { field: 'stage1_name', statusKey: STATUS_STAGE1 },
    { field: 'stage2_name', statusKey: STATUS_STAGE2 },
    { field: 'stage3_name', statusKey: STATUS_STAGE3 },
    { field: 'stage4_name', statusKey: STATUS_STAGE4 },
] as const;

export interface StatusOption { value: IssueStatus; label: string }
export interface BoardColumn { statusKey: IssueStatus; displayName: string }

// The column names of a StatusConfig. The default is used until a project's config is loaded,
// so it belongs to no project.
export type StatusNames = Omit<StatusConfig, 'project_id'>;

export function getDefaultStatusConfig(): StatusNames {
    return {
        stage1_name: 'Pending',
        stage2_name: 'Working',
        stage3_name: '',
        stage4_name: '',
    };
}

export function getActiveStatusConfig(): StatusNames {
    return state.statusConfig ?? getDefaultStatusConfig();
}

// Returns [{statusKey, displayName}] for the board — always includes To-do and Done
// as anchors; Stage1–4 only when their name is non-empty.
export function getBoardColumns(): BoardColumn[] {
    const cfg = getActiveStatusConfig();
    const cols: BoardColumn[] = [{ statusKey: STATUS_TODO, displayName: 'Todo' }];
    for (const slot of STATUS_SLOTS) {
        const name = cfg[slot.field];
        if (name && name.trim() !== '') {
            cols.push({ statusKey: slot.statusKey, displayName: name.trim() });
        }
    }
    cols.push({ statusKey: STATUS_DONE, displayName: 'Done' });
    return cols;
}

// Returns [{value, label}] for the issue modal status dropdown.
// Includes Open and all active board columns except Archive (archived via button).
export function getStatusOptions(): StatusOption[] {
    const cfg = getActiveStatusConfig();
    const opts: StatusOption[] = [
        { value: STATUS_OPEN, label: 'Open' },
        { value: STATUS_TODO, label: 'Todo' },
    ];
    for (const slot of STATUS_SLOTS) {
        const name = cfg[slot.field];
        if (name && name.trim() !== '') {
            opts.push({ value: slot.statusKey, label: name.trim() });
        }
    }
    opts.push({ value: STATUS_DONE, label: 'Done' }, { value: STATUS_ARCHIVE, label: 'Archived' });
    return opts;
}

// Returns the display label for a given status key using current config.
// Falls back to the raw status key if not found (e.g. for archived issues).
export function getStatusLabel(statusKey: string): string {
    const opts = getStatusOptions();
    return opts.find(o => o.value === statusKey)?.label ?? statusKey;
}
