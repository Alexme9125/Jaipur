import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/client',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@client': fileURLToPath(new URL('./src/client', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'http://localhost:8787', ws: true },
    },
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
});
