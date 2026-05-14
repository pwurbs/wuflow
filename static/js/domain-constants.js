// Static domain-model values shared across the frontend.
// Mirror of backend/models.go constants — keep in sync when changing.
export const PRIORITY_NORMAL = 'Normal';
export const PRIORITY_HIGH   = 'High';

export const PRIORITY_OPTIONS = [
  { text: 'Normal', value: PRIORITY_NORMAL },
  { text: 'High',   value: PRIORITY_HIGH   },
];

// Mirror of backend/models.go ReleaseStatus constants — keep in sync when changing.
export const RELEASE_STATUS_OPEN   = 'open';
export const RELEASE_STATUS_CLOSED = 'closed';

export const ROLE_DISPLAY_NAMES = { sysadmin: 'Sysadmin', admin: 'Admin', user: 'User' };
