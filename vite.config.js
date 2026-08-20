import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // No static directory at all. data/ used to be served here, which meant the portfolio
  // was readable by anyone who could reach the site; it now lives in the database behind
  // the API, and the files are only an input to the one-off legacy import.
  publicDir: false,
  server: {
    host: "0.0.0.0",
    port: 5173,
    // Bind mounts from macOS into a Linux container do not deliver inotify events,
    // so file changes are only noticed if the watcher polls for them.
    watch: { usePolling: true, interval: 300 },
    // Vite refuses requests for hostnames it does not know, which is what stops a stranger
    // from pointing their own domain at this server. The tunnel arrives as these names.
    allowedHosts: ["port.pueyleng.com", "localhost"],
    // Behind the tunnel the browser speaks https on 443 while this server speaks http on
    // 5173, so the HMR socket has to be told where to reconnect.
    hmr: { clientPort: 443, protocol: "wss", host: "port.pueyleng.com" },
    // /api now reaches the NestJS backend, which checks a JWT on every route. It used to
    // reach the single-user Python API, which has no authentication at all -- fine on
    // localhost, not fine on a public hostname.
    proxy: { "/api": { target: "http://api:3000", changeOrigin: true } },
  },
});
