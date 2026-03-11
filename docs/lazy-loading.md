# Lazy Loading Data Strategy

To optimize performance and reduce server load, not all issues are loaded at once.

Issues are split into two API endpoints:
1.  **`/api/issues/active`**: Fetches all issues *except* those with status 'Archive'.
2.  **`/api/issues/archived`**: Fetches only issues with status 'Archive'.

The application initializes by fetching **only active issues**. Archived issues are loaded lazily:

-   **Initial Load**: `refreshApp()` fetches active issues. It **skips** fetching archived issues unless the Archive view is currently visible.
-   **View Switch**: When switching to the Archive tab, the app checks if archived data is loaded. If not (or if marked dirty), it fetches from `/api/issues/archived`.
-   **Refresh**: Triggering a full app refresh (e.g., after an update) marks the archived data as "dirty" (needing refresh) but **does not** immediately fetch it unless the Archive view is active. This ensures that background refreshes do not trigger unnecessary heavy payloads.

This is an initial simple solution and will be improved when there is more feedback regarding loading times and performance. Maybe we will use pagination or exclude issues with status OPEN from the active issues endpoint too.
