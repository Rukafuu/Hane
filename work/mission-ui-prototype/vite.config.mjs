import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiProxy = { '/api': { target: process.env.HANE_API_TARGET || 'http://127.0.0.1:7788', changeOrigin: true } };
export default defineConfig({
  preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy: apiProxy },
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    proxy: apiProxy,
    watch: {
      ignored: ["**/work/chrome-qa/**"],
    },
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react()],
});
