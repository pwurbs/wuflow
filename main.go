// Package main is the entry point for the wuFlow application.
package main

import (
	"embed"
	"flag"
	"log"
	"os"
	"path/filepath"

	"github.com/pwurbs/wuflow/backend"
)

// embeddedFiles holds the static files embedded into the binary.
// don't remove the line below, it's used by go:embed to embed the static files during build
//
//go:embed static
var embeddedFiles embed.FS

// main initializes the database, serves static files, and starts the HTTP server.
func main() {
	dbPath := flag.String("db", "wuflow.db", "Path to the SQLite database file")
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

	backend.StartServer(*port, *dbPath, embeddedFiles)
}
