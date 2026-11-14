import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { host: "0.0.0.0", allowedHosts: process.env.CODESPACE_NAME ? [`${process.env.CODESPACE_NAME}-3000.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || "app.github.dev"}`] : [], proxy: { "/api": { target: "http://127.0.0.1:3001", timeout: 360000, proxyTimeout: 360000 } } },
  test: {
    globals: true,
    environment: 'jsdom',
  },
})
