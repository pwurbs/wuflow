// Configuration and accessor layer for board column statuses (4 configurable stages plus fixed anchors).
// Used by board rendering, issue modal, and project settings.
import { state } from './state.js';

// Fixed mapping between StatusConfig fields and internal issue status keys.
export const STATUS_SLOTS = [
    { field: 'stage1_name', statusKey: 'Stage1' },
    { field: 'stage2_name', statusKey: 'Stage2' },
    { field: 'stage3_name', statusKey: 'Stage3' },
    { field: 'stage4_name', statusKey: 'Stage4' },
];

export function getDefaultStatusConfig() {
    return {
        project_id:   null,
        stage1_name: 'Pending',
        stage2_name: 'Working',
        stage3_name: '',
        stage4_name: '',
    };
}

export function getActiveStatusConfig() {
    return state.statusConfig ?? getDefaultStatusConfig();
}

// Returns [{statusKey, displayName}] for the board — always includes To-do and Done
// as anchors; Stage1–4 only when their name is non-empty.
export function getBoardColumns() {
    const cfg = getActiveStatusConfig();
    const cols = [{ statusKey: 'Todo', displayName: 'Todo' }];
    for (const slot of STATUS_SLOTS) {
        const name = cfg[slot.field];
        if (name && name.trim() !== '') {
            cols.push({ statusKey: slot.statusKey, displayName: name.trim() });
        }
    }
    cols.push({ statusKey: 'Done', displayName: 'Done' });
    return cols;
}

// Returns [{value, label}] for the issue modal status dropdown.
// Includes Open and all active board columns except Archive (archived via button).
export function getStatusOptions() {
    const cfg = getActiveStatusConfig();
    const opts = [
        { value: 'Open', label: 'Open' },
        { value: 'Todo', label: 'Todo' },
    ];
    for (const slot of STATUS_SLOTS) {
        const name = cfg[slot.field];
        if (name && name.trim() !== '') {
            opts.push({ value: slot.statusKey, label: name.trim() });
        }
    }
    opts.push({ value: 'Done', label: 'Done' });
    return opts;
}

// Returns the display label for a given status key using current config.
// Falls back to the raw status key if not found (e.g. for archived issues).
export function getStatusLabel(statusKey) {
    const opts = getStatusOptions();
    return opts.find(o => o.value === statusKey)?.label ?? statusKey;
}
