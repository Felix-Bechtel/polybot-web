import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "https://localhost/" } },  // localStorage needs non-opaque origin
    globals: true,
  },
  server: { port: 5173 },
});
