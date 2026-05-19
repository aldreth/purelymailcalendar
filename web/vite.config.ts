import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// In production the FastAPI app serves /about (and /about/) explicitly
// from web/dist/about.html. Vite's dev server only matches files in
// public/ on their literal path, so /about (no .html) falls through to
// the SPA shell and the React app — which has no /about route — renders
// the calendar instead. This middleware serves web/public/about.html
// directly when the user hits /about, mirroring prod behavior.
const aboutStaticPlugin: Plugin = {
  name: "about-static",
  configureServer(server) {
    const here = dirname(fileURLToPath(import.meta.url));
    const aboutFile = resolve(here, "public/about.html");
    server.middlewares.use((req, res, next) => {
      if (req.url === "/about" || req.url === "/about/") {
        try {
          const html = readFileSync(aboutFile, "utf-8");
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.setHeader("Cache-Control", "no-cache");
          res.end(html);
          return;
        } catch {
          // fall through to Vite if the file is missing
        }
      }
      next();
    });
  },
};

export default defineConfig({
  plugins: [aboutStaticPlugin, react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
