import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // in development (npm run dev) /api calls go to the local backend
    proxy: { "/api": "http://localhost:8000" },
  },
});
