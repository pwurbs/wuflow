
# 1.2.1

- Added issue card right mouse click context menu for move up/down, self-assign and prio toggle
- Bumped go-sqlite3
- Bumped dompurify to 3.4.2
- Bumped marked to 18.0.3

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
