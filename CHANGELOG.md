
# 1.3.3

- Switched build and runtime base images from Debian to Alpine to reduce container vulnerabilities and image size
- Reduced redundant API calls fired after issue, release, project and filter actions across the app
- Harmonized typography across the app with a shared font-size/weight system, and fixed inconsistent font rendering
- Added a "Confirm New Password" field to the self-service change password dialog to prevent unintended passwords from typos

# 1.3.2

- Added Helm Chart and deploy script
- Now built and pushed a multi-platform image (linux/amd64,linux/arm64)
- Added API health endpoint
- Fixed Refresh Token DoS attack surface
- Fixed the issue when reverse proxies like Traefik manipulate ETags which caused false issue edit conflict detection
- Removed database migration code from v1.2.0 and v.1.3.0 (see migration notes)
- Bumped dompurify to 3.4.11
- Bumped direct Go package dependencies go-sqlite3 and x/crypto
- Bumped vitest and playwright packages
- Fixed: GetClientIP now handles comma-separated X-Forwarded-For headers and updated reverse proxy documentation
- Added last login information to the users list and aligned items in users and projcts list
- Added an admin password legitimation step for a project deletion attempt
- Added an admin password legitimation step when an admin wants to activate or deactive a user
- Added Fable security audit report
- Added a "API Consumers & Trust Boundary" section in markdown-security.md
- Added dedicated favicon files

# 1.3.1

- Bumped Go to 1.25.11
- Bumped direct Go package dependencies go-sqlite3 and x/crypto 
- Bumped dompurify to 3.4.8
- Bumped marked to 18.0.5
- Bumped vitest and playwright packages
- Bumped base image to debian:13.5
- Fixed the issue that a closed release is still shown in the dropdown for releases in the board filter and the issuer modal
- Allow single spaces in configurable column/status names
- Added issue description confirmation also for new issues as for editing issues
- Added a confirmation dialog before changing a project of an issue to explain the consequences (reset labels, status and release)
- Fixed the issue that the ETag response header was discarded when moving an issue to another project which caused a wrong concurrent edit warning in the issue edit modal

# 1.3.0

- Improved styles of fonts and buttons
- Added Release feature
- Improved backlog management by adding release cards to allow easy assigning isssues to releases and filter for releases
- Bumped Go to 1.25.10 (fixing high security issue in net package)
- Fixed missing project_id constraint in labels database table and added migration code for existing databases
- Added a clean reset of project-scoped fields label, release and status, when changing the issue project
- Bumped golang.org/x/crypto to v0.51.0
- Added a script to create a database containing demo data
- Improved due date checking for consistency (overdue, issue violates release date, task violates issue deadline) and added appropriate style / notication
- Removed edit button for users and projects in system settings, edit dialog is now opened by clicking the card
- Issue id is now covered by the text-based search filter
- General refactor in frontend and backend: eliminate duplicate patterns, fix inefficiencies, and replace stringly-typed code with existing constants
- Improved handling of session revocation failure on refresh token mismatch
- Added a password legitimation step when user with admin role wants to change password or promote the role of another user
- User must now enter the current password when setting a new own password
- Complete API refactoring: Change API endpoints for project-scoped resources to project-scoped endpoints, use Go ServeMux to register routes including method, simplify and standardize handler functions
- Centralized and changed log to JSON format to allow better process in log analyses like Loki and satisfy gosec (G706)
- Allowed horizontal rule in issue description
- Harmonized SQL queries in db.go (Removed useless DB.prepare)
- Fixed errors in API spec, ensured consistency over all endpoints and against swagger.json
- Fixed missing notication toast when tasks is set to done or not-done
- Added context propagation to all database operations, added server timeout to trigger context termination and added graceful shutdown
- Added dedicated API endpoint to move issues to another project, only admin roles have permission
- Bumped marked to 18.0.4
- Bumped dompurify to 3.4.5


# 1.2.1

- Added issue card right mouse click context menu for move up/down, self-assign and prio toggle
- Added possibility to create tables in issue description
- Bumped go-sqlite3
- Bumped dompurify to 3.4.2
- Bumped marked to 18.0.3
- Refactored the global definition of fixed values in frontend (priority, status)
- Added "npm audit" to the dependency check script
- Bumped vitest and jsdom to current versions to solve minor security issues

# 1.2.0

- Removed tainting issues from some logging and improved cookie setting code (solved gosec issues)
- Added gosec report to sonar-scanner
- Refactored the central definition of frontend validation rules
- Fixed a bug that search filters were not editable in toolbar when used right after viewing an archived issue
- Fixed a bug that fields were not editable in new issue modal when creation occurs right after viewing an archived issue
- Added feature to configure board columns
- Excluded pure position changes from issue change timestamp
- Redesigned Backlog and Archive cards: compact single-line layout with aligned columns
- Removed move-to-top/bottom arrows from Backlog cards (to be later replaced by a context menu)
- Improved deployment guidelines for reverse proxy configuration to clarify security implications
- Removed database migration code from v1.1.0 (see migration note)
- Labels can now be defined per project (see migration note)
- Fixed buggy filter for "My Issues"
- Further improved layzy loading by adding another API endpoint for only OPEN issues and adapted backlog rendering
- Implemented caching renderMarkdown output to eliminate DOMPurify cold-start delay
- Accelerated Playwright tests by scheduling over 5 parallel instances
- Bumped dompurify to 3.4.0
- Bumped marked to 18.0.2

# 1.1.1

- Introduced a visual "done" style" for any planned DONE issue in the planning panel
- Auto-increment numbered list when editing description
- Fixed wrong time zone when create session
- Bumped marked dependency, major upgrade to 18.0.0
- Bumped Go and Go package dependencies go-sqlite3 and crypto
- Bumped Debian base image
- Improved container image tag management
- Improved Readme

# 1.1.0

- Added projects feature
- Improved toolbar UX
- Notication toasts are now shown at the bottom of the page
- Introduced a new sysadmin role
- Fixed a race condition during archiving
- Force logout on changing own user in setup
- Avoid autofill in edit user password field
- Fixed a bug in description sanitization
- Improved user list in Edit issue modal

# 1.0.0

- Initial public release
