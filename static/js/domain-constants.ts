// Static domain-model values shared across the frontend.
import type { Role } from './permissions.ts';

// Mirror of backend/models.go constants — keep in sync when changing.
export const PRIORITY_NORMAL = 'Normal' as const;
export const PRIORITY_HIGH   = 'High' as const;
export type Priority = typeof PRIORITY_NORMAL | typeof PRIORITY_HIGH;

export const PRIORITY_OPTIONS: readonly { text: string, value: Priority }[] = [
  { text: 'Normal', value: PRIORITY_NORMAL },
  { text: 'High',   value: PRIORITY_HIGH   },
];

// Mirror of backend/models.go ReleaseStatus constants — keep in sync when changing.
export const RELEASE_STATUS_OPEN   = 'open' as const;
export const RELEASE_STATUS_CLOSED = 'closed' as const;
export type ReleaseStatus = typeof RELEASE_STATUS_OPEN | typeof RELEASE_STATUS_CLOSED;

export const ROLE_DISPLAY_NAMES: Record<Role, string> = { sysadmin: 'Sysadmin', admin: 'Admin', user: 'User' };
