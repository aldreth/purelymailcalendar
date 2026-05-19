import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      // In dev /about can't be served by Vite directly because Vite's
      // SPA fallback wins over public/about.html on path mismatch. The
      // FastAPI app has a dedicated /about route that works in both dev
      // (reading from web/public/) and prod (reading from web/dist/),
      // so we proxy it through.
      "/about": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
