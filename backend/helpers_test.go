package backend

import (
	"context"
	"net/http"
)

// testAPI is the API mux used by all handler tests. It wraps the bare mux
// (no auth/rate-limit middleware) with a default-role injector: tests that
// don't set a role in the request context get RoleSysAdmin so they can
// exercise handler behavior without re-asserting permissions every time.
// Tests that DO set a role (including the empty UserRole("") used to test
// "no role → 403" paths) keep their explicit value — the injector is a
// best-effort default, not an override.
var testAPI http.Handler = withTestRole(bareAPIMux("test"))

// bareAPIMux returns the API route table with NO middleware. Tests inject
// context manually (role, email) and don't want auth/rate-limit/JSON-content-
// type enforcement to interfere. Test-only; never used by production code.
func bareAPIMux(version string) *http.ServeMux {
	identity := func(h http.Handler) http.Handler { return h }
	return buildAPIMux(version, identity, identity)
}

func withTestRole(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		if ctx.Value(contextKeyRole) == nil {
			ctx = context.WithValue(ctx, contextKeyRole, RoleSysAdmin)
		}
		if ctx.Value(contextKeyEmail) == nil {
			ctx = context.WithValue(ctx, contextKeyEmail, "test@example.com")
		}
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
