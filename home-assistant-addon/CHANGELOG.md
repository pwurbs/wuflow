
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