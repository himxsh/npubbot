import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/agent": {
        target: "http://127.0.0.1:3847",
        rewrite: (path) => path.replace(/^\/agent/, "") || "/",
      },
    },
  },
});
