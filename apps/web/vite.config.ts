import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Phase 1 scaffold: no API proxy and no Nimiq SDK wiring yet (Phase 3+ / Phase 8).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
