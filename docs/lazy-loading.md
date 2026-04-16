# Lazy Loading Data Strategy

To optimize performance and reduce server load, not all issues are loaded at once.

Issues are split into three project-scoped API endpoints:
1.  **`/api/projects/{projectId}/issues/active`**: Fetches issues for the selected project with statuses *Todo, Pending, Working, Done* (excludes *Open* and *Archive*).
2.  **`/api/projects/{projectId}/issues/open`**: Fetches only issues with status *Open* for the selected project.
3.  **`/api/projects/{projectId}/issues/archived`**: Fetches only issues with status *Archive* for the selected project.

The application initializes by fetching **only active issues**. Open and archived issues are loaded lazily:

-   **Initial Load**: `refreshApp()` fetches active issues (Todo, Pending, Working, Done). Open and archived issues are **not** fetched unless their respective views are currently visible.
-   **View Switch to Backlog**: When switching to the Backlog tab, the app checks if open issues are loaded. If not (or if marked dirty), it fetches from `/api/projects/{projectId}/issues/open` and merges the results into the issue state.
-   **View Switch to Archive**: When switching to the Archive tab, the app checks if archived data is loaded. If not (or if marked dirty), it fetches from `/api/projects/{projectId}/issues/archived` and merges the results into the issue state.
-   **Refresh**: Triggering a full app refresh (e.g., after an update) marks both open and archived data as "dirty" (needing refresh) but **does not** immediately fetch them unless the corresponding view is active. This ensures that background refreshes do not trigger unnecessary heavy payloads.

**Rationale for splitting Open issues:** The Board view already excludes *Open* issues client-side (they are only shown in the Backlog). Backlogs tend to accumulate many items over time, making them a prime candidate for deferral. The lazy-load flag `openLoaded` (in `backlog.js`) mirrors the `archivedLoaded` flag (in `archive.js`) and follows the same merge-on-first-visit pattern.
