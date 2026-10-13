# Frontend build output

`npm run build` (Vite) in `static/js` writes the production build of the frontend to `static/dist/app/`, which is not committed. The Go binary embeds this directory (`//go:embed` in `main.go`), so build the frontend before `go run` or `go build`:

```bash
cd static/js && npm ci && npm run build
```

This README is committed so that the `go:embed` pattern also matches a file in a fresh clone, where `go vet` and the linters compile the module without a frontend build. A server started without a build exits with a "frontend not built" message.
