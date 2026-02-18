The server binds to plain HTTP (http.ListenAndServe). The Secure cookie flag requires TLS, so this only works correctly behind a TLS-terminating reverse proxy. This is a valid deployment pattern but should be explicitly documented to avoid misconfiguration.

Links zu Readme-Files in Tets Folder
Links zu doc files