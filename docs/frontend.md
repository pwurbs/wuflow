# Frontend

## Overview

The frontend is plain JavaScript (ES modules) and CSS, without a UI framework. It consists of two pages:

| Page | Source | Script entry point | Styles |
|------|--------|--------------------|--------|
| Login | `static/login.html` | `static/js/login.js` | `static/styles/pages/login.css` and the shared base styles |
| App | `static/index.html` | `static/js/app.js` | `static/styles/main.css`, which imports all other style files |

The only libraries shipped to the browser are marked and DOMPurify (npm packages, pinned in `static/js/package-lock.json`), used to render Markdown safely (see [markdown-security.md](./markdown-security.md)).

### Module Structure

Paths relative to `static/js/`:

- **`components/`**: UI components (Board, Backlog, etc.)
- **`tests/`**: Unit test files (collocated with logic where possible, or in this folder)
- **`filters.js`**: Pure functions for filtering and sorting issues (extracted for testability)
- **`state.js`**: Core client-side state management
- **`issue-lists.js`**: Shared cache that loads the open/archived issue lists on demand and merges them into the issue state (see [Data Loading](#data-loading))
- **`utils.js`**: Helper functions (HTML escaping, debouncing, etc.)
- **`api.js`**: Backend API interaction
- **`session.js`**: Re-login dialog, session check on return to the tab, connection banner
- **`markdown.js`**: Markdown rendering with marked and DOMPurify (npm packages, bundled by Vite)

---

## Build

Vite (`static/js/vite.config.js`) bundles both pages for production:

- **One script and one stylesheet per page.** Images and favicons are copied. All files go to `static/dist/app/assets/` with a content hash in their name (e.g. `index-yqFe3kfx.js`), and the built HTML pages reference these names.
- **Why**: unbundled, the first load of the app took about 60 requests, which dominated the load time on slow connections. The content hashes make long-term caching safe without versioning code of our own (see [Delivery](#delivery)).
- **License comments** of the bundled libraries are kept. The modulepreload polyfill is disabled, because every current browser supports modulepreload natively.

The Go binary embeds the build output (`//go:embed all:static/dist` in `main.go`), not the source files in `static/`. `static/dist/app` is not committed; the committed placeholder `static/dist/README.md` keeps `go:embed` valid before the first build. Without a build, the server refuses to start ("Frontend not built").

The build runs before every start of the app: in the "Run locally" task, the Playwright global setup, the Dockerfile (Node.js stage) and `scripts/run_wapiti_scan.sh`. The commands are listed in [static/js/README.md](../static/js/README.md).

---

## Delivery

`registerStaticRoutes` in `backend/server.go` (called by `StartServer`, like `APIMux` for the API routes) serves the build output on three routes:

| Path | Authentication | `Cache-Control` |
|------|----------------|-----------------|
| `/assets/*` — bundled scripts, styles, images, favicons | None | `public, max-age=31536000, immutable` |
| `/login` — login page | None | `no-cache` + `ETag` |
| Everything else, e.g. `/` — the app's `index.html` | Valid session, otherwise `302` to `/login` | `no-cache` + `ETag` |

- **Public assets**: the file names under `/assets/` contain content hashes and change with every build, so they cannot be allowlisted individually. The login page needs some of them before a session exists. They contain only the open-source frontend code, never API data or user content.
- **Separate asset route**: `/assets/` has its own file server, rooted at the `assets` directory of the build (`fs.Sub`). No request path, however encoded (e.g. `/assets/%2e%2e/`), can reach a file outside that directory, such as the app's `index.html`. A literal `..` in the path is redirected by Go's `ServeMux` to the cleaned path, which then goes through the login check.
- **Immutable assets**: a changed file gets a new name, so browsers and CDNs can keep assets for a year without revalidation.
- **Revalidated HTML**: `no-cache` makes browsers check the HTML pages on every load, so after an upgrade they get the new page, and with it the new asset names, at once. The `ETag` is a content hash computed at startup (embedded files have no modification time), so an unchanged page costs only a `304 Not Modified`. For `/`, the session is checked before the `304`.
- **Errors are not cached**: `http.FileServer` removes `Cache-Control` and `ETag` from error responses, e.g. a `404` for an unknown asset.

### Directory Listing Protection

The application uses a `neuteredFileSystem` wrapper for static files. This prevents browsers from listing the contents of directories (e.g., `/assets/`) by returning a 404 error if an `index.html` file is not present in the requested path.

---

## Data Loading

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

**Why one parallel wave:** the server answers these requests in a few milliseconds, so on slow or mobile connections the cost is the number of *sequential* round trips, each of which can take hundreds of milliseconds. With the bundled frontend and compression, HTTP/2 on the reverse proxy makes no measurable difference for these waves.

---

## Related Topics

The frontend parts of these topics are described with the topic itself:

- [Client Security](./client-security.md): authentication cookies, security headers, Content Security Policy
- [Markdown Security](./markdown-security.md): rendering user content with marked and DOMPurify
- [Input Validation → Frontend](./input-validation.md#frontend): escaping and plain-text previews
- [Concurrency Control → Frontend](./concurrency-control.md#frontend): `ETag` handling and conflict dialog in the issue modal
- [User Management → Session Expiry in the Browser](./user-management.md#session-expiry-in-the-browser): re-login dialog and connection errors
- [Testing → Frontend Unit Testing](./testing.md#frontend-unit-testing-plain-js): Vitest unit tests
