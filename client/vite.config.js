import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const API_TARGET = process.env.VITE_DEV_API_TARGET || 'http://localhost:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      // ws:true is what lets the Socket.io upgrade through in dev, so the app
      // runs same-origin locally exactly like it does in production.
      '/socket.io': { target: API_TARGET, ws: true, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
