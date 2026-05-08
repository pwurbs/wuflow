// Mirror of backend/validation.go constants — keep in sync when changing limits
export const MAX_TITLE_LENGTH     = 100;
export const MAX_DESC_LENGTH      = 5000;
export const MAX_LABEL_NAME_LEN   = 15;
export const MAX_EMAIL_LENGTH     = 254;
export const MAX_USERNAME_LENGTH  = 50;
export const MAX_PASSWORD_LENGTH  = 128;
export const MIN_PASSWORD_LENGTH  = 12;
export const MAX_PROJECT_NAME_LEN = 15;
export const MAX_PROJECT_DESC_LEN = 100;
export const MAX_STATUS_NAME_LEN  = 15;
export const MAX_RELEASE_NAME_LEN = 20;
export const MAX_RELEASE_DESC_LEN = 200;

// Mirror of backend compiled regexes in validation.go
export const EMAIL_REGEX       = /^[^\s@]+@[^\s@]+$/;
export const COLOR_REGEX       = /^#[0-9A-Fa-f]{6}$/;
export const STATUS_NAME_REGEX = /^[a-zA-Z0-9]*$/;
