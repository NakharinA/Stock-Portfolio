import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Personal data lives in data/, served at the site root. It is gitignored as a whole:
  // nothing about this portfolio belongs in the repository.
  publicDir: "data",
  server: {
    host: "0.0.0.0",
    port: 5173,
    // Bind mounts from macOS into a Linux container do not deliver inotify events,
    // so file changes are only noticed if the watcher polls for them.
    watch: { usePolling: true, interval: 300 },
    // The dashboard talks to the ingest API through this proxy, so the browser only ever
    // sees one origin and the API needs no CORS handling of its own.
    proxy: { "/api": { target: "http://api:8000", changeOrigin: true } },
  },
});
