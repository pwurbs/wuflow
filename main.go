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
	// Priority: Flag > Env > Default

	defaultDBPath := "wuflow.db"
	if envDBPath := os.Getenv("WF_DBPATH"); envDBPath != "" {
		defaultDBPath = envDBPath
	}

	defaultPort := "8080"
	if envPort := os.Getenv("WF_PORT"); envPort != "" {
		defaultPort = envPort
	}

	dbPath := flag.String("dbpath", defaultDBPath, "Path to the SQLite database file")
	port := flag.String("port", defaultPort, "Port to run the server on")
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
