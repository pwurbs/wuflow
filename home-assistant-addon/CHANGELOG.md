
## 1.3.0

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
- Bumped dompurify to 3.4.3
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

## 1.2.1

- Added issue card right mouse click context menu for move up/down, self-assign and prio toggle
- Added possibility to create tables in issue description
- Bumped go-sqlite3
- Bumped dompurify to 3.4.2
- Bumped marked to 18.0.3
- Refactored the global definition of fixed values in frontend (priority, status)
- Added "npm audit" to the dependency check script
- Bumped vitest and jsdom to current versions to solve minor security issues

## 1.2.0

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

## 1.1.1

- Introduced a visual "done" style" for any planned DONE issue in the planning panel
- Auto-increment numbered list when editing description
- Fixed wrong time zone when create session
- Bumped marked dependency, major upgrade to 18.0.0
- Bumped Go and Go package dependencies go-sqlite3 and crypto
- Bumped Debian base image
- Improved container image tag management
- Improved Readme

## 1.1.0

- Added projects feature
- Improved toolbar UX
- Notication toasts are now shown at the bottom of the page
- Introduced a new sysadmin role
- Fixed a race condition during archiving
- Avoid autofill in edit user password field
- Fixed a bug in description sanitization
- Improved user list in Edit issue modal

## 1.0.0

- Initial public release

## 0.24.4

- Improved area headers for archive and backlog view
- Added script to check for available dependency updates

## 0.24.3

- Added Wapiti vulnerability scanner
- Fixed some more minor security issues

## 0.24.2

- Some more minor security improvements
- Improved the UI of Edit Issue modal

## 0.24.1

- Added configurable API rate limit for POST, PUT and DELETE actions
- Improved JWT secret checks
- Improved client IP address detection
- Fix minor security issues

## 0.24.0

- Moved to Markdown formatting in issue description field and changed the sanitization approach by using DOMPurify

## 0.23.1

- Fixed SQ issues in JS
- Added local swagger file
- initial admin email is now configurable

## 0.23.0

- Added login brute force attack prevention

## 0.22.5

- Fixed the shared usage of jwt-secret for both JWT tokens and refresh token hashes

## 0.22.4

- Improved sanitizing for some edge cases

## 0.22.3

- Changed to HMAC-SHA256 for refresh token hashing to accelerate waiting time for refresh tasks
- Improved stale modal content during loading

## 0.22.2

- Added Go fuzzy tests and improved sanitization regex

## 0.22.1

- Improved http headers and CSP for more client security

## 0.22.0

- Improved the display of notifications

## 0.21.0

- Removed explicit Save/Cancel buttons from title and tasks edit fields and implement autosave on blur
- Improved the content counting for the description field
- Some cosmetic improvements

## 0.20.5

- Added text input counter information

## 0.20.4

- Improved input validation

## 0.20.3

- Added URL query validation

## 0.20.2

- Improved error handling and logging

## 0.20.0

- Added the user name who created and updated an issue in the Issue modal

## 0.19.1

- Fixed some security findings

## 0.19.0

- Improved internal authorization implementation

## 0.18.0

- Connected users to issues

## 0.17.0

- Added personal user menu

## 0.16.0

- Improved Access and Refresh token handling

## 0.15.0

- Added User Management

## 0.14.3

- Improved the Unplanned Issues section in the Planning panel

## 0.14.2

- Improved column counters to show number of filtered issues

## 0.14.1

- Further improved Archive feature and made the API more robust

## 0.14.0

- Improved Archive feature

## 0.13.1

- Improved issue loading performance by adapting fetching tasks and distinguishing between active and archived issues

## 0.13.0

- Added optimistic locking for concurrent issue edits

## 0.12.1

- Improved Archive feature

## 0.12.0

- Added Archive feature

## 0.11.1

- Added filter feature for planning panel too

## 0.11.0

- Added the feature to set multiple planning days

## 0.10.1

- Added comprehensive logging

## 0.10.0

- Improved Planning panel

## 0.9.2

- Fixed Docker build caching issue

## 0.9.1

- Version number added to the UI

## 0.9.0

- First release as Home Assistant Add-on