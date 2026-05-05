// Static domain-model values shared across the frontend.
// Mirror of backend/models.go constants — keep in sync when changing.
export const PRIORITY_NORMAL = 'Normal';
export const PRIORITY_HIGH   = 'High';

export const PRIORITY_OPTIONS = [
  { text: 'Normal', value: PRIORITY_NORMAL },
  { text: 'High',   value: PRIORITY_HIGH   },
];
