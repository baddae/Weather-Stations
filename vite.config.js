import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  optimizeDeps: {
    include: ["maplibre-gl"],
  },
  server: {
    port: 5173,
    open: true,
    watch: {
      ignored: ["**/netlify-upload/**", "**/dist/**"],
    },
  },
});
