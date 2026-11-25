package backend

import (
	"context"
	"net/http"
	"testing"
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

// --- My Work (GET /api/me/issues): test data shared by db_test.go and handlers_test.go ---

func createMyWorkUser(t *testing.T, email string) int {
	t.Helper()
	u := &User{Email: email, FirstName: "F", LastName: "L", PasswordHash: "h", Role: RoleUser, Active: true}
	if err := CreateUser(context.Background(), u); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	return u.ID
}

func createMyWorkProject(t *testing.T, name string) int {
	t.Helper()
	p := &Project{Name: name}
	if err := CreateProject(context.Background(), p); err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	return p.ID
}

func createMyWorkIssue(t *testing.T, projectID int, status IssueStatus, assigneeID *int, title string) *Issue {
	t.Helper()
	i := &Issue{Title: title, Status: status, ProjectID: projectID, AssigneeID: assigneeID}
	if err := CreateIssue(context.Background(), i); err != nil {
		t.Fatalf(failedToCreateIssueError, err)
	}
	return i
}

func myIssuesByTitle(issues []MyIssue) map[string]MyIssue {
	byTitle := make(map[string]MyIssue, len(issues))
	for _, i := range issues {
		byTitle[i.Title] = i
	}
	return byTitle
}

// seedMyWork creates two projects with their own column names, issues of mine in every
// status, plus an issue of another user and an unassigned one. Returns my user ID and the other's.
func seedMyWork(t *testing.T) (int, int) {
	t.Helper()
	me := createMyWorkUser(t, "me@example.com")
	other := createMyWorkUser(t, "other@example.com")
	beta := createMyWorkProject(t, "Beta")
	if err := UpsertStatusConfig(context.Background(), &StatusConfig{ProjectID: beta, Stage1Name: "Testing", Stage2Name: "Review"}); err != nil {
		t.Fatalf("UpsertStatusConfig: %v", err)
	}

	createMyWorkIssue(t, DefaultProjectID, StatusTodo, &me, "A todo")
	createMyWorkIssue(t, DefaultProjectID, StatusStage1, &me, "A stage1")
	createMyWorkIssue(t, DefaultProjectID, StatusDone, &me, "A done")
	createMyWorkIssue(t, DefaultProjectID, StatusOpen, &me, "A open")
	createMyWorkIssue(t, DefaultProjectID, StatusArchive, &me, "A archived")
	createMyWorkIssue(t, DefaultProjectID, StatusTodo, &other, "A other")
	createMyWorkIssue(t, DefaultProjectID, StatusTodo, nil, "A unassigned")
	createMyWorkIssue(t, beta, StatusStage1, &me, "B stage1")
	withTask := createMyWorkIssue(t, beta, StatusStage2, &me, "B stage2")
	if err := CreateTask(context.Background(), &Task{IssueID: withTask.ID, Title: testTaskTitle}); err != nil {
		t.Fatalf("CreateTask: %v", err)
	}
	return me, other
}

// rawText reads a column as the text SQLite holds, bypassing the driver's DATETIME parsing.
func rawText(t *testing.T, query string, id int) string {
	t.Helper()
	var s string
	if err := DB.QueryRowContext(context.Background(), query, id).Scan(&s); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
	return s
}

// execTestSQL changes the test database behind the app, e.g. so that a later query fails.
func execTestSQL(t *testing.T, query string) {
	t.Helper()
	if _, err := DB.ExecContext(context.Background(), query); err != nil {
		t.Fatal(err)
	}
}
