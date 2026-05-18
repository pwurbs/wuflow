# API Documentation

Base URL: `/api`

## Authentication

All API endpoints except `/api/auth/login` require authentication via HTTPOnly cookies. The server uses JWT tokens with automatic refresh.

## Handler Mapping

Every route is registered with Go 1.22 method+path syntax in `backend/server.go`; the mux returns `405` automatically when the path matches but no handler is registered for the request method. Project-scoped routes flow through the `checkProjectAccess` helper which validates the `{pId}` URL parameter and (eventually) per-project membership.

| Endpoint | Method | Handler | Auth | Description |
| :--- | :--- | :--- | :--- | :--- |
| `/auth/login` | POST | `HandleLogin` | Public | Authenticate user |
| `/auth/logout` | POST | `HandleLogout` | Public | Clear auth cookies |
| `/auth/refresh` | POST | `HandleRefresh` | Refresh Token | Refresh access token |
| `/auth/me` | GET | `HandleGetCurrentUser` | Required | Get current user |
| `/auth/me` | PUT | `HandleUpdateSelf` | Required | Update own profile (e.g. password) |
| `/users` | GET | `handleListUsers` | Required | List all users |
| `/users` | POST | `handleCreateUser` | Sysadmin | Create new user |
| `/users/:id` | GET | `handleGetUser` | Required | Get user details |
| `/users/:id` | PUT | `handleUpdateUser` | Sysadmin | Update user |
| `/projects/:pId/issues/active` | GET | `handleProjectActiveIssues` | Required | Get active issues for a project (Todo, Pending, Working, Done) |
| `/projects/:pId/issues/open` | GET | `handleProjectOpenIssues` | Required | Get open (backlog) issues for a project |
| `/projects/:pId/issues/archived` | GET | `handleProjectArchivedIssues` | Required | Get archived issues for a project |
| `/projects/:pId/issues` | POST | `handleCreateIssue` | Required | Create a new issue in this project |
| `/projects/:pId/issues/:id` | GET | `handleGetIssue` | Required | Get issue details |
| `/projects/:pId/issues/:id` | PUT | `handlePutIssue` | Required | Update issue (non-archived only) |
| `/projects/:pId/issues/:id` | DELETE | `handleDeleteIssue` | Admin | Delete issue |
| `/projects/:pId/issues/:id/archive` | POST | `handleArchiveIssue` | Admin | Archive an issue |
| `/projects/:pId/issues/:id/unarchive` | POST | `handleUnarchiveIssue` | Admin | Unarchive an issue (moves to Done) |
| `/tasks` | POST | `handleCreateTask` | Required | Create task (IssueID in body) |
| `/tasks/:id` | PUT | `handlePutTask` | Required | Update task |
| `/tasks/:id` | DELETE | `handleDeleteTask` | Required | Delete task |
| `/projects/:pId/labels` | GET | `handleListLabels` | Required | List labels for a project |
| `/projects/:pId/labels` | POST | `handleCreateLabel` | Admin | Create label for a project |
| `/projects/:pId/labels/:id` | DELETE | `handleDeleteLabel` | Admin | Delete label from a project |
| `/projects` | GET | `handleListProjects` | Required | List all projects |
| `/projects` | POST | `handleCreateProject` | Sysadmin | Create project |
| `/projects/:pId` | PUT | `handleUpdateProject` | Sysadmin | Update project |
| `/projects/:pId` | DELETE | `handleDeleteProject` | Sysadmin | Delete project |
| `/projects/:pId/statusconfig` | GET | `handleGetStatusConfig` | Required | Get board column configuration for a project |
| `/projects/:pId/statusconfig` | PUT | `handleUpdateStatusConfig` | Admin | Update board column configuration for a project |
| `/projects/:pId/releases` | GET | `handleListReleases` | Required | List releases for a project |
| `/projects/:pId/releases` | POST | `handleCreateRelease` | Admin | Create a release for a project |
| `/projects/:pId/releases/:id` | GET | `handleGetRelease` | Required | Get release details |
| `/projects/:pId/releases/:id` | PUT | `handlePutRelease` | Admin | Update a release |
| `/projects/:pId/releases/:id` | DELETE | `handleDeleteRelease` | Admin | Delete a release |
| `/projects/:pId/releases/:id/release` | POST | `handleTriggerRelease` | Admin | Publish (close) a release |
| `/projects/:pId/releases/:id/reopen` | POST | `handleReopenRelease` | Admin | Reopen a closed release |
| `/version` | GET | `Anonymous Func` | Public | Get app version |

Resources looked up by `{id}` under `/projects/:pId/` are verified to belong to the named project — a request for an issue/release in another project returns `404`.

**Legend:**
- **Public**: No authentication required
- **Required**: Valid access token required (any authenticated user)
- **Admin**: Valid access token required with admin or sysadmin role
- **Sysadmin**: Valid access token required with sysadmin role
- **Refresh Token**: Valid refresh token required (for token renewal)

## Authentication & Users

### Login
Authenticates a user and sets HTTPOnly cookies for access and refresh tokens.
- **POST** `/auth/login`
- **Body**:
  ```json
  {
    "email": "admin@local",
    "password": "YourPassword123!"
  }
  ```
- **Response**: User object with role and active status
- **Errors**:
  - `401 Unauthorized` - Invalid credentials or inactive account

### Logout
Clears authentication cookies.
- **POST** `/auth/logout`
- **Response**: `204 No Content`

### Refresh Token
Refreshes the access token using the refresh token cookie.
- **POST** `/auth/refresh`
- **Response**: Sets new access token cookie
- **Errors**:
  - `401 Unauthorized` - Invalid or expired refresh token, or inactive user

### Get Current User
Retrieves the authenticated user's details.
- **GET** `/auth/me`
- **Response**: User object
- **Errors**:
  - `401 Unauthorized` - Not authenticated

### Change Own Password
Allows the authenticated user to change their own password. All existing sessions are revoked on success.
- **PUT** `/auth/me`
- **Body**:
  ```json
  {
    "password": "NewSecurePass123!",
    "current_password": "OldPassword123!"
  }
  ```
- **Notes**:
  - `current_password` is required when `password` is provided — prevents session-hijacking attacks
  - On success, all sessions for the user are revoked and the user is logged out
- **Response**: Updated user object
- **Errors**:
  - `400 Bad Request` - Password policy violation or `current_password` missing/incorrect
  - `401 Unauthorized` - Not authenticated

### List Users
Retrieves all users. Accessible to all authenticated users.
- **GET** `/users`
- **Response**: Array of user objects
- **Errors**:
  - `401 Unauthorized` - Not authenticated

### Create User
Creates a new user (Sysadmin only).
- **POST** `/users`
- **Body**:
  ```json
  {
    "email": "user@example.com",
    "first_name": "John",
    "last_name": "Doe",
    "password": "SecurePass123!",
    "role": "user",
    "active": true
  }
  ```
- **Response**: Created user object
- **Errors**:
  - `400 Bad Request` - Validation failed (password policy, invalid email, etc.)
  - `409 Conflict` - Email already exists
  - `401 Unauthorized` - Not authenticated
  - `403 Forbidden` - Not a sysadmin

### Get User
Retrieves a specific user by ID. Accessible to all authenticated users.
- **GET** `/users/:id`
- **Response**: User object
- **Errors**:
  - `404 Not Found` - User doesn't exist
  - `401 Unauthorized` - Not authenticated

### Update User
Updates an existing user (Sysadmin only).
- **PUT** `/users/:id`
- **Body**:
  ```json
  {
    "email": "updated@example.com",
    "first_name": "Jane",
    "last_name": "Smith",
    "password": "NewSecurePass123!",
    "admin_password": "YourOwnPassword123!",
    "role": "admin",
    "active": false
  }
  ```
- **Notes**:
  - `password` is optional; leave empty to keep current password
  - `admin_password` is required when `password` is non-empty **or** when the role is being promoted (`user→admin`, `user→sysadmin`, `admin→sysadmin`) — the requesting sysadmin must confirm their own current password to authorise the change
  - Cannot deactivate or demote the last active sysadmin
- **Response**: Updated user object
- **Errors**:
  - `400 Bad Request` - Validation failed, trying to deactivate last sysadmin, or `admin_password` missing/incorrect
  - `404 Not Found` - User doesn't exist
  - `409 Conflict` - Email already in use
  - `401 Unauthorized` - Not authenticated
  - `403 Forbidden` - Not a sysadmin

## Issues

### Get Active Issues for a Project
Retrieves issues with status *Todo, Stage1, Stage2, Stage3, Stage4, or Done* for a specific project (board issues). Excludes *Open* and *Archive* statuses. Includes associated tasks.
- **GET** `/projects/:id/issues/active`
- **Errors**:
  - `404 Not Found` - Project doesn't exist

### Get Open Issues for a Project
Retrieves issues with status *Open* (backlog items) for a specific project. Loaded lazily when the Backlog view is first opened. Includes associated tasks.
- **GET** `/projects/:id/issues/open`
- **Errors**:
  - `404 Not Found` - Project doesn't exist

### Get Archived Issues for a Project
Retrieves issues with status *Archive* for a specific project. Loaded lazily when the Archive view is first opened. Includes associated tasks.
- **GET** `/projects/:id/issues/archived`
- **Errors**:
  - `404 Not Found` - Project doesn't exist

### Create Issue
Creates a new issue in the named project. The URL's `pId` is the source of truth — any `project_id` field in the body is overridden.
- **POST** `/projects/:pId/issues`
- **Body**:
  ```json
  {
    "title": "Issue Title",
    "description": "Optional Markdown content",
    "status": "Open", // Open, Todo, Stage1, Stage2, Stage3, Stage4, Done, Archive
    "priority": "Normal", // Normal, High
    "label_id": 1 // Optional
  }
  ```

### Get Issue Details
Retrieves a specific issue by ID. Returns `404` if the issue belongs to a different project than `:pId`.
- **GET** `/projects/:pId/issues/:id`

### Update Issue
Updates an existing issue. Returns `404` if the issue belongs to a different project than `:pId`.
- **PUT** `/projects/:pId/issues/:id`
- **Body**: Partial issue object (e.g., `{"status": "Done"}`)
- **Notes**:
  - Archived issues are read-only — `PUT` returns `403 Forbidden`
  - Setting `status` to `Archive` via `PUT` returns `400 Bad Request`; use `POST /projects/:pId/issues/:id/archive` instead
  - Supports optimistic locking via `If-Match` / `ETag` headers
  - The project assignment is pinned by the URL; `project_id` in the body is ignored

### Delete Issue
Deletes an issue and its associated tasks (Admin or Sysadmin).
- **DELETE** `/projects/:pId/issues/:id`
- **Errors**:
  - `403 Forbidden` - Not an admin or sysadmin, or issue is archived
  - `404 Not Found` - Issue doesn't exist in this project

### Archive Issue
Moves an issue to the Archive status (Admin or Sysadmin).
- **POST** `/projects/:pId/issues/:id/archive`
- **Body**: None
- **Response**: Updated issue object
- **Errors**:
  - `400 Bad Request` - Issue is already archived
  - `403 Forbidden` - Not an admin or sysadmin
  - `404 Not Found` - Issue doesn't exist in this project

### Unarchive Issue
Moves an archived issue back to Done status (Admin or Sysadmin).
- **POST** `/projects/:pId/issues/:id/unarchive`
- **Body**: None
- **Response**: Updated issue object
- **Errors**:
  - `400 Bad Request` - Issue is not archived
  - `403 Forbidden` - Not an admin or sysadmin
  - `404 Not Found` - Issue doesn't exist in this project

## Tasks

### Create Task
Adds a task to a specific issue.
- **POST** `/tasks`
- **Body**:
  ```json
  {
    "issue_id": 1,
    "title": "Task Title",
    "description": "Optional Markdown content"
  }
  ```

### Update Task
Updates a task (e.g., toggle done status, change title).
- **PUT** `/tasks/:id`
- **Body**:
  ```json
  {
    "title": "Updated Title",
    "done": true
  }
  ```

### Delete Task
Deletes a task.
- **DELETE** `/tasks/:id`

## Labels

Labels are scoped to a project. All label endpoints are nested under `/projects/:id/`.

### List Labels for a Project
Retrieves all labels belonging to a specific project. Accessible to all authenticated users.
- **GET** `/projects/:id/labels`
- **Errors**:
  - `404 Not Found` - Project doesn't exist

### Create Label for a Project
Creates a new label within a project (Admin or Sysadmin).
- **POST** `/projects/:id/labels`
- **Body**:
  ```json
  {
    "name": "Bug",
    "color": "#ff0000"
  }
  ```
- **Notes**:
  - `name` is required, max 15 characters
  - `color` must be a valid hex color (`#rrggbb`)
- **Response**: Created label object (201 Created)
- **Errors**:
  - `400 Bad Request` - Validation failed
  - `403 Forbidden` - Not an admin or sysadmin
  - `404 Not Found` - Project doesn't exist

### Delete Label from a Project
Deletes a label from a project (Admin or Sysadmin).
- **DELETE** `/projects/:id/labels/:lid`
- **Errors**:
  - `403 Forbidden` - Not an admin or sysadmin
  - `404 Not Found` - Project or label doesn't exist

## Projects

### List Projects
Retrieves all projects. Accessible to all authenticated users.
- **GET** `/projects`
- **Response**: Array of project objects

### Create Project
Creates a new project (Sysadmin only).
- **POST** `/projects`
- **Body**:
  ```json
  {
    "name": "Backend",
    "description": "Optional description"
  }
  ```
- **Notes**:
  - `name` is required, max 15 characters, stored as lowercase
  - `description` is optional, max 100 characters
- **Response**: Created project object (201 Created)
- **Errors**:
  - `400 Bad Request` - Validation failed
  - `401 Unauthorized` - Not authenticated
  - `403 Forbidden` - Not a sysadmin
  - `409 Conflict` - Project name already exists

### Update Project
Updates an existing project (Sysadmin only).
- **PUT** `/projects/:id`
- **Body**:
  ```json
  {
    "name": "Renamed Project",
    "description": "Updated description"
  }
  ```
- **Response**: Updated project object
- **Errors**:
  - `400 Bad Request` - Validation failed
  - `401 Unauthorized` - Not authenticated
  - `403 Forbidden` - Not a sysadmin
  - `404 Not Found` - Project doesn't exist
  - `409 Conflict` - Project name already exists

### Delete Project
Deletes a project (Sysadmin only).
- **DELETE** `/projects/:id`
- **Response**: `200 OK` with confirmation message
- **Errors**:
  - `400 Bad Request` - Cannot delete the default project (id=1) or project still has assigned issues
  - `401 Unauthorized` - Not authenticated
  - `403 Forbidden` - Not a sysadmin
  - `404 Not Found` - Project doesn't exist

## Status Config

Board column names are stored per project in a `StatusConfig` object. The four middle slots (`Stage1`–`Stage4`) have configurable display names; `Todo` and `Done` are fixed. An empty name means the column is hidden on the board.

### Get Status Config
Retrieves the board column configuration for a project. Accessible to all authenticated users.
- **GET** `/projects/:id/statusconfig`
- **Response**:
  ```json
  {
    "project_id": 1,
    "stage1_name": "Pending",
    "stage2_name": "Working",
    "stage3_name": "",
    "stage4_name": ""
  }
  ```
- **Errors**:
  - `404 Not Found` - Project doesn't exist

### Update Status Config
Updates the board column configuration for a project (Admin or Sysadmin).
- **PUT** `/projects/:id/statusconfig`
- **Body**:
  ```json
  {
    "stage1_name": "Review",
    "stage2_name": "Working",
    "stage3_name": "QA",
    "stage4_name": ""
  }
  ```
- **Notes**:
  - Each name must contain only letters and digits, max 15 characters
  - Empty string deactivates (hides) that column; existing issues with that status are preserved but hidden
- **Response**: Updated `StatusConfig` object
- **Errors**:
  - `400 Bad Request` - Validation failed (invalid characters or name too long)
  - `403 Forbidden` - Not an admin or sysadmin
  - `404 Not Found` - Project doesn't exist

## Releases

Releases group issues into a named, time-boxed delivery. Each release belongs to exactly one project and has a lifecycle: *open* → *closed* (published). Releases are scoped to a project; list and get endpoints are accessible to all authenticated users; create, update, delete, and trigger actions require Admin or Sysadmin role.

### List Releases for a Project
Retrieves all releases for a project, ordered by creation date.
- **GET** `/projects/:id/releases`
- **Response**: Array of release objects (including embedded `owner` user if set)
- **Errors**:
  - `404 Not Found` - Project doesn't exist

### Create Release
Creates a new release within a project (Admin or Sysadmin).
- **POST** `/projects/:id/releases`
- **Body**:
  ```json
  {
    "name": "v1.0",
    "description": "First stable release",
    "start_date": "2026-01-01T00:00:00Z",
    "release_date": "2026-03-31T00:00:00Z",
    "owner_id": 2
  }
  ```
- **Notes**:
  - `name` is required, max 20 characters
  - `description` is optional, max 200 characters, plain text (no HTML)
  - `start_date` and `release_date` are optional ISO 8601 timestamps; year must be between 2000 and 2100
  - `release_date` must not be before `start_date` if both are provided
  - `owner_id` is optional; references a user
- **Response**: Created release object (201 Created)
- **Errors**:
  - `400 Bad Request` - Validation failed
  - `403 Forbidden` - Not an admin or sysadmin
  - `404 Not Found` - Project doesn't exist
  - `409 Conflict` - Release name already exists in this project

### Get Release
Retrieves a specific release by ID. Returns `404` if the release belongs to a different project than `:pId`.
- **GET** `/projects/:pId/releases/:id`
- **Response**: Release object (including embedded `owner` user if set)
- **Errors**:
  - `404 Not Found` - Release doesn't exist in this project

### Update Release
Updates an existing open release (Admin or Sysadmin). Closed releases are read-only.
- **PUT** `/projects/:pId/releases/:id`
- **Body**: Same fields as Create Release
- **Errors**:
  - `400 Bad Request` - Validation failed
  - `403 Forbidden` - Not an admin or sysadmin, or release is closed
  - `404 Not Found` - Release doesn't exist in this project
  - `409 Conflict` - Release name already exists in this project

### Delete Release
Deletes a release (Admin or Sysadmin). Issues previously assigned to the release are unlinked but not deleted.
- **DELETE** `/projects/:pId/releases/:id`
- **Errors**:
  - `403 Forbidden` - Not an admin or sysadmin
  - `404 Not Found` - Release doesn't exist in this project

### Publish (Close) Release
Closes an open release and archives all issues assigned to it that are in Done status (Admin or Sysadmin).
- **POST** `/projects/:pId/releases/:id/release`
- **Response**: Updated release object
- **Errors**:
  - `400 Bad Request` - Release is already closed
  - `403 Forbidden` - Not an admin or sysadmin
  - `404 Not Found` - Release doesn't exist in this project

### Reopen Release
Reopens a closed release (Admin or Sysadmin). Issues that were archived when the release was closed are **not** automatically unarchived.
- **POST** `/projects/:pId/releases/:id/reopen`
- **Response**: Updated release object
- **Errors**:
  - `400 Bad Request` - Release is not closed
  - `403 Forbidden` - Not an admin or sysadmin
  - `404 Not Found` - Release doesn't exist in this project

## System

### Get Version
Retrieves the current application version.
- **GET** `/version`
