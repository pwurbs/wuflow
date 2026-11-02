# Frontend

## Overview

The frontend is TypeScript (ES modules) and CSS, without a UI framework. It consists of two pages:

| Page | Source | Script entry point | Styles |
|------|--------|--------------------|--------|
| Login | `static/login.html` | `static/js/login.ts` | `static/styles/pages/login.css` and the shared base styles |
| App | `static/index.html` | `static/js/app.ts` | `static/styles/main.css`, which imports all style files of the app (see [Style Structure](#style-structure)) |

The only libraries shipped to the browser are marked and DOMPurify (npm packages, pinned in `static/js/package-lock.json`), used to render Markdown safely (see [markdown-security.md](./markdown-security.md)).

Scripts and styles are split into many small files to organize the source code. Vite bundles each page into one script and one stylesheet (see [Build](#build)), so the number of source files costs nothing at runtime.

### Module Structure

Each file in `static/js/` is an ES module. Paths relative to `static/js/`:

- **`app.ts`**: Entry point of the app page: loads the data, sets up the views and refreshes them
- **`login.ts`**: Entry point of the login page
- **`components/`**: One module per view or UI part: Board, Backlog, Archive, Releases, planning panel, system and project settings, issue modal (with `tasks.ts`, `activity.ts`, `editor-toolbar.ts`, `issue-dropdowns.ts` and `planned-dates.ts`), card, toolbar
- **`state.ts`**: Core client-side state management
- **`models.ts`**: Types of the API resources (issue, release, user, …); mirror of the structs in `backend/models.go`
- **`issue-lists.ts`**: Shared cache that loads the open/archived issue lists on demand and merges them into the issue state (see [Data Loading](#data-loading))
- **`api.ts`**: Backend API interaction, with the types of the request bodies
- **`session.ts`**: Re-login dialog, session check on return to the tab, connection banner
- **`filters.ts`**: Pure functions for filtering and sorting issues (extracted for testability)
- **`list-utils.ts`**: List actions shared by Board, Backlog and Archive (move to top/bottom, priority, assign to me, saving the order after drag and drop)
- **`drag.ts`**: Shared drag state for cards and tasks, drop position calculation
- **`context-menu.ts`**: Context menu of the cards
- **`permissions.ts`**: Mirror of the backend policy, used only to show or hide UI elements (the backend enforces authorization)
- **`status-config.ts`**: Status constants and accessors for the configurable board columns
- **`domain-constants.ts`**, **`validation-config.ts`**: Mirrors of backend constants (priorities, release statuses, roles, default project ID, input limits); keep them in sync with the backend
- **`markdown.ts`**: Markdown rendering with marked and DOMPurify (npm packages, bundled by Vite)
- **`utils.ts`**: Helper functions (HTML escaping, notifications, confirm dialogs, character counters, etc.)
- **`tests/`**: Vitest unit tests, one file per module

### Style Structure

The styles in `static/styles/` follow the 7-1 pattern known from Sass, reduced to the five folders the app needs (no `vendors/`, no `themes/`) and written in plain CSS:

| Folder | Contents |
|--------|----------|
| `abstracts/` | `variables.css`: CSS custom properties (colors, sizes); produces no CSS rules |
| `base/` | Reset, typography, utility classes |
| `layout/` | Page frame: layout and sidebar |
| `components/` | Reusable UI parts: buttons, cards, forms, modals, menus, toasts, etc. |
| `pages/` | Styles of a single view: Board, Backlog/Archive, planning panel, Releases, settings, login |

- **Import order**: `main.css` imports all files of the app page, in the order of the table. This order is the cascade order: a page style can adapt a component, not the other way round.
- **Login page**: `login.html` does not use `main.css`. It links only `variables.css`, `reset.css`, `typography.css` and `pages/login.css`.
- **Typography**: font sizes and weights are collected in `base/typography.css`. Before adding them to a component or page file, check whether a selector group there already covers the element.
- **Fonts**: Figtree (text, `--font-sans`) and Gabarito (headings, `--font-display`) are self-hosted in `static/fonts/` under the SIL Open Font License (see `CREDITS.md`), so the browser makes no third-party request. Markdown written by users (description, comments) always uses the text font.
- **Colors**: all colors, including tints and shadows, come from the custom properties in `abstracts/variables.css`. Only label colors are set inline, because users pick them. Blue exists in two variables: `--accent-blue` (text, icons, borders and tints) and `--fill-blue` (fills behind white text, e.g. primary buttons, avatars, ticked checkboxes). Red text uses `--danger-text`, red fills `--danger-color`. White text on a fill uses `--text-on-fill`, and the fills dark enough for it are `--fill-blue`, `--fill-green`, `--fill-red` and `--fill-amber`.

---

## Editing Fields

All inline editors of the issue modal follow one behaviour:

| Editor | Enter | Cmd/Ctrl+Enter | Escape / ✕ | Tab | Done with unsaved text |
|--------|-------|----------------|------------|-----|------------------------|
| Title, task title | Saves | Saves | Discards | Saves (on blur) | Saves |
| Description | Continues a list | Saves | Discards, asks "Discard changes?" if changed | Indents | Asks "Save description?" |
| New comment, comment edit | Continues a list | Saves | Discards, asks "Discard changes?" if changed | Moves focus | Asks "Save comment?" |
| New task | Adds the task | Adds the task | – | Moves focus | Asks "Add task?" |

- **Buttons**: ✓ and ✕ react to `click`. The Markdown toolbar buttons block `mousedown`, so the text selection stays in the editor.
- **Saving**: while a save is in flight, the field's frame, including its ✓ and ✕, is dimmed, shows the normal border instead of the blue edit border, cannot be clicked, and ignores typing and keys other than Tab. Modal forms (new issue, release, project, user, password) are dimmed as a whole. `markBusy` in `utils.ts` does this by setting `aria-busy="true"` on the field, and `guardSubmit` / `onGuardedSubmit` use it so that a second click or Enter during the save does nothing.
- **Sidebar fields** of the issue modal (status, planned dates, deadline, assignee, priority, label, release) save on change. The changed field, label included, is dimmed until its save is done. The other fields stay usable, and further changes are saved one after another.
- **Inactive means greyed out, greyed out means inactive**: everything that cannot be used right now is shown at `--inactive-opacity`, and nothing else is. One rule in `base/utilities.css` styles the three markers: `:disabled` (native controls), `[aria-disabled="true"]` (other elements, also not clickable) and `[aria-busy="true"]` (saving). An archived issue is greyed out as a whole: title, description, comments, dropdowns and dates. Links in greyed-out text still open.
- **Leaving the page**: while any editor holds unsaved text, the browser asks before a reload or navigation (`beforeunload`).

---

## Build

Vite (`static/js/vite.config.ts`) bundles both pages for production:

- **One script and one stylesheet per page.** Images, favicons and fonts are copied. All files go to `static/dist/app/assets/` with a content hash in their name (e.g. `index-yqFe3kfx.js`), and the built HTML pages reference these names.
- **Why**: unbundled, the first load of the app took about 60 requests, which dominated the load time on slow connections. The content hashes make long-term caching safe without versioning code of our own (see [Delivery](#delivery)).
- **License comments** of the bundled libraries are kept. The modulepreload polyfill is disabled, because every current browser supports modulepreload natively.

The Go binary embeds the build output (`//go:embed all:static/dist` in `main.go`), not the source files in `static/`. `static/dist/app` is not committed; the committed placeholder `static/dist/README.md` keeps `go:embed` valid before the first build. Without a build, the server refuses to start ("Frontend not built").

The build runs before every start of the app: in the "Run locally" task, the Playwright global setup, the Dockerfile (Node.js stage) and `scripts/run_wapiti_scan.sh`. The commands are listed in [static/js/README.md](../static/js/README.md).

### Type Checking

Vite removes the types when it builds and does not check them, so `npm run build` first checks the app with `tsc -p tsconfig.app.json`: a type error in the app stops every build, the image build included. `npm run typecheck` (`tsc -b`) checks all three configs below, the tests included, as one of the required test suites. `static/js/tsconfig.json` only references one config per environment:

| Config | Files | Environment |
|--------|-------|-------------|
| `tsconfig.app.json` | the modules in `static/js/` and `components/` | browser (DOM types) |
| `tsconfig.test.json` | `tests/` | like the app, plus Node types and `Promise.withResolvers` (ES2024) |
| `tsconfig.node.json` | `vite.config.ts`, `vitest.config.ts` | Node |

`noImplicitAny` is on for the app and the tests, so every parameter needs a type. `strictNullChecks` is on for the app and the tests, so a value that can be `null` or `undefined` must be checked before it is used. The other `strict` checks are off for now. Constants such as statuses and roles are declared `as const`, and their union types (`IssueStatus`, `Role`, `Priority`, …) are derived from them, so each value has one source.

Where the types live:

- **API resources** (issue, release, user, …) in `models.ts`, as the backend sends them. An object embedded in another one is only partly filled, so it has its own type: `UserRef` (assignee, owner, comment author), `LabelRef` and `ReleaseRef` (label and release of an issue).
- **Request bodies** (`IssueWrite`, `UserWrite`, …) in `api.ts`, next to the functions that send them.
- **Client state and filters** (`State`, `Filter`) in `state.ts`.

Elements that are always on the page are read with `byId(id, HTMLInputElement)` or `bySelector(root, selector, HTMLInputElement)` from `utils.ts` (the type defaults to `HTMLElement`) instead of a cast or a null check: they return the element typed and throw if it is missing or has another type. The types are gone once the code is built, so this check is the one that still runs in the browser: a cast only silences the compiler, and a wrong id or a changed element would go unnoticed until a property is missing. An element that may be missing is read with `document.getElementById` and checked with `?.`, or with `instanceof` where a specific type is needed. Data from the server is not checked against its types at runtime. The backend validates everything it receives. Imports name the `.ts` file (`import { state } from './state.ts'`).

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

All three views share one cache (`static/js/issue-lists.ts`). Every list it loads is merged into the client-side issue state, so a list is fetched at most once per refresh, whichever view asks for it first:

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
- [Testing → Frontend Unit Testing](./testing.md#frontend-unit-testing): Vitest unit tests
