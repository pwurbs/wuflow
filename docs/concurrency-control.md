# Concurrency Control (Optimistic Locking)

To ensure data integrity when multiple users edit the same issue simultaneously, we implement optimistic locking using HTTP `ETag` and `If-Match` headers.

## Overview

When the frontend loads an issue, it receives a version identifier (ETag). When saving changes, it sends this ETag back to the server. The server compares the received ETag with the current version in the database:

1.  **Match**: The update proceeds, and a new ETag is generated.
2.  **Mismatch**: The server rejects the update with a `409 Conflict` error, indicating the data has changed since it was loaded.

## Flow Diagram

The following diagram illustrates the interaction between the User, the Modal component, and the Backend API:

```mermaid
sequenceDiagram
    participant User as User
    participant Modal as Modal
    participant API as Backend

    User->>Modal: Click issue
    Modal->>Modal: Display issue from board data
    Modal->>API: GET /api/issues/{id} (background)
    API-->>Modal: Issue + ETag "v1"
    alt Unchanged since board load
        Modal->>Modal: Store ETag
    else Newer on server
        Modal->>Modal: Store ETag, re-render (or force conflict if user is editing)
    end
    User->>Modal: Make changes
    Modal->>API: PUT (If-Match: "v1")
    alt No Conflict
        API-->>Modal: 200 + new ETag
        Modal->>Modal: Update stored ETag
    else Conflict (409)
        API-->>Modal: 409 Conflict
        Modal->>User: Show conflict dialog
        User->>Modal: Reload
        Modal->>API: GET fresh data
    end
```

## Implementation Details

### Backend
-   **GET /api/issues/{id}**: Returns the issue JSON and sets the `ETag` header based on the `updated_at` timestamp.
-   **PUT /api/issues/{id}**: Checks the `If-Match` header against the current issue's ETag. Returns `409 Conflict` if they do not match.

> **Proxy note:** Reverse proxies such as Traefik may convert strong ETags to weak ETags (e.g. `"v1"` → `W/"v1"`) when applying response transformations. The server normalises the comparison by stripping the `W/` prefix so that proxy-induced weakening does not produce false conflicts.

### Frontend
-   **Fetching**: `openModal` renders the issue immediately from the already loaded board data (list endpoints return the same shape as `GET /issues/{id}`) and revalidates in the background (`revalidateIssue`) to obtain the `ETag`:
    -   **Unchanged** (`updated_at` matches): only the `ETag` is stored.
    -   **Newer on server, user not editing**: the modal re-renders with the server copy and stores its `ETag`.
    -   **Newer on server, user already editing**: the input is kept and a never-matching `ETag` is stored, so the first save returns `409` and shows the conflict dialog.
-   **Saving**: The `saveIssueWithConflictCheck` helper sends the `If-Match` header. It first waits for a pending revalidation (`etagForSave`), so a save never goes out without an `ETag`. If the revalidation replaced the issue while the save was waiting, the save's data is outdated and is sent with the never-matching `ETag` as well. If a 409 error occurs, it displays a conflict resolution dialog to the user, allowing them to reload the data.

## Drag-and-Drop Operations

Drag-and-drop operations (board columns, backlog reordering, planning panel) use **last-write-wins** conflict resolution and do **not** use ETag-based optimistic locking.

### Rationale

This approach is acceptable because:
- Concurrent drag conflicts are **rare** in typical usage
- Backend handles it gracefully (last write wins)
- Modal edits already have robust conflict handling for critical changes
- Drags are "quick actions" where last-write-wins is acceptable
- Each user's view auto-refreshes after their drag, reducing stale data window

### Asymmetric Protection

**Important:** Modal edits ARE protected from drag operations:
- If User A opens modal (gets ETag) and User B drags the same issue (updates `updated_at`), then User A saves → **409 Conflict** detected
- User A sees conflict dialog and can reload

This asymmetry is intentional - modal edits represent "careful, intentional changes" and warrant conflict protection, while drags represent "quick reorganization" where last-write-wins is acceptable.
