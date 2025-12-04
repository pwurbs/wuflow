package backend

import (
	"embed"
	"fmt"
	"io/fs"
	"log"
	"net/http"
)

// StartServer initializes the database, serves static files, and starts the HTTP server.
func StartServer(port string, dbPath string, embeddedFiles embed.FS) {
	fmt.Printf("Using database: %s\n", dbPath)
	InitDB(dbPath)

	// Serve static files from embedded filesystem
	fmt.Println("Serving static files from: embedded in binary")
	staticFS, err := fs.Sub(embeddedFiles, "static")
	if err != nil {
		log.Fatal(err)
	}
	http.Handle("/", http.FileServer(http.FS(staticFS)))

	// API endpoints
	http.HandleFunc("/api/issues", HandleIssues)
	http.HandleFunc("/api/issues/", func(w http.ResponseWriter, r *http.Request) {
		// Differentiate between /api/issues/{id} and /api/issues/{id}/tasks
		if strings := r.URL.Path; len(strings) > 12 && strings[len(strings)-6:] == "/tasks" {
			HandleTasks(w, r)
		} else {
			HandleIssue(w, r)
		}
	})
	http.HandleFunc("/api/tasks/", HandleTask)

	fmt.Printf("Server starting on port %s\n", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
