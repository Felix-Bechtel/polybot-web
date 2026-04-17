import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "https://localhost/" } },  // localStorage needs non-opaque origin
    globals: true,
  },
  server: {
    port: 5173,
    host: true,            // listen on all interfaces (LAN + tunnels)
    allowedHosts: true,    // accept any Host header (trycloudflare.com etc.)
  },
  preview: {
    port: 4173,
    host: true,
    allowedHosts: true,
  },
});
