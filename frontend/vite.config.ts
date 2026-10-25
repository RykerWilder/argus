import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // in sviluppo (npm run dev) le chiamate /api vanno al backend locale
    proxy: { "/api": "http://localhost:8000" },
  },
});
