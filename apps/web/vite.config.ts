import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Phase 3: same-origin /api proxy to the Fastify backend (cookies stay first-party
// in dev). No Nimiq transaction wiring; SDK is used for connect/sign only.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  preview: {
    port: 4173,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
