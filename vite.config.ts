import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: { exclude: ["e2e/**", "private/**", "node_modules/**", "dist/**"] },
  server: {
    proxy: { "/api": "http://localhost:3001" },
  },
});
