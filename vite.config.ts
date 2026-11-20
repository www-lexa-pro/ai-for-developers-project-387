import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "frontend",
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": process.env.CAL_API_TARGET ?? "http://127.0.0.1:8080" },
  },
});
