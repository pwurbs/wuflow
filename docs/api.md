# wuFlow API Documentation

Base URL: `/api`

## Handler Mapping

| Endpoint | Method | Handler | Description |
| :--- | :--- | :--- | :--- |
| `/issues/active` | GET | `HandleActiveIssues` | Get all active issues |
| `/issues/archived` | GET | `HandleArchivedIssues` | Get all archived issues |
| `/issues` | POST | `HandleCreateIssue` | Create a new issue |
| `/issues/:id` | GET | `HandleIssue` | Get issue details |
| `/issues/:id` | PUT | `HandleIssue` | Update issue |
| `/issues/:id` | DELETE | `HandleIssue` | Delete issue |
| `/tasks` | POST | `HandleCreateTask` | Create task (IssueID in body) |
| `/tasks/:id` | PUT | `HandleTask` | Update task |
| `/tasks/:id` | DELETE | `HandleTask` | Delete task |
| `/labels` | GET | `HandleLabels` | Get all labels |
| `/labels` | POST | `HandleLabels` | Create label |
| `/labels/:id` | DELETE | `HandleLabel` | Delete label |
| `/version` | GET | `Anonymous Func` | Get app version |

## Issues

### Get Active Issues
Retrieves all active issues (status != 'Archive'). Includes associated tasks.
- **GET** `/issues/active`

### Get Archived Issues
Retrieves all archived issues (status == 'Archive'). Includes associated tasks.
- **GET** `/issues/archived`

### Create Issue
Creates a new issue.
- **POST** `/issues`
- **Body**:
  ```json
  {
    "title": "Issue Title",
    "description": "Optional description",
    "status": "Open", // Open, In Progress, Done, Archive
    "priority": "Medium", // High, Medium, Low
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

### Delete Issue
Deletes an issue and its associated tasks.
- **DELETE** `/issues/:id`

## Tasks

### Create Task
Adds a task to a specific issue.
- **POST** `/tasks`
- **Body**:
  ```json
  {
    "issue_id": 1,
    "title": "Task Title"
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
Retrieves all available labels.
- **GET** `/labels`

### Create Label
Creates a new label.
- **POST** `/labels`
- **Body**:
  ```json
  {
    "name": "Bug",
    "color": "#ff0000"
  }
  ```

### Delete Label
Deletes a label.
- **DELETE** `/labels/:id`

## System

### Get Version
Retrieves the current application version.
- **GET** `/version`
