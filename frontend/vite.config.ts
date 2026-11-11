import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development, Vite forwards /api and /static to the FastAPI backend,
// so the browser talks to a single origin (no CORS issues).
const target = process.env.VITE_API_PROXY ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Split large libraries into their own cached chunks
        manualChunks: { charts: ["recharts"], motion: ["framer-motion"], react: ["react", "react-dom", "react-router-dom"] },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target, changeOrigin: true },
      "/static": { target, changeOrigin: true },
    },
  },
  preview: {
    port: 5173,
    proxy: {
      "/api": { target, changeOrigin: true },
      "/static": { target, changeOrigin: true },
    },
  },
});
