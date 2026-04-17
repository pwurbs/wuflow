
# 1.2.0

- Removed database migration code from v1.1.0 (see migration note)
- Labels can now be defined per project (see migration note)
- Fixed buggy filter for "My Issues"
- Further improved layzy loading by adding another API endpoint for only OPEN issues and adapted backlog rendering
- Implemented caching renderMarkdown output to eliminate DOMPurify cold-start delay
- Accelerated Playwright tests by scheduling over 5 parallel instances

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
