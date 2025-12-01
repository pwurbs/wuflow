package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/wusolv/wutrak/backend"
)

//go:embed static/*
var embeddedFiles embed.FS

func main() {
	dbPath := flag.String("db", "wutrak.db", "Path to the SQLite database file")
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

	// Serve static files from embedded filesystem
	fmt.Println("Serving static files from: embedded in binary")
	staticFS, err := fs.Sub(embeddedFiles, "static")
	if err != nil {
		log.Fatal(err)
	}
	http.Handle("/", http.FileServer(http.FS(staticFS)))

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

	fmt.Printf("Server starting on port %s\n", *port)
	log.Fatal(http.ListenAndServe(":"+*port, nil))
}
