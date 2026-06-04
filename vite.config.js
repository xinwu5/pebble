import { defineConfig } from "vite";

// Tauri expects a fixed port and no clearing of the terminal.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "es2021",
    chunkSizeWarningLimit: 2000,
  },
});
