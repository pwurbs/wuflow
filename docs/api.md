# wuFlow API Documentation

Base URL: `/api`

## Authentication

All API endpoints except `/api/auth/login` require authentication via HTTPOnly cookies. The server uses JWT tokens with automatic refresh.

## Handler Mapping

| Endpoint | Method | Handler | Auth | Description |
| :--- | :--- | :--- | :--- | :--- |
| `/auth/login` | POST | `HandleLogin` | Public | Authenticate user |
| `/auth/logout` | POST | `HandleLogout` | Public | Clear auth cookies |
| `/auth/refresh` | POST | `HandleRefresh` | Refresh Token | Refresh access token |
| `/auth/me` | GET | `HandleCurrentUser` | Required | Get current user |
| `/users` | GET | `HandleUsers` | Admin | List all users |
| `/users` | POST | `HandleUsers` | Admin | Create new user |
| `/users/:id` | GET | `HandleUser` | Admin | Get user details |
| `/users/:id` | PUT | `HandleUser` | Admin | Update user |
| `/projects/:id/issues/active` | GET | `HandleProject` | Required | Get active issues for a project |
| `/projects/:id/issues/archived` | GET | `HandleProject` | Required | Get archived issues for a project |
| `/issues` | POST | `HandleCreateIssue` | Required | Create a new issue |
| `/issues/:id` | GET | `HandleIssue` | Required | Get issue details |
| `/issues/:id` | PUT | `HandleIssue` | Required | Update issue (non-archived only) |
| `/issues/:id` | DELETE | `HandleIssue` | Admin | Delete issue |
| `/issues/:id/archive` | POST | `HandleIssue` | Admin | Archive an issue |
| `/issues/:id/unarchive` | POST | `HandleIssue` | Admin | Unarchive an issue (moves to Done) |
| `/tasks` | POST | `HandleCreateTask` | Required | Create task (IssueID in body) |
| `/tasks/:id` | PUT | `HandleTask` | Required | Update task |
| `/tasks/:id` | DELETE | `HandleTask` | Required | Delete task |
| `/labels` | GET | `HandleLabels` | Required | Get all labels |
| `/labels` | POST | `HandleLabels` | Admin | Create label |
| `/labels/:id` | DELETE | `HandleLabel` | Admin | Delete label |
| `/projects` | GET | `HandleProjects` | Required | List all projects |
| `/projects` | POST | `HandleProjects` | Admin | Create project |
| `/projects/:id` | PUT | `HandleProject` | Admin | Update project |
| `/projects/:id` | DELETE | `HandleProject` | Admin | Delete project |
| `/version` | GET | `Anonymous Func` | Public | Get app version |

**Legend:**
- **Public**: No authentication required
- **Required**: Valid access token required (any authenticated user)
- **Admin**: Valid access token required with admin role
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

### List Users
Retrieves all users (Admin only).
- **GET** `/users`
- **Response**: Array of user objects
- **Errors**:
  - `401 Unauthorized` - Not authenticated
  - `403 Forbidden` - Not an admin

### Create User
Creates a new user (Admin only).
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
  - `403 Forbidden` - Not an admin

### Get User
Retrieves a specific user by ID (Admin only).
- **GET** `/users/:id`
- **Response**: User object
- **Errors**:
  - `404 Not Found` - User doesn't exist
  - `401 Unauthorized` - Not authenticated
  - `403 Forbidden` - Not an admin

### Update User
Updates an existing user (Admin only).
- **PUT** `/users/:id`
- **Body**:
  ```json
  {
    "email": "updated@example.com",
    "first_name": "Jane",
    "last_name": "Smith",
    "password": "",
    "role": "admin",
    "active": false
  }
  ```
- **Notes**: 
  - Password is optional; leave empty to keep current password
  - Cannot deactivate or demote the last active admin
- **Response**: Updated user object
- **Errors**:
  - `400 Bad Request` - Validation failed or trying to deactivate last admin
  - `404 Not Found` - User doesn't exist
  - `409 Conflict` - Email already in use
  - `401 Unauthorized` - Not authenticated
  - `403 Forbidden` - Not an admin

## Issues

### Get Active Issues for a Project
Retrieves all active issues (status != 'Archive') belonging to a specific project. Includes associated tasks.
- **GET** `/projects/:id/issues/active`
- **Errors**:
  - `404 Not Found` - Project doesn't exist

### Get Archived Issues for a Project
Retrieves all archived issues (status == 'Archive') belonging to a specific project. Includes associated tasks.
- **GET** `/projects/:id/issues/archived`
- **Errors**:
  - `404 Not Found` - Project doesn't exist

### Create Issue
Creates a new issue.
- **POST** `/issues`
- **Body**:
  ```json
  {
    "title": "Issue Title",
    "description": "Optional Markdown content",
    "status": "Open", // Open, Todo, Pending, Working, Done, Archive
    "priority": "Normal", // Normal, High
    "label_id": 1 // Optional
  }
  ```

### Get Issue Details
Retrieves a specific issue by ID.
- **GET** `/issues/:id`

### Update Issue
Updates an existing issue.
- **PUT** `/issues/:id`
- **Body**: Partial issue object (e.g., `{"status": "Done"}`)
- **Notes**:
  - Archived issues are read-only — `PUT` returns `403 Forbidden`
  - Setting `status` to `Archive` via `PUT` returns `400 Bad Request`; use `POST /issues/:id/archive` instead
  - Supports optimistic locking via `If-Match` / `ETag` headers

### Delete Issue
Deletes an issue and its associated tasks (Admin only).
- **DELETE** `/issues/:id`
- **Errors**:
  - `403 Forbidden` - Not an admin, or issue is archived

### Archive Issue
Moves an issue to the Archive status (Admin only).
- **POST** `/issues/:id/archive`
- **Body**: None
- **Response**: Updated issue object
- **Errors**:
  - `400 Bad Request` - Issue is already archived
  - `403 Forbidden` - Not an admin
  - `404 Not Found` - Issue doesn't exist

### Unarchive Issue
Moves an archived issue back to Done status (Admin only).
- **POST** `/issues/:id/unarchive`
- **Body**: None
- **Response**: Updated issue object
- **Errors**:
  - `400 Bad Request` - Issue is not archived
  - `403 Forbidden` - Not an admin
  - `404 Not Found` - Issue doesn't exist

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

### Get All Labels
Retrieves all available labels. Accessible to all authenticated users.
- **GET** `/labels`

### Create Label
Creates a new label (Admin only).
- **POST** `/labels`
- **Body**:
  ```json
  {
    "name": "Bug",
    "color": "#ff0000"
  }
  ```

### Delete Label
Deletes a label (Admin only).
- **DELETE** `/labels/:id`

## Projects

### List Projects
Retrieves all projects. Accessible to all authenticated users.
- **GET** `/projects`
- **Response**: Array of project objects

### Create Project
Creates a new project (Admin only).
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
  - `403 Forbidden` - Not an admin
  - `409 Conflict` - Project name already exists

### Update Project
Updates an existing project (Admin only).
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
  - `403 Forbidden` - Not an admin
  - `404 Not Found` - Project doesn't exist
  - `409 Conflict` - Project name already exists

### Delete Project
Deletes a project (Admin only).
- **DELETE** `/projects/:id`
- **Response**: `200 OK` with confirmation message
- **Errors**:
  - `400 Bad Request` - Cannot delete the default project (id=1) or project still has assigned issues
  - `401 Unauthorized` - Not authenticated
  - `403 Forbidden` - Not an admin
  - `404 Not Found` - Project doesn't exist

## System

### Get Version
Retrieves the current application version.
- **GET** `/version`
