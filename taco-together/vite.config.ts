import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so the built game works when served from any subpath
  // (e.g. GitHub Pages project sites).
  base: "./",
  server: {
    port: 5173,
    host: true,
  },
});
