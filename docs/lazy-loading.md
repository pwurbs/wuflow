# Lazy Loading Data Strategy

To optimize performance and reduce server load, not all issues are loaded at once.

Issues are split into three project-scoped API endpoints:
1.  **`/api/projects/{projectId}/issues/active`**: Fetches issues for the selected project with statuses *Todo, Pending, Working, Done* (excludes *Open* and *Archive*).
2.  **`/api/projects/{projectId}/issues/open`**: Fetches only issues with status *Open* for the selected project.
3.  **`/api/projects/{projectId}/issues/archived`**: Fetches only issues with status *Archive* for the selected project.

The application initializes by fetching **only active issues**. Open and archived issues are loaded lazily, only by the views that show them: the Backlog needs the open issues, the Archive the archived ones, and the Releases view both (release progress counts every issue of the project).

All three views share one cache (`static/js/issue-lists.js`). Every list it loads is merged into the client-side issue state, so a list is fetched at most once per refresh, whichever view asks for it first:

-   **Refresh**: `refreshApp()` (initial load, view switch to Board/Backlog/Archive, closing the issue modal, project switch) reloads the active issues and drops the cached open/archived lists. The lists the currently visible view needs are fetched **in the same parallel wave** as the active issues, the status config, labels, releases, users and projects. Lists of views that are not visible are **not** fetched, so background refreshes do not trigger unnecessary heavy payloads.
-   **View Switch to Backlog / Archive**: these views trigger a refresh, which already includes their list.
-   **View Switch to Releases**: does not trigger a refresh. It fetches only the lists that are not cached yet (e.g. only the archived issues when coming from the Backlog) and costs no request at all when both are cached.
-   **Concurrent requests**: a view that asks for a list while it is still being fetched (e.g. switching to Releases while a refresh is in flight) joins that request instead of fetching the list again.
-   **Release delete / trigger**: these change issues server-side (release assignment cleared, Done issues archived), so the Releases view reloads the active, open and archived issues in one parallel wave.

**Rationale for splitting Open issues:** The Board view already excludes *Open* issues client-side (they are only shown in the Backlog). Backlogs tend to accumulate many items over time, making them a prime candidate for deferral.

**Why one parallel wave:** the server answers these requests in a few milliseconds, so on slow or mobile connections the cost is the number of *sequential* round trips, each of which can take hundreds of milliseconds. Over HTTP/1.1 (no HTTP/2 reverse proxy in front of wuFlow) browsers open at most 6 connections per server, so requests beyond the sixth in a wave wait for a free connection. See the [Reverse Proxy section](../README.md#reverse-proxy) on enabling HTTP/2.
