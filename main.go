package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"kanban/backend"
)

func main() {
	dbPath := flag.String("db", "kanban.db", "Path to the SQLite database file")
	port := flag.String("port", "8080", "Port to run the server on")
	flag.Parse()

	cwd, err := os.Getwd()
	if err != nil {
		log.Fatal(err)
	}

	// Ensure db path is absolute or relative to cwd
	if !filepath.IsAbs(*dbPath) {
		*dbPath = filepath.Join(cwd, *dbPath)
	}

	fmt.Printf("Using database: %s\n", *dbPath)
	backend.InitDB(*dbPath)

	// Serve static files
	fs := http.FileServer(http.Dir("./static"))
	http.Handle("/", fs)

	// API endpoints
	http.HandleFunc("/api/issues", backend.HandleIssues)
	http.HandleFunc("/api/issues/", func(w http.ResponseWriter, r *http.Request) {
		// Differentiate between /api/issues/{id} and /api/issues/{id}/tasks
		if strings := r.URL.Path; len(strings) > 12 && strings[len(strings)-6:] == "/tasks" {
			backend.HandleTasks(w, r)
		} else {
			backend.HandleIssue(w, r)
		}
	})
	http.HandleFunc("/api/tasks/", backend.HandleTask)

	fmt.Printf("Server starting on http://localhost:%s\n", *port)
	log.Fatal(http.ListenAndServe(":"+*port, nil))
}
