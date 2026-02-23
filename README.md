The server binds to plain HTTP (http.ListenAndServe). The Secure cookie flag requires TLS, so this only works correctly behind a TLS-terminating reverse proxy. This is a valid deployment pattern but should be explicitly documented to avoid misconfiguration.

Only tested for Chrome
Links zu Readme-Files in Test Folder, Go Fuzzy Test erwähnen
Links zu doc files