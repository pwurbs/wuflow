# Authentication & User Management

## Overview

wuFlow uses JWT-based authentication with HTTPOnly cookies. Access is restricted by user roles, and all sessions are stateless.

## User Roles

| Role | Permissions |
| :--- | :--- |
| **Admin** | Full access: manage issues, labels, and users |
| **User** | Manage issues and tasks only |

- Only admins can access the **Setup** view (labels and user management).
- Non-admin users do not see the Setup navigation item.

## Initial Admin

On first startup, wuFlow requires an initial admin password to create the default admin account:

```bash
WF_INITIAL_ADMIN_PASSWORD=YourSecurePass123! ./wuflow
```

- The initial admin is created with the email `admin@local`.
- This only happens when the users table is empty (first run).
- The password must meet the password policy (see below).

## Authentication Flow

```
Login → Access Token (15 min) + Refresh Token (24 h) → stored as HTTPOnly cookies
```

1. **Login**: User submits email + password to `/api/auth/login`. On success, two HTTPOnly cookies are set.
2. **API Requests**: The access token cookie is sent automatically with every request.
3. **Token Refresh**:
    - **API Requests**: The frontend uses a 401 interceptor with a mutex to catch expired access tokens. It calls `/api/auth/refresh` once, then retries all pending requests. This avoids race conditions during concurrent API calls.
    - **Static Page Loads**: On browser refresh or direct navigation, the server automatically checks the refresh token cookie. If valid, it refreshes the session and serves the page immediately without a redirect. This ensures a seamless initial load.
4. **Logout**: Clears both cookies via `/api/auth/logout`.

### Token Details

| Token | Duration | Purpose |
| :--- | :--- | :--- |
| Access Token | 15 minutes | Authenticates API requests |
| Refresh Token | 24 hours | Renews expired access tokens |

- Tokens are signed with a random secret generated on each server start.
- **All sessions are invalidated on server restart** (users must re-login) unless a custom JWT secret is configured (see below).

### Custom JWT Secret

By default, a random JWT signing secret is generated on every startup. This means all tokens become invalid after a restart. To keep sessions alive across restarts, provide a stable secret:

```bash
WF_JWT_SECRET=your-secure-random-string ./wuflow
```

The secret should be a long, random string (32+ characters recommended). Keep it confidential — anyone with the secret can forge valid tokens.

## Password Policy

- Minimum **12 characters**
- Must **not** be the user's email address
- Must **not** be a commonly used password (checked against a blacklist)

Passwords are hashed using **bcrypt** before storage.

## User Lifecycle

- Admins can create, edit, activate, and deactivate users via the Setup view.
- **Inactive users** cannot log in. Their sessions become invalid on the next token refresh.
- The system prevents deactivating or demoting the **last active admin** to avoid lockout.
