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

// Version is the current version of the application, set by ldflags or defaults to "dev"
var Version = "dev"

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

	defaultInitialAdminEmail := "admin@local"
	if envInitialAdminEmail := os.Getenv("WF_INITIAL_ADMIN_EMAIL"); envInitialAdminEmail != "" {
		defaultInitialAdminEmail = envInitialAdminEmail
	}

	defaultInitialAdminPassword := ""
	if envInitialAdminPW := os.Getenv("WF_INITIAL_ADMIN_PASSWORD"); envInitialAdminPW != "" {
		defaultInitialAdminPassword = envInitialAdminPW
	}

	defaultSecretKey := ""
	if envSecretKey := os.Getenv("WF_SECRET_KEY"); envSecretKey != "" {
		defaultSecretKey = envSecretKey
	}

	dbPath := flag.String("dbpath", defaultDBPath, "Path to the SQLite database file")
	port := flag.String("port", defaultPort, "Port to run the server on")
	initialAdminEmail := flag.String("initial-admin-email", defaultInitialAdminEmail, "Initial admin email address (only used on first run)")
	initialAdminPassword := flag.String("initial-admin-password", defaultInitialAdminPassword, "Initial admin password (only used on first run)")
	secretKey := flag.String("secret-key", defaultSecretKey, "Secret key for JWT signing and session token integrity (if empty, a random one is generated and all sessions are invalidated)")
	flag.Parse()

	cwd, err := os.Getwd()
	if err != nil {
		log.Fatal(err)
	}

	// Ensure db path is absolute or relative to cwd
	if !filepath.IsAbs(*dbPath) {
		*dbPath = filepath.Join(cwd, *dbPath)
	}

	backend.StartServer(Version, *port, *dbPath, *initialAdminEmail, *initialAdminPassword, *secretKey, embeddedFiles)
}
