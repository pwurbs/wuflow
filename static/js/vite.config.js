import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Production build of the static frontend (npm run build). The Go binary embeds
// the output (static/dist/app, see main.go): content-hashed files under assets/
// are served with a one-year immutable cache, the HTML pages are revalidated.
// Unit tests use vitest.config.js, not this file.
const staticDir = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  root: staticDir,
  base: '/',
  build: {
    // Inside static/dist so that emptyOutDir never deletes the committed
    // static/dist/README.md placeholder that go:embed needs before a build.
    outDir: 'dist/app',
    emptyOutDir: true,
    // No modulepreload polyfill: every current browser supports modulepreload
    // natively, so it would only cost an extra request and ship Vite code.
    modulePreload: { polyfill: false },
    rolldownOptions: {
      // Keep license comments (/*! … */, @license) of the bundled libraries.
      output: { comments: { legal: true } },
      input: {
        index: `${staticDir}index.html`,
        login: `${staticDir}login.html`,
      },
    },
  },
});
