# User Management (Authentication & Authorization)

## Overview

wuFlow uses a **Hybrid Authentication** model with HTTPOnly cookies.
- **Access** is stateless (JWT).
- **Sessions** are stateful (Opaque Tokens stored in DB), allowing for secure revocation and rotation.
- Access is restricted by user roles.

## User Roles and Authorization

| Action | Admin | User |
| :--- | :---: | :---: |
| View issues & tasks | ✓ | ✓ |
| Create / edit issues | ✓ | ✓ |
| Create / edit / delete tasks | ✓ | ✓ |
| **Archive** an issue | ✓ | — |
| **Unarchive** an issue | ✓ | — |
| **Delete** an issue | ✓ | — |
| View labels & users | ✓ | ✓ |
| Create / delete labels | ✓ | — |
| Create / edit / deactivate users | ✓ | — |

> **Notes**: 
- The `/api/auth/me` endpoint (Get Current User / Update Self) is available to **all authenticated users** regardless of role. Any user can view and update their own profile (e.g. change password).
- Non-admin users do not see the Setup navigation item.

### Authorization Concept

Authorization is enforced by a single **allowlist policy table** in `backend/permissions.go`. Every HTTP operation is mapped to a named action constant (e.g. `ActionArchiveIssue`), and each action explicitly lists the roles that may perform it. The `Can(role, action)` function is the sole entry point — no role logic lives in individual handlers.

Each handler evaluates `Can()` at the **method-dispatch level**, before any database access. A missing or insufficient role always results in `403 Forbidden` before any side effects occur.

The frontend mirrors this policy in `static/js/permissions.js` via `userCan(user, action)`. UI elements (archive/delete buttons, drag-drop targets) are hidden or blocked on the client side, while the backend remains the authoritative enforcement point.

## Initial Admin

On first startup, wuFlow requires an initial admin password to create the default admin account:

```bash
WF_INITIAL_ADMIN_PASSWORD=YourSecurePass123! ./wuflow
```

- The initial admin is created with the email `admin@local`.
- This only happens when the users table is empty (first run).
- The password must meet the password policy (see below).

## Authentication Flow

wuFlow uses a **Hybrid Authentication** model:
- **Access Tokens**: Short-lived, stateless JWTs (JSON Web Tokens) for high-performance API authorization.
- **Refresh Tokens**: Long-lived, stateful **Opaque Tokens** (Random Strings) backed by a database session for enhanced security.

### 1. Normal Operation
```mermaid
sequenceDiagram
    actor U as User
    participant C as Client
    participant S as Server
    participant DB as Database

    %% Login
    U->>C: Enter Credentials
    C->>S: POST /login (user, pass)
    S->>S: Generate SessionID & Opaque Secret
    S->>S: Hash(Secret)
    S->>DB: Insert Session(User, Hash)
    S-->>C: Set-Cookie: AccessToken(JWT), RefreshToken(Opaque)

    %% Access (Stateless)
    Note over C, S: User makes API calls
    C->>S: GET /api/data (Bearer JWT)
    S->>S: Verify JWT Signature & Expiry
    S-->>C: 200 OK (Data)

    %% Refresh (Stateful & Rotation)
    Note over C, S: JWT Expires (15m)
    C->>S: POST /refresh (Cookie: OpaqueToken)
    S->>DB: Get Session (Verify Hash)
    Note right of S: Valid! Rotate.
    S->>S: Generate New Secret & Hash
    S->>DB: Update Session Hash
    S-->>C: Set-Cookie: New AccessToken, New RefreshToken

    %% Logout
    U->>C: Click Logout
    C->>S: POST /logout
    S->>DB: DELETE Session
    S-->>C: Clear Cookies
```

1. **Login**: User submits credentials. Server creates a **Session** in the database and returns two HTTPOnly cookies.
2. **Access**: The stateless JWT is used for API requests. Validation is fast (CPU only, no DB).
3. **Refresh (Rotation)**: When the JWT expires, the client sends the Opaque Refresh Token.
    - The server looks up the session in the DB.
    - **Rotation**: If valid, a **NEW** Refresh Token is generated, and the old one is invalidated immediately.
    - This "Sliding Session" keeps the user logged in as long as they are active.
4. **Logout**: The session is permanently deleted from the database.

### 2. Security Features

#### Opaque Refresh Tokens
Unlike JWTs, the Refresh Token is a random string (`base64(session_id:secret)`).
- **Database Storage**: Only an **HMAC-SHA256** digest of the secret is stored, keyed with a token MAC key derived from the server's secret key (domain-separated HMAC-KDF — independent from the JWT signing key).
- **Leak Protection**: Even if the database is leaked, attackers cannot generate valid refresh tokens without also knowing the server's secret key.

#### Cryptographic Primitives

| Credential | Algorithm | Key / Cost |
| :--- | :--- | :--- |
| User passwords | bcrypt | Default cost (~300 ms) |
| JWT access tokens | HMAC-SHA256 (HS256) | Derived from `secretKey` via domain-separated HMAC-KDF |
| Refresh token integrity | HMAC-SHA256 | Derived from `secretKey` via domain-separated HMAC-KDF |

#### Reuse Detection (Anti-Theft)
If an attacker steals a Refresh Token and uses it, the legal user (or the attacker) will eventually try to use the *same* (now reused) token again.
- The server detects that an **old** token is being presented.
- **Action**: The server assumes theft and **immediately revokes ALL sessions for that user** (Family Revocation).
- **Result**: Both the attacker and the victim are logged out from all devices, preventing further unauthorized access.

```mermaid
sequenceDiagram
    actor A as Attacker
    actor U as User
    participant S as Server
    participant DB as Database

    Note over A, S: Attacker steals RefreshToken (R1)
    
    %% Attacker uses it
    A->>S: POST /refresh (R1)
    S->>DB: Valid. Rotate to R2.
    S-->>A: Return R2

    %% User tries to use old token
    Note over U, S: User tries to refresh later
    U->>S: POST /refresh (R1)
    S->>DB: HASH MISMATCH! (Exp R2, Got R1)
    Note right of S: REUSE DETECTED!
    S->>DB: DELETE Sessions (Revoke All User Devices)
    S-->>U: 401 Unauthorized
```

#### Rate Limiting & Brute Force Protection
To protect against credential stuffing and brute force attacks while preventing targeted Denial of Service (DoS), the login endpoint employs a dual-layer rate limiting strategy:
1. **Per-IP Limit**: Maximizes at 20 failures per 15 minutes. Returns a fast `429 Too Many Requests` to shed load and stop automated botnets.
2. **Per-IP & Email Limit**: Maximizes at 10 failures per 15 minutes. Returns a generic `401 Unauthorized` to prevent attackers from locking out legitimate users from arbitrary IP addresses.
   - **Timing Side-Channel Protection**: When this limit is hit (or when a requested account doesn't exist or is inactive), the server executes a "dummy" password hash. This intentionally burns the exact same CPU time (~150ms) as a real login attempt, completely hiding the rate-limit or account status from the attacking client's network timing measurements.

### Token Details

| Token | Duration | Purpose | Storage |
| :--- | :--- | :--- | :--- |
| **Access Token** | 15 minutes | API Authorization | Stateless (JWT) |
| **Refresh Token** | 24 hours | Session Renewal | Stateful (DB Hash) |

- **Idle Timeout**: If a user is inactive for >24 hours, their session expires and they must re-login.
- **Active Sessions**: As long as the user uses the app once every 24 hours, the session effectively never expires (Sliding Window).
### Token Refresh Details

1. **API Requests**: The frontend uses a 401 interceptor with a mutex to catch expired access tokens. It calls `/api/auth/refresh` once, then retries all pending requests. This avoids race conditions (Token Reuse Detection) during concurrent API calls.
2. **Static Page Loads**: On browser refresh or direct navigation, the server automatically checks the refresh token cookie. If valid, it refreshes the session and serves the page immediately without a redirect. This ensures a seamless initial load.

### Custom Secret Key

By default, a random secret key is generated on every startup. This key serves two purposes: signing JWT access tokens and computing HMAC integrity hashes for refresh tokens. Without a configured key, all sessions are invalidated on restart and users must re-login. To persist sessions across restarts, provide a stable key:

```bash
WF_SECRET_KEY=your-secure-random-string ./wuflow
```

The key should be a long, random string (32+ characters recommended).



## Password Policy

- Minimum **12 characters**
- Must **not** be the user's email address
- Must **not** be a commonly used password (checked against a blacklist)

## User Lifecycle

- Admins can create, edit, activate, and deactivate users via the Setup view.
- **Inactive users** cannot log in. 
- **Session Revocation**: The following actions trigger immediate revocation of **all** user sessions (Family Revocation):
  - Deactivating a user
  - Changing a user's password
  - **Changing a user's role** (e.g. Admin -> User)
  - Detecting **Token Reuse** (suspected theft)
  - **Note**: Existing Access Tokens remain valid until they expire (max 15 minutes). When the client attempts to refresh the token, the request will fail (401), causing the application to log the user out.
